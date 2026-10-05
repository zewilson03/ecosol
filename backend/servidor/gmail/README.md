# Captura Gmail (entregas 2 e 3)

Este módulo prepara o estado durável da captura e a conexão OAuth administrativa.
Ele ainda **não** consulta e-mails nem emite cobranças. Só o backend deve chamar o repositório;
nenhuma estrutura retornada aqui é uma resposta HTTP pronta, pois as reservas
contêm `lease_token` e os metadados podem ser sensíveis.

## Contrato de sincronização

- A data inicial da conta é inclusiva a partir de 00:00 em
  `America/Sao_Paulo`. O futuro cliente Gmail deve converter esse instante
  para UTC ao montar a consulta; não deve interpretar a data no fuso padrão
  do servidor ou da API.
- Antes da varredura completa, capture um `historyId` como marco. Cada página
  de `messages.list` deve gravar **todos os IDs recebidos** por
  `registrarPagina`. IDs e cursor são confirmados na mesma transação. Somente
  após a última página o marco passa a ser o checkpoint histórico.
- `messages.list` não fornece os detalhes dos anexos. Cada ID entra na fila
  `gmail_mensagens`; `messages.get` deverá detalhá-lo separadamente. Uma
  mensagem sem PDF também termina como `detalhada`. Falhas de uma mensagem
  mantêm seu ID e não impedem o processamento das outras.
- O checkpoint pode avançar antes do download dos PDFs porque **os IDs das
  mensagens já estão duráveis**. Anexos identificados entram na fila
  `gmail_anexos`, distinta da fila de mensagens.
- `registrarPagina` exige a versão e o cursor esperados. Repetição exata da
  última página é reconhecida; páginas obsoletas são recusadas. O cliente
  deve reler `obterProgresso` após uma resposta perdida ou conflito.

## Recuperação e estados

- Se o cursor de uma varredura inicial ou revarredura expirar, use
  `reiniciarVarreduraCompleta` com um novo marco. Se o cursor de uma busca
  histórica expirar, use `reiniciarBuscaHistorica`. Se o próprio histórico
  estiver indisponível, comece `iniciarVarreduraCompleta` com
  `ressincronizacao: true`. Esses comandos preservam IDs descobertos e
  incrementam a versão, invalidando páginas antigas.
- Reservas de mensagens e anexos têm prazo em milissegundos desde o epoch.
  Após o prazo, outro trabalhador pode assumir. O token antigo não conclui o
  trabalho. Itens elegíveis com menos tentativas têm prioridade, evitando que
  um lease repetidamente expirado bloqueie os demais. Falhas temporárias têm
  horário de nova tentativa; falhas permanentes ficam `pendente_manual` até
  reagendamento explícito.
- O SQLite espera até cinco segundos por um lock de escrita de outra conexão.
  Se retornar `SQLITE_BUSY` depois disso, a operação não avançou o estado e o
  futuro coletor deverá tentar novamente com espera controlada.
- Pausar ou marcar a conta para reconexão invalida reservas ativas. Só uma
  conta conectada e não pausada pode iniciar trabalho ou concluir uma captura.
- `capturado` e `duplicado` exigem um documento já salvo no faturamento e o
  mesmo SHA-256. Uma pendência não aponta para documento; a razão da pendência
  fica em `erro_codigo`.

O futuro coletor ainda precisará de tratamento de limites e falhas da API,
expiração/revogação do refresh token, e idempotência do **registro de
recebimento** entre `receberPdf` e a conclusão da fila. O hash já impede um
segundo documento com o mesmo PDF, mas não basta para impedir dois registros
de recebimento após uma falha entre essas operações.

## Aceite desta entrega

`npm run test:gmail` exercita o repositório e um banco SQLite temporário em
processos separados. O teste inicia o servidor sobre um banco vazio, reinicia
o servidor após gravar conta, data, cursor, IDs, anexo e estados, e verifica
que tudo permanece. Também repete páginas, disputa a mesma página e reservas
entre processos, testa lock curto, timeout seguido de retry e encerra um
processo antes do commit para confirmar rollback sem perda de checkpoint.
Nenhuma conta Gmail real é acessada nesta entrega.

## Conexão OAuth administrativa (entrega 3)

Somente um administrador nominal de nível 3 pode cadastrar, conectar,
reconectar, pausar ou retomar uma conta em `/admin/gmail`. A data inicial é
imutável depois do cadastro. A conexão pede somente `gmail.readonly`, verifica
o e-mail real com `users.getProfile(me)` e só então grava o refresh token
cifrado com AES-256-GCM. O access token e o código de autorização não são
persistidos. A conta volta **pausada** após conexão/reconexão; retomá-la é
uma decisão administrativa separada. Pausa e reconexão invalidam reservas
ativas da captura.

Cada tentativa tem `state` aleatório de uso único, PKCE S256 e prazo de dez
minutos, vinculados à sessão exata do administrador. Nova tentativa invalida
a anterior; o callback antigo não pode substituir uma conexão mais recente.
Recusa, falha ou sessão expirada mantêm a credencial anterior intacta. O
callback redireciona apenas para a página local, sem código/token na URL.

### Configuração necessária para teste real

1. Em um projeto Google Cloud de teste, habilite a Gmail API e configure a
   tela de consentimento OAuth para usuários externos. Adicione a conta Gmail
   a ser usada como usuário de teste se o aplicativo estiver em _Testing_.
2. Crie um cliente OAuth 2.0 do tipo **aplicativo web**. Cadastre exatamente
   `http://localhost:3000/api/admin/gmail/oauth/retorno` como URI de
   redirecionamento para desenvolvimento local (ajuste porta/domínio conforme
   seu `APP_URL`). Domínio público exige HTTPS.
3. No `backend/.env.local` (fora do Git), configure:

   ```text
   GMAIL_OAUTH_CLIENT_ID=...
   GMAIL_OAUTH_CLIENT_SECRET=...
   GMAIL_OAUTH_REDIRECT_URI=http://localhost:3000/api/admin/gmail/oauth/retorno
   GMAIL_TOKEN_ENCRYPTION_KEY=... (32 bytes aleatórios em base64)
   ```

   Gere a chave localmente com `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
   Não a envie em mensagens nem a grave no banco. Guarde-a junto ao plano de
   backup: sem essa chave, o token existente não pode ser recuperado e será
   necessário reconectar. Nunca use a mesma chave de testes em produção.

4. Reinicie o servidor, entre como administrador avançado, cadastre a conta e
   a data inicial, autorize no Google e confira a identidade exibida. Teste
   também Cancelar no Google, retorno repetido e sessão encerrada durante a
   autorização. Depois da validação, retome a conta se desejar habilitar a
   futura busca; a entrega 3 ainda não realiza a busca.

O escopo `gmail.readonly` é classificado pelo Google como **restrito**. Um
projeto externo em modo _Testing_ emite refresh tokens que expiram após sete
dias quando há escopos Gmail. Para uso contínuo, avalie as exigências de
publicação/verificação e as exceções aplicáveis ao caso antes da implantação.
Consulte [OAuth web server](https://developers.google.com/identity/protocols/oauth2/web-server),
[escopos Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes)
e [uso de escopos restritos](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

### Aceite da entrega 3

`npm run test:gmail` verifica autorização administrativa, parâmetros OAuth,
PKCE, escopo, identidade, token cifrado, recusa, sessão expirada, callback
repetido, reconexão concorrente, pausa, rollback e integridade em bancos
temporários. `npm run build` verifica a interface. Falta a prova manual com
uma conta real: consentir, conferir a identidade, pausar, retomar, reconectar,
recusar e testar retorno após encerrar a sessão. Até essa prova, a entrega 3
não deve ser marcada como concluída integralmente nem a entrega 4 iniciada.

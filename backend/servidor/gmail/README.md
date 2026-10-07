# Captura Gmail (entregas 2 a 4)

Este módulo mantém o estado durável, a conexão OAuth e a captura de PDFs anexados.
Ele **não** aprova valores nem emite cobranças. Só o backend deve chamar o repositório;
nenhuma estrutura retornada aqui é uma resposta HTTP pronta, pois as reservas
contêm `lease_token` e os metadados podem ser sensíveis.

## Contrato de sincronização

- A data inicial da conta é inclusiva a partir de 00:00 em
  `America/Sao_Paulo`. O cliente Gmail converte esse instante
  para UTC ao montar a consulta; não deve interpretar a data no fuso padrão
  do servidor ou da API.
- Antes da varredura completa, capture um `historyId` como marco. Cada página
  de `messages.list` deve gravar **todos os IDs recebidos** por
  `registrarPagina`. IDs e cursor são confirmados na mesma transação. Somente
  após a última página o marco passa a ser o checkpoint histórico.
- `messages.list` não fornece os detalhes dos anexos. Cada ID entra na fila
  `gmail_mensagens`; `messages.get` o detalha separadamente. Uma
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
  coletor tenta novamente com espera controlada.
- Pausar ou marcar a conta para reconexão invalida reservas ativas. Só uma
  conta conectada e não pausada pode iniciar trabalho ou concluir uma captura.
- `capturado` e `duplicado` exigem um documento já salvo no faturamento e o
  mesmo SHA-256. Uma pendência não aponta para documento; a razão da pendência
  fica em `erro_codigo`.

O recebimento automático usa uma transação curta que confere conta e lease,
insere ou reutiliza o documento pelo hash, registra o recebimento pelo ID único
do anexo Gmail e conclui a fila. O hash sozinho não substitui a identidade da
origem: o mesmo PDF em duas mensagens tem um documento e dois recebimentos.

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
   busca da entrega 4; a entrega 3, isoladamente, não realizava a busca.

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
temporários. `npm run build` verifica a interface. A prova manual com uma conta
real cobriu consentimento, identidade, pausa, retomada, reconexão, recusa e
retorno após encerrar a sessão administrativa.

## Captura e conferência (entrega 4)

- A conta conectada inicia **pausada**. Reativá-la permite a busca automática
  aproximadamente a cada cinco minutos; `Sincronizar agora` solicita uma
  execução adicional. O servidor executa a captura, mesmo sem navegador aberto.
- A busca inicial começa na data escolhida, às 00:00 de São Paulo, inclusive.
  A consulta usa segundos Unix porque datas textuais do Gmail usam PST.
  Mensagens lidas e arquivadas entram; spam, lixeira, enviados e rascunhos não.
  Não há filtro de remetente: use a caixa destinada a faturas. PDFs novos
  ficam primeiro em triagem, acessível apenas a administradores avançados;
  só depois de confirmados como fatura ficam disponíveis à equipe de Faturas.
  PDFs são mantidos sem exclusão automática.
- Cada página registra IDs e cursor na mesma transação. O histórico incremental
  recupera mensagens chegadas durante a busca. Histórico expirado provoca
  revarredura completa; páginas inválidas reiniciam a paginação sem descartar
  IDs já persistidos. Cada execução limita páginas, mensagens e anexos, e a
  seguinte continua do checkpoint.
- Cada parte PDF da mensagem entra na fila separadamente. São aceitos PDFs de
  até 10 MB e 10 páginas; assinatura e leitura são verificadas no servidor.
  Arquivo com senha, danificado, excessivo ou MIME anormal fica pendente com
  código de erro. Um anexo problemático não bloqueia os demais. Não há OCR.
- A leitura inicial da mensagem solicita somente metadados MIME, sem
  `body.data`. Antes de solicitar os bytes do anexo, o Ecosol identifica como
  candidato de fatura Equatorial apenas nomes no padrão `AAAAMM` seguido de sete dígitos e
  `.pdf`, com mês válido. Outros nomes (inclusive `Termo`) ficam em
  `pendente_manual/revisao_email`: aparecem no painel com nome, sem PDF salvo
  no Ecosol, para conferência na conta Gmail conectada. Um administrador de
  nível 3 pode confirmar que conferiu o e-mail e autorizar a captura; a ação
  fica auditada e o PDF segue para triagem, nunca direto para cobrança. O
  nome do arquivo é apenas um filtro prévio: não prova que o conteúdo é fatura.
  Documentos capturados antes desta regra não são apagados retroativamente.
- PDFs válidos entram primeiro na triagem restrita. O administrador pode abrir
  o PDF, marcar que não é fatura ou enviá-lo a Faturas, onde ficará como
  `Pendente de revisão`. A origem Gmail e o recebimento ficam rastreáveis;
  duplicatas por conteúdo vinculam-se ao documento existente. Nenhuma
  cobrança, cálculo ou aprovação é automática.
- Na triagem, o administrador avançado pode selecionar até 500 PDFs carregados
  e classificá-los em lote como faturas ou não faturas. O lote é atômico:
  se um item tiver sido alterado, nenhum é reclassificado. Também pode excluir
  um ou vários PDFs ainda na triagem ou marcados como não faturas, digitando
  `EXCLUIR`. Essa operação apaga permanentemente do banco operacional os bytes
  do PDF, o texto e os dados extraídos, mas preserva metadados mínimos, vínculo
  Gmail e auditoria para impedir recaptura acidental. Não permite excluir uma
  fatura já enviada ao fluxo financeiro, nem um PDF vinculado a outra caixa ou
  recebido também por outro caminho. O e-mail original no Gmail e backups
  anteriores **não** são apagados; a exclusão não é eliminação forense de dados.
- Falhas de rede, timeout e limite da API recebem espera crescente. Um token
  de acesso expirado é renovado automaticamente; perda real de autorização
  suspende a conta e exige reconexão. O painel mostra a última
  execução, contagens, falhas e pendências, com reagendamento manual.

### Verificação e implantação

`npm run test:gmail` cobre o cliente Google simulado, paginação, histórico,
anexos múltiplos, duplicidade, rollback de gravação, pausa e retomada de
checkpoint. Antes do piloto real, faça backup do banco **e** preserve a chave
de criptografia separadamente. Reinicie o servidor para aplicar as migrações
aditivas; confira o estado da conta antes de reativar. O teste real deve usar
um intervalo inicial pequeno e comparar os PDFs elegíveis da caixa com as
contagens de capturados, duplicados e pendentes. Não marcar esta entrega como
aceita até a conferência real e os testes de recuperação estarem concluídos.

### Piloto local de 06/10/2026

Com a caixa exclusiva de faturas autorizada, a busca desde 02/10/2026
encontrou 50 mensagens elegíveis, das quais 49 continham um PDF. A API do
Google devolveu IDs de download diferentes para a mesma parte em leituras
sucessivas; a comparação rígida deixou 49 anexos pendentes. Após corrigir a
comparação e reiniciar o servidor, essas 49 pendências foram reagendadas e
capturadas. A conferência independente da caixa encontrou 49 PDFs elegíveis,
todos registrados como `capturado` e `Recebida`, sem pendências. Seus hashes,
assinaturas, vínculos de recebimento e estado `Pendente de revisão` foram
verificados; `PRAGMA integrity_check` retornou `ok` e não houve violação de
chaves estrangeiras. Uma nova sincronização não criou documentos nem
recebimentos adicionais. O backup anterior ao piloto está em
`backend/data/ecosol-pre-gmail4-20261006.db` (não versionado).

**Classificação:** 47 dos 49 PDFs têm nome iniciado por `Termo` e não parecem
contas de energia. Após backup em
`backend/data/ecosol-pre-triagem-20261006.db` (não versionado), os 47 foram
movidos em uma única transação auditada para a triagem restrita. Os dois PDFs
restantes continuaram em Faturas. Novos PDFs entram em triagem manual antes de
serem disponibilizados à equipe de Faturas. Não houve exclusão de arquivos.

### Verificação local de recuperação em 06/10/2026

Depois da classificação humana, os 47 Termos ficaram como `nao_fatura`; nenhum
Termo permanece em Faturas. A sincronização automática continuou a terminar
sem erro, com 50 mensagens detalhadas, 49 anexos `capturado` e zero pendências.
Uma cópia consistente do banco foi gerada em
`backend/data/ecosol-entrega4-homologacao-20261006.db` (não versionada) e
aberta separadamente: `integrity_check=ok`, nenhuma violação de chave
estrangeira, 49 anexos preservados e credencial Gmail decifrável com a chave
atual. O token e a chave não foram exibidos. Passaram `test:gmail`,
`test:faturamento`, `test:permissoes`, `test:planilhas` e `build`.

Isto comprova recuperação **local** com a chave ainda disponível neste
computador. Para recuperação após perda do equipamento, mantenha cópias
protegidas do banco e de `GMAIL_TOKEN_ENCRYPTION_KEY` em local externo seguro;
não inclua a chave no Git nem a envie por mensagem. A homologação operacional
contínua também depende de conferir o status de publicação do cliente OAuth
no projeto Google Cloud proprietário da credencial.

# Ecosol — projeto demonstrativo

Site institucional e sistema local de teste para uma empresa de energia solar.
O projeto contém formulário de contato, cadastro de clientes com CPF, acesso
por senha, área do cliente e área da equipe. O código está separado em
`frontend` (telas) e `backend` (servidor, regras e dados).

## Preparação de faturamento — etapa sem emissão bancária

Após atualizar as dependências (`pnpm install`), reinicie o servidor. A migração
adiciona tabelas ao SQLite existente sem remover registros. Faça backup consistente
do banco antes de atualizar uma instalação em uso.

1. Em **Clientes → Unidades e contratos**, cadastre a UC, CPF/CNPJ numérico,
   nome, e-mail, dia preferido, modalidade e desconto com competência inicial.
   Este é o cadastro financeiro; não cria acesso ao portal. Várias UCs podem
   compartilhar o mesmo CPF/CNPJ. As contas de acesso existentes são preservadas.
2. Em **Faturas**, informe um lote e importe o PDF Equatorial (máximo 10 MB e
   10 páginas). O arquivo original fica privado no banco e pode ser baixado pela
   equipe. PDFs com senha ou inválidos são recusados. A assinatura do arquivo
   impede importar o mesmo PDF novamente.
3. Confira os campos sugeridos e complete os ausentes. Esta etapa extrai texto,
   mas não faz OCR: documentos digitalizados exigem preenchimento manual.
   Tarifas SCEE são sugestões e devem ser conferidas com a regra comercial.
4. Informe os componentes unitário + bandeira em R$/kWh, ou selecione uma GDI
   **aprovada do mesmo lote**. Referências não são escolhidas automaticamente.
   Informe zero explicitamente quando não houver bandeira ou ajuste; campo vazio
   nunca significa zero. Use decimais sem separador de milhares.
5. Confirme o vencimento Ecosol manualmente, observando o dia preferido. A regra
   para chegada tardia, feriados e meses curtos ainda precisa ser definida.
6. Marque a conferência e escolha **Salvar e calcular**. O demonstrativo mostra
   `ARRED(injecao × (unitario + bandeira) × (1 − desconto/100); 2)
   - total_equatorial − ajuste_gdii`. Não soma mínimo ou iluminação novamente.
7. O nível 3 pode **Aprovar para emissão futura**. A memória fica protegida contra
   edição e guarda contrato, dados cadastrais e fonte da tarifa. Esta aprovação
   não emite boleto, não envia e-mail e não cria pagamento bancário.

Permissões: nível 1 consulta; níveis 2 e 3 cadastram unidades, importam e calculam;
nível 3 acrescenta vigências e aprova. Alterações simultâneas são detectadas.
Uma UC/competência não pode ter duas cobranças calculadas ou aprovadas. Segunda
via diferente pode ser importada para análise, mas o cálculo duplicado é bloqueado.
Cobranças aprovadas não têm reabertura nesta etapa; o fluxo de revisão/cancelamento
fica para a etapa bancária. Novas vigências não podem alcançar cobranças aprovadas.

Os módulos ficam em `backend/servidor/faturamento`. `decimal.js` trata precisão e
arredondamento; `pdfjs-dist` extrai texto. `PreparacaoFaturas.tsx` e
`UnidadesDeCobranca.tsx` integram as telas existentes.

Validação: `pnpm test:faturamento`, `pnpm test:permissoes` e `pnpm build`.
Os testes usam bancos temporários e PDFs sintéticos, sem modificar dados reais.
O caso Havilah deve resultar em **R$ 1.468,30**. Os componentes sintéticos usados
nos testes somam R$ 1,169969/kWh; não representam a composição de uma fatura real.

Próximas etapas: captura pelo Gmail, leitura autorizada do Drive, OCR,
regras automáticas de vencimento, integração Sicoob, envio e conciliação.
Não são necessários Redis, PostgreSQL ou credenciais bancárias para esta entrega.

## Excel por usina — importação e exportação separada

**As planilhas originais não devem ser alteradas.** Este módulo lê o arquivo
selecionado e grava novos cadastros somente no banco do sistema. Downloads de
modelos e relatórios são arquivos novos. Não existe gravação ou sincronização
de volta para o Drive. O caminho G: não é usado pelo servidor.

Em **Clientes → Unidades e contratos → Planilhas da pasta por usina**, a seleção
usa o nome da usina extraído do nome de cada arquivo. A pasta padrão é
`C:\Users\User\Desktop\00 - Planilhas Atualizadas` (Desktop do usuário do servidor).
Configure `ECOSOL_PLANILHAS_DIR` para mudar essa pasta em outro ambiente.
A consulta exige nível 2 e lê apenas os arquivos `Venda de Energia - Usina ...`
no nível principal; exclui o consolidado `uc por usina.xlsx` e subpastas.
Selecione explicitamente a aba mensal para ver uma amostra de 30 linhas.
A consulta não grava cadastros, não executa fórmulas e não emite cobranças.
As planilhas mensais atuais não têm todas as oito colunas do importador de cadastros;
campos ausentes podem ser completados na prévia do sistema. O botão
**Preparar importação desta aba** aproveita o arquivo da pasta diretamente,
sem novo upload. Confira a associação com a usina cadastrada; nomes iguais
(desconsiderando acentos e o prefixo Usina) são sugeridos quando não há ambiguidade.
As 27 planilhas por usina da pasta informada foram testadas em leitura,
com verificação de assinatura antes e depois: nenhum arquivo foi alterado.
Objetos visuais, mesclagens e referências de tabelas não participam da leitura;
os valores e formatos numéricos das células são preservados na interpretação.
No mapeamento de cadastros, `NOVA UC` tem preferência quando também existe `UC`.

1. Um administrador nível 3 pode cadastrar nome e localização em **Usinas**.
2. Em **Clientes → Unidades e contratos → Importar planilha**, selecione a
   usina e um arquivo `.xlsx` de até 5 MB.
3. Escolha a aba, a linha dos títulos (entre 1 e 30) e associe pelo menos nome e UC.
   Associe também CPF/CNPJ, e-mail, dia preferido, modalidade, desconto e vigência
   quando existirem; use **Preencher no sistema** nos demais campos.
   Modalidade e vigência podem ser informadas para as linhas sem essas colunas;
   não são inferidas a partir do nome da usina ou da data mensal da planilha.
4. Confira a prévia. Fórmulas em campos selecionados são recusadas; use valores
   conferidos. Percentuais formatados pelo Excel são convertidos corretamente.
   CPF/CNPJ e UC devem ser texto para preservar zeros à esquerda.
5. Complete os dados por linha e valide novamente. Só então confirme a importação
   das linhas válidas. Complementos ficam no banco e no histórico, nunca no Excel.
   Linhas inválidas e conflitantes não
   são gravadas. UCs repetidas no arquivo são sinalizadas; cadastros idênticos são
   ignorados; dados diferentes de UCs existentes não são sobrescritos. Uma mudança
   concorrente após a prévia exige nova validação. A confirmação é idempotente.

Cada importação pertence ao acesso que a iniciou e sua prévia expira em uma hora.
Limites: até 20 abas, 2.001 linhas e 60 colunas por aba, 500 mil células por arquivo.
A leitura ocorre em processo de execução isolado com limite de memória e tempo.
O histórico registra nome e assinatura do arquivo, aba, linha, usina e complementos.

Unidades antigas ficam com **Alocação a definir** até edição do cadastro. Memórias
de cálculo aprovadas preservam a alocação original. Um cálculo novo guarda o nome
e o identificador da usina; cálculos anteriores não recebem alocação retroativa.

Em **Faturas → Exportar conferência**, baixe um Excel separado com todos os cálculos
ou filtre por usina registrada na memória. O relatório inclui parcelas, tarifa,
desconto, vencimentos e referência, e não constitui boleto ou confirmação de pagamento.

Validação adicional: `pnpm test:planilhas`. Testes usam apenas arquivos sintéticos
em memória e bancos temporários, incluindo seleção por nome, restrição de acesso,
recusa de caminhos externos e preservação dos arquivos de origem.

## Abrir e executar no VS Code

1. Abra a pasta `C:\Users\User\Desktop\ecosol` no VS Code.
2. Instale o Node.js 24 ou superior, caso ainda não tenha.
3. Abra o terminal integrado. Se ele não estiver na pasta do projeto, execute
   `cd C:\Users\User\Desktop\ecosol`.
4. Execute `.\iniciar.cmd`. Também é possível dar dois cliques nesse arquivo
   ou usar a tarefa **Ecosol: iniciar site** do VS Code.
5. Acesse http://localhost:3000 no navegador.

O atalho usa o Node.js disponível no terminal. Caso o VS Code não encontre
`node`, ele procura o runtime Node.js já instalado pelo Codex neste computador.
Para encerrar o servidor, pressione `Ctrl+C` no terminal.

O programa recompila a interface quando um arquivo de `frontend/src` é salvo.
Atualize o navegador para ver as alterações. Se mudar o código de
`backend/servidor`, reinicie o comando.

Se copiar o projeto para outro computador, instale as dependências com
`pnpm install` antes de iniciar. Crie `backend/.env.local` a partir de
`backend/.env.example` e defina `ADMIN_PASSWORD`.

## Por onde começar a leitura do código

- `frontend/src/RotasDaAplicacao.tsx`: relaciona cada endereço com sua tela.
- `frontend/src/paginas/PaginaInicial.tsx`: apresentação da Ecosol.
- `frontend/src/paginas/FormularioDeContato.tsx`: formulário do visitante.
- `frontend/src/paginas/CadastroDoCliente.tsx`: cadastro de CPF e senha.
- `frontend/src/paginas/PainelDaEquipe.tsx`: entrada da equipe.
- `frontend/src/admin/Clientes.tsx`: clientes, contatos recebidos e acessos da equipe.
- `frontend/src/estilos.css`: cores, espaçamento e layout.
- `backend/servidor/rotasDaAplicacao.mjs`: recebimento dos formulários e regras de negócio.
- `backend/servidor/autenticacao.mjs`: senhas e sessões.
- `backend/servidor/bancoDeDados.mjs`: estrutura do SQLite.

As páginas têm nomes que descrevem sua função. O React Router lê a lista de
rotas em `RotasDaAplicacao.tsx`. Portanto, não há arquivos `page.tsx`.

## Testar cadastros

1. Em `/cadastro`, informe um CPF válido e ainda não cadastrado, nome, email
   e uma senha de 8 a 128 caracteres. O botão **Gerar CPF de teste** ajuda a
   preencher um CPF matematicamente válido.
2. Entre em `/entrar` com o CPF e a senha escolhida.
3. Para criar administradores, abra `/equipe` e faça o primeiro acesso com
   `ADMIN_PASSWORD` do arquivo `backend/.env.local`.
4. Em **Clientes → Acessos da equipe → Novo acesso**, crie o primeiro
   administrador de nível 3 com nome, email e senha. Depois, esse administrador
   pode criar acessos de níveis 1 a 3. Administradores entram em `/equipe` com
   seu email e a senha individual.

## Painel administrativo

Após entrar em `/equipe`, o sistema abre `/admin/usinas`. O menu contém
Usinas, Faturas, Clientes e, para os perfis autorizados, Financeiro.

| Nível             | Cadastrar e excluir clientes | Consultar Financeiro | Criar e editar contas a pagar | Gerir acessos administrativos |
| ----------------- | ---------------------------- | -------------------- | ----------------------------- | ----------------------------- |
| 1 — Básico        | Sim                          | Não                  | Não                           | Não                           |
| 2 — Intermediário | Sim                          | Sim                  | Não                           | Não                           |
| 3 — Avançado      | Sim                          | Sim                  | Sim                           | Sim                           |

O Avançado cria, altera níveis e exclui acessos em **Clientes → Acessos da
equipe**. A exclusão encerra as sessões da conta removida. Não é possível
alterar o próprio nível nem excluir a própria conta. As permissões são
verificadas no servidor a cada operação e as mudanças de nível passam a valer
na próxima requisição.

Os três níveis podem cadastrar clientes e excluí-los em **Clientes → Lista de
clientes**. A exclusão remove o cadastro e encerra as sessões e links de
ativação ou recuperação do cliente. As faturas já registradas continuam
visíveis com o nome preservado para consulta histórica.

Contas administrativas anteriores à atualização recebem nível Básico.
O acesso inicial com ADMIN_PASSWORD serve apenas para criar o primeiro
administrador de nível 3. Depois da criação, essa senha deixa de conceder
acesso ao painel.

Em Financeiro, as contas possuem descrição, favorecido, valor, vencimento e
status. Os totais e as listas são atualizados após salvar. O histórico guarda
responsável, data, dados anteriores e novos; a interface exibe os últimos 100
registros. Edições simultâneas são detectadas para evitar sobrepor dados de
outra pessoa. Valores são armazenados em centavos.

Usinas possui cadastro inicial para alocação. Faturas prepara cálculos e exporta
demonstrativos; emissão de boletos e integrações de geração e bancos
pertencem às próximas etapas. Marcar uma conta como paga registra seu status;
não executa pagamento ou transferência.

O código do painel fica em `frontend/src/admin`. As permissões estão em
`backend/servidor/permissoesDaEquipe.mjs` e as operações financeiras em
`backend/servidor/rotasAdministrativas.mjs`.

Para repetir a verificação dos níveis e do primeiro acesso, execute
`pnpm test:permissoes`. Os testes usam bancos temporários e não alteram o
banco do projeto.

O cadastro direto e a caixa `/dev/links` funcionam no modo de desenvolvimento.
Clientes sem senha inicial podem solicitar ativação; os links de teste aparecem
na caixa local. A recuperação de senha usa o mesmo processo.

## Banco de dados

O banco é `backend/data/ecosol.db`. É um arquivo binário SQLite. Para ler os cadastros
e contatos como texto no VS Code, execute `.\ver-dados.cmd`. Os arquivos JSON
em `backend/data/consultas` são cópias: execute o atalho novamente após cadastrar,
alterar ou excluir registros. Clientes e administradores mostram `senha_hash`,
mas nunca a senha em texto. Tokens e sessões não são exportados. Esses JSONs
contêm dados sensíveis e estão ignorados pelo Git; não os compartilhe.

As novas senhas usam `scrypt` com sal aleatório individual de 16 bytes e
parâmetros `N=2^17, r=8, p=1`. O hash inclui a versão do formato para permitir
futuras atualizações. Hashes antigos continuam válidos e são atualizados após
um login bem-sucedido. Hash é irreversível; se alguém esquecer a senha, use a
recuperação de acesso em vez de tentar lê-la do banco.

## Requisitos desta etapa

RF01 apresentação da empresa; RF02 contato; RF03 login com CPF e senha;
RF04 ativação de conta; RF05 recuperação de senha; RF06 área protegida do
cliente; RF07 saída da conta; RF08 registro e acompanhamento de contatos
pela equipe.

Esta é uma base local de desenvolvimento. Antes de publicar, a Ecosol deve
revisar textos comerciais e privacidade, configurar envio de email, backup
persistente e confirmação de titularidade dos CPFs cadastrados.

# Ecosol — projeto demonstrativo

Site institucional e sistema local de teste para uma empresa de energia solar.
O projeto contém formulário de contato, cadastro de clientes com CPF, acesso
por senha, área do cliente e área da equipe. O código está separado em
`frontend` (telas) e `backend` (servidor, regras e dados).

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

Usinas e Faturas têm telas de consulta com busca e filtros. O cadastro de
usinas, a emissão de faturas/boletos e as integrações de geração e bancos
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

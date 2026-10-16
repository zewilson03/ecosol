# Organização e segurança da base Ecosol

Revisão de 16/10/2026, antes da integração Sicoob. Nenhuma migração financeira, movimentação bancária ou alteração de dados reais faz parte desta revisão.

## Mapa de manutenção

| Local                                   | Responsabilidade                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| frontend/src/admin                      | Telas e modelos de apresentação administrativos                                         |
| frontend/src/paginas                    | Páginas públicas e acesso do cliente                                                    |
| backend/servidor/configuracao.mjs       | Carregamento de ambiente antes das rotas                                                |
| backend/servidor/segurancaHttp.mjs      | Cabeçalhos, validação de origem e resposta segura de erro                               |
| backend/servidor/autenticacao.mjs       | Senhas, sessões e limite de tentativas                                                  |
| backend/servidor/permissoesDaEquipe.mjs | Autorização por nível no servidor                                                       |
| backend/servidor/faturamento            | Extração, cálculo, vínculos, cadastro financeiro, persistência e histórico              |
| backend/servidor/gmail                  | OAuth, captura, persistência e triagem                                                  |
| backend/scripts                         | Ferramentas operacionais; várias modificam dados e não devem ser executadas como testes |
| backend/testes e frontend/testes        | Testes e fixtures isoladas                                                              |
| docs/sicoob                             | Proposta de segurança e arquitetura bancária; não é funcionalidade implementada         |

## Correções funcionais

- Configuração carregada antes de imports que capturam NODE_ENV. Antes, produção definida apenas no arquivo local podia ser interpretada como desenvolvimento pelas rotas, expondo links de recuperação.
- Caixa de links de teste restrita ao nível 3 e indisponível em produção. É necessário entrar como administrador para consultá-la localmente.
- Redefinição de senha consome token com condição de validade dentro de transação, depois do hash assíncrono. Senha, invalidação de tokens e revogação de sessões são atômicas, evitando uso concorrente e sucesso parcial.
- Origem malformada retorna 403; mutações explicitamente cross-site são rejeitadas. Clientes não navegador sem Origin continuam compatíveis. Isso não é uma implementação de token CSRF para a futura integração bancária.
- Respostas de API usam no-store; referrer não vaza URL/token; nosniff e SAMEORIGIN preservam PDF embutido no próprio site. Cabeçalhos não substituem TLS em produção.
- Erros gerais não imprimem objeto/URL/corpo; referência aleatória permite correlação sem expor segredos. JSON malformado e corpo excessivo recebem 400/413.
- Hook de consulta da interface não trata JSON de erro HTTP como se fosse a lista solicitada, evitando falha de renderização por resposta 401/403.

## Formatação e modelos

Prettier existente é a referência para JS, MJS, TS, TSX, CSS, JSON e Markdown. `.prettierrc.json` padroniza LF; `npm run format` aplica e `npm run format:check` verifica. Dados gerados, banco, dependências e build estão fora da formatação. Python não é formatado pelo Prettier e foi mantido intacto; não foi instalada nova ferramenta apenas para reformatá-lo.

Preservados os contratos de dados, esquema e modelos monetários existentes. A reorganização extrai responsabilidades HTTP/configuração e documenta os módulos; não move rotas ou tabelas em massa. Não se afirma ganho de desempenho sem medição. O foco foi manutenção, previsibilidade e correção.

## Validação e limites

`npm run test:seguranca` cobre configuração antecipada em fixture isolada, origem inválida, cross-site, headers, corpo inválido/grande, acesso anônimo a links, sanitização de logs, redefinição concorrente/replay e rollback por falha de persistência. Teste de primeiro administrador verifica que rotas de desenvolvimento retornam 404 em produção.

Validação realizada: `test:seguranca`, `test:permissoes`, `test:faturamento`, `test:gmail`, `test:calculos`, `test:planilhas`, `test:transferencias`, `build` e `format:check` passaram. O teste de cálculos ainda esperava o bloqueio antigo de cadastro operacional; foi atualizado para a regra já aprovada (calcular permitido, emissão bloqueada), incluindo asserção específica de emissão bloqueada. Testes locais usam dados temporários e não homologam banco externo, hospedagem ou caixa Gmail real.

## Pendências conhecidas

- MFA, dupla aprovação, fila bancária e recuperação financeira continuam no plano Sicoob.
- TLS, backup externo e restauração operacional precisam de verificação no ambiente de implantação.
- Há relatórios operacionais já rastreados no diretório output. Não foram abertos nem removidos nesta revisão; avaliar conteúdo pessoal e política de retenção antes de publicar o repositório. Ignorar novos arquivos não remove dados já versionados ou seu histórico.
- Certificados privados e caches Python foram adicionados ao .gitignore preventivamente; isso não equivale a um scanner de segredos do histórico.

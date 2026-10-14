# Validação da etapa 3 — Calcular — 14/10/2026

## Resultado

A etapa `/admin/faturas?etapa=calcular` está implementada dentro de Faturas e passou pelas verificações abaixo.
O endereço antigo `/admin/calculos` apenas redireciona para essa etapa e “Cálculos” não aparece mais como módulo independente no menu.
Nenhuma fatura real foi calculada, aprovada ou alterada durante estes testes.
Nenhum boleto foi emitido. Não houve mudança de banco de dados nesta entrega.

| Verificação                                                              | Resultado                                                            |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Compilação TypeScript e Vite (`npm run build`)                           | Passou                                                               |
| Navegação Faturas: receber → conferir → calcular → aprovar               | Passou                                                               |
| Separação entre conferência, cálculo e aprovação                         | Passou                                                               |
| Testes do painel e demonstrativo (`npm run test:calculos`)               | Passou                                                               |
| Suíte real do backend em bancos temporários (`npm run test:faturamento`) | Passou                                                               |
| Prontidão, vencimento e vínculo automático por UC                        | Três arquivos de teste passaram                                      |
| Prévia GDI no navegador                                                  | R$ 1.759,01; não exibe ajuste GDII                                   |
| Prévia GDII no navegador                                                 | R$ 1.468,30; exibe dedução de R$ 290,71                              |
| Salvar e aprovar no navegador                                            | Cada ação exigiu confirmação; estado aprovado impediu nova prévia    |
| Total da seleção                                                         | Não incluiu prévia; aumentou somente após salvar                     |
| Filtro por situação e por usina                                          | Exibiu somente as linhas correspondentes                             |
| Cadastro incompleto                                                      | Exibiu pendência e atalho para a fatura; não ofereceu cálculo        |
| Tela pequena                                                             | Largura de conteúdo igual à área útil, sem transbordamento da página |
| Revisão independente                                                     | Dois problemas identificados, corrigidos e cobertos por regressão    |

As mensagens `ERR_SQLITE_ERROR` na suíte do backend são dos cenários de falha
exercitados; o processo terminou com sucesso e confirmou os testes.

## Proteções preservadas

- Vencimento Ecosol vazio em vínculo já salvo mantém a alternativa Equatorial.
- Correção manual persistida da UC prevalece sobre a sugestão antiga de extração.
- Histórico de usina/modalidade é consultado pela competência; memória salva é preservada.
- Salvar depende de prévia confirmada; o backend valida versão, hash e permissões.
- Aprovação não emite boleto nem envia comunicação.

## Limites da validação

O teste visual usou `frontend/testes/servidorCalculosVisual.mjs`, com respostas
simuladas e dados sintéticos em memória. As verificações de regras e persistência
foram executadas separadamente pela suíte real do backend em bancos temporários.
Não foi realizada homologação com sessão administrativa e faturas reais nesta
rodada. O PDF e a exportação Excel reutilizam as rotas existentes; abertura e
download não foram exercitados no cenário visual simulado.

# Diagramas BPMN do Sicoob

Os dois arquivos `.bpmn` são fontes editáveis para um modelador BPMN 2.0. Eles não são executados pelo Ecosol. Para leitura rápida, consulte o [PDF dos fluxos](../../../output/pdf/ecosol-sicoob-integracao-bpmn.pdf), que resume os processos em etapas e não é uma exportação automática destes arquivos.

| Arquivo                                                                    | Conteúdo                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [01-homologacao-sicoob.bpmn](01-homologacao-sicoob.bpmn)                   | Acesso de homologação, contrato oficial, configuração, teste e correção. |
| [02-cobranca-conciliacao-sicoob.bpmn](02-cobranca-conciliacao-sicoob.bpmn) | Aprovação, registro, rejeição, resultado incerto, consulta e liquidação. |

No desenho, as faixas mostram quem participa. Círculos marcam eventos, retângulos marcam tarefas e losangos mostram decisões. Setas contínuas indicam a ordem das atividades; setas tracejadas representam mensagens entre participantes.

O Sicoob aparece como participante externo. Suas etapas internas não foram presumidas: dependem do contrato oficial da API. O caminho inconclusivo leva à consulta e, se necessário, à revisão humana; ele não cria outro registro automaticamente.

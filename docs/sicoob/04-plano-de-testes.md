# Plano de testes e critérios de liberação

Data: 16/10/2026. Os testes abaixo são requisitos futuros, não resultados de uma integração Sicoob pronta.

## Ferramentas e isolamento

Reaproveitar os scripts Node existentes do projeto, assert, servidores locais e SQLite temporário (`mkdtemp` e `ECOSOL_DATA_DIR`) usados em `backend/testes/faturamento.test.mjs` e `permissoesAdministrativas.test.mjs`. Simular Sicoob com servidor HTTP local e respostas determinísticas. Homologação real será suíte separada, sem segredos no código ou logs.

Dados: contas de teste de duas empresas/ambientes, operadores e aprovadores distintos, cliente operacional e definitivo, valores limites, boleto duplicado, conta de consumo, retorno repetido e divergência de valor. Usar dados sintéticos apenas no ambiente de testes autorizado pelo banco.

## Matriz de testes

| ID / prioridade | Nível e preparação                                     | Ação                                                                                  | Resultado esperado / risco coberto                                                      |
| --------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| T01 P0          | Integração, usuário sem permissão/cliente/bootstrap    | Chamar cada endpoint bancário diretamente                                             | 401/403 e zero chamadas externas; não depender de botão oculto                          |
| T02 P0          | Integração, duas contas/CNPJs                          | Trocar ID de conta/operação/PDF                                                       | Negar acesso fora do escopo, sem vazamento                                              |
| T03 P0          | Integração, sessão antiga e token CSRF inválido        | Aprovar/configurar integração                                                         | Bloquear; exigir origem, CSRF e reautenticação válidos                                  |
| T04 P0          | Integração, perfis comuns e Proprietário               | Tentar autoaprovação e autoelevação; repetir como Proprietário com a senha financeira | Negar perfis comuns e autoelevação; permitir somente a exceção auditada do Proprietário |
| T05 P0          | Integração, aprovação válida                           | Alterar valor, conta, beneficiário, linha ou data; revogar papel antes do envio       | Invalidar autorização ou bloquear despacho                                              |
| T06 P0          | Integração, cadastro operacional/de teste              | Emitir cobrança de produção                                                           | Bloquear antes da chamada externa; cálculo continua disponível                          |
| T07 P0          | Integração, duas conexões/processos                    | Enviar mesma operação simultaneamente                                                 | Uma intenção; um despacho; resposta consistente para duplicata                          |
| T08 P0          | Resiliência, provedor aceita e conexão cai             | Reiniciar worker/repetir solicitação                                                  | Estado desconhecido e consulta; nenhum reenvio cego                                     |
| T09 P0          | Resiliência, provedor confirma e SQLite falha          | Retomar serviço                                                                       | Recuperar por correlação/consulta ou conferência manual sem duplicar                    |
| T10 P0          | Resiliência, worker com claim expirado após envio      | Outro worker assume tarefa                                                            | Conciliar antes de qualquer movimentação                                                |
| T11 P0          | Integração, callbacks simulados                        | Enviar evento falso, duplicado, fora de ordem e payload excessivo                     | Rejeitar inválido; aplicar evento uma vez; preservar estado final                       |
| T12 P0          | Integração, notificações ausentes                      | Rodar reconciliação por consulta                                                      | Recuperar liquidação e divergências usando identificador bancário                       |
| T13 P0          | Integração, 70 pagamentos, dois lotes concorrentes     | Reservar limite e simular êxito/falha parcial                                         | Respeitar limite atômico e resultado individual; desconhecido mantém reserva            |
| T14 P0          | Integração, conta Equatorial e beneficiário divergente | Preparar pagamento                                                                    | Encaminhar ao serviço correto e bloquear divergência não conferida                      |
| T15 P0          | Integração, certificados/segredos inválidos            | Chamar banco e inspecionar respostas/logs                                             | Pausar movimentações; nenhum segredo ou payload sensível exposto                        |
| T16 P0          | Recuperação, backup anterior à execução externa        | Restaurar e iniciar                                                                   | Executor parado até recuperar e conciliar operações bancárias                           |
| T17 P0          | Integração, API com resultado desconhecido             | Exportar mesma operação por CNAB                                                      | Bloquear mudança de canal e duplicidade                                                 |
| T18 P0          | Integração, boleto cancelado com liquidação tardia     | Processar retorno confirmado                                                          | Registrar dinheiro e divergência; não descartar nem confundir baixa com pago            |
| T19 P1          | Unidade/integração, centavos, juros e tarifas          | Converter e conciliar valores                                                         | Arredondamento explícito; bruto, tarifa e líquido separados                             |
| T20 P1          | Integração, 429/5xx e certificado expirado             | Executar fila                                                                         | Respeitar espera/limites; repetir só ações seguras                                      |
| T21 P1          | Migração, cópia temporária do legado                   | Aplicar migração e repetir                                                            | Preservar dados, detectar órfãos e não duplicar esquema                                 |
| T22 P1          | Carga simulada, 170 cobranças e 70 pagamentos          | Enfileirar e reiniciar durante processamento                                          | Nenhuma perda/duplicidade; registrar tempo, contenção SQLite e fila restante            |
| T23 P1          | Interface, funções separadas                           | Conferir, aprovar, cancelar, abrir comprovante                                        | Mensagens claras; sem sessão/permite indevida; segredo ausente no navegador             |
| T24 P1          | Segurança/recuperação, rotação de chave                | Ler histórico e retomar consultas                                                     | Recuperação protegida e rastreável, sem perder operações                                |

P0: obrigatório antes de dinheiro real. P1: obrigatório para aceite operacional; não é dispensa. No ensaio de carga, metas de latência final dependem do rate limit contratado. O teste local demonstra capacidade local, não disponibilidade do Sicoob.

## Evidência local e limites

Atualização de 22/10/2026: `npm run test:bancario` valida negação por padrão, papéis nominais, autoalteração proibida, autoaprovação exclusiva e auditada do Proprietário, snapshot, aprovação comum por pessoa diferente, criação concorrente idempotente, fila única, bloqueio após mudança da fatura, transição inválida e auditoria. O executor simulado acrescenta pausa, claim concorrente, sucesso, rejeição, repetição segura limitada, timeout antes/depois do aceite, consulta sem reenvio, posse expirada, revogação antes do despacho e persistência de artefatos de cobrança. O teste de contrato oficial exercita OAuth, inclusão e consulta contra servidor local sintético. Nenhuma dessas suítes substitui a homologação conectada ao Sicoob.

Executadas em 16/10/2026: `npm run test:permissoes` e `npm run test:faturamento`, ambas concluídas com código de saída 0. A primeira verificou níveis, primeiro administrador e hashes/exportações; a segunda verificou faturamento e identidade das UCs. Os erros SQLite impressos pelos cenários negativos não fizeram a suíte falhar. Esses resultados validam a base existente, não os cenários bancários ainda inexistentes.

Não executar pagamentos reais, testes de volume contra o banco, pentest externo, rotação de segredos reais ou restauração do banco de produção neste levantamento. Ambiente bancário, contrato de callbacks, limites aprovados e infraestrutura de produção ainda não foram validados.

## Portões de liberação

1. Contrato técnico oficial e capacidades da conta confirmados; responsáveis e limites definidos.
2. Permissões, aprovação, fila e recuperação implementadas; T01–T24 aprovados nos níveis aplicáveis, com testes de contrato em homologação.
3. TLS, armazenamento de segredos, monitoração, backup e restauração demonstrados no ambiente definitivo.
4. Homologação de faturamento SEJM-4 encerrada antes da emissão de cobranças reais; habilitação de pagamentos segue aceite próprio, sem herdar autorização de cobrança.
5. Piloto de produção autorizado com operações controladas e conferência bancária; expansão gradual após reconciliação. Homologação simulada não equivale a liquidação financeira real.

## Ordem de construção recomendada

Primeiro permissões bancárias e identidades nominais; depois snapshot/aprovação e persistência da fila; então adaptador Sicoob de consultas; emissão em homologação e recebimentos; por último saídas de dinheiro e recuperação completa. A documentação do contrato e a definição de responsáveis podem avançar em paralelo à base local.

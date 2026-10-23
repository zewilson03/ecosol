# Matriz proposta de permissões bancárias

Status em 23/10/2026: a emissão de cobrança foi separada da saída de dinheiro. Qualquer conta nominal da equipe pode preparar e enfileirar uma cobrança sem senha adicional. Pagamentos permanecem bloqueados até aprovação exclusiva do Proprietário, com senha atual e confirmação bancária recente. O envio real de pagamentos ainda não está implementado.

Negar por padrão. Adicionar permissões específicas ao usuário sem converter automaticamente todo nível 3 em aprovador bancário. Verificar permissão e escopo da conta/CNPJ no backend a cada ação. Cliente do portal não possui permissões bancárias; só pode consultar seus próprios documentos liberados.

| Ação                                          | Consulta/auditoria      | Operador financeiro     | Aprovador financeiro               | Administrador da integração   | Serviço automático              |
| --------------------------------------------- | ----------------------- | ----------------------- | ---------------------------------- | ----------------------------- | ------------------------------- |
| Consultar operações autorizadas               | Sim                     | Sim                     | Sim                                | Apenas diagnóstico necessário | Somente conciliação             |
| Preparar cobrança baseada em cálculo aprovado | Conta nominal da equipe | Conta nominal da equipe | Conta nominal da equipe            | Conta nominal da equipe       | Não                             |
| Solicitar emissão de cobrança validada        | Conta nominal da equipe | Conta nominal da equipe | Conta nominal da equipe            | Conta nominal da equipe       | Executar intenção idempotente   |
| Preparar/editar pagamento                     | Não                     | Sim                     | Não por atribuição automática      | Não                           | Não                             |
| Aprovar saída de dinheiro                     | Não                     | Não                     | Não                                | Não                           | Não                             |
| Executar pagamento aprovado                   | Não                     | Não diretamente         | Não diretamente                    | Não                           | Sim, após revalidar condições   |
| Solicitar cancelamento                        | Não                     | Sim                     | Autorizar quando aplicável à saída | Não                           | Executar solicitação autorizada |
| Configurar conta, segredo e ambiente          | Não                     | Não                     | Não                                | Sim, reautenticação recente   | Não                             |
| Conciliar divergência manual                  | Consultar               | Propor correção         | Confirmar correção justificada     | Não                           | Apenas evidências verificadas   |
| Exportar auditoria                            | Sim, permissão própria  | Não por padrão          | Não por padrão                     | Não por padrão                | Exportação protegida            |

Cobrança não movimenta saldo da Ecosol e não exige aprovação local nem senha adicional depois que a fatura foi calculada e aprovada no fluxo de faturamento. Pagamento representa saída de dinheiro: somente o perfil crítico **Proprietário** pode aprová-lo, ainda que outra pessoa o tenha preparado. A aprovação exige a senha de confirmação financeira cadastrada pelo Proprietário 1 e auditoria vinculada à conta nominal, à versão e ao hash do pagamento. Administrador da integração, Operador financeiro, Aprovador financeiro e Guardião não podem aprovar pagamentos. A autorização exigida pelo Sicoob não é substituída pela aprovação local.

## Regras da autorização

- Vincular aprovação a ID, versão, hash canônico do conteúdo, conta/CNPJ de origem, ambiente, beneficiário, documento do favorecido, linha digitável, valor em centavos e data de execução.
- Mudanças nesses dados invalidam a aprovação. Anexos substituídos também exigem revisão. Dados consultados do banco devem ser conferidos com os apresentados ao aprovador.
- Exigir uma nova digitação da senha financeira em cada aprovação de pagamento. O Proprietário 2 pode utilizá-la, mas somente o Proprietário 1 pode cadastrá-la, alterá-la ou recuperá-la.
- Antes do despacho, revalidar permissões, versão, aprovação, limites e situação da operação. Agendamento confirmado no banco mantém seu próprio ciclo; revogar usuário não cancela automaticamente um agendamento bancário.
- Reservar limites locais atomicamente para impedir dois lotes simultâneos ultrapassarem o limite. Operação com resultado desconhecido mantém a reserva até conciliação. Limites locais nunca aumentam o limite bancário.
- Operações mutantes do navegador exigem proteção CSRF explícita e origem esperada. Callbacks bancários ficam em rotas próprias com autenticação do provedor, sem depender de cookie ou de Origin do navegador.
- Bloquear usuário bootstrap, sessão expirada, conta fora do escopo, documentação de teste e ambiente inconsistente.
- Exibir documento mascarado em listagens; visualização completa e comprovantes limitados às funções necessárias. Não retornar credenciais, certificado privado ou saldo a usuários sem permissão.

## Configuração e operação

Credenciais de homologação e produção isoladas, URLs bancárias fixas/permitidas no servidor, chave bancária separada de Gmail, certificados fora do repositório e acesso restrito no sistema operacional. Não aceitar endpoint arbitrário enviado pelo navegador. Rotação com validação e alertas de expiração; revogação bloqueia novos despachos e preserva fila.

Hospedagem financeira exige HTTPS, configuração confiável de proxy, atualização do host e proteção do armazenamento. Chave e backup devem ter meios de recuperação separados. Mascarar logs por lista de campos permitidos; não serializar respostas bancárias ou erros inteiros.

## Definições que dependem da empresa/banco

Identificar pelo menos dois responsáveis; definir limites por operação, dia, usuário e conta; confirmar maior boleto individual; definir procedimento de ausência de aprovador. Até existir responsável habilitado, operação fica pendente: não haverá bypass automático. Confirmar mecanismo de autorização e limites concedidos pela cooperativa.

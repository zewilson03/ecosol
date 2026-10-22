# Matriz proposta de permissões bancárias

Status: base local implementada em 16/10/2026. Os quatro papéis, a negação por padrão, a gestão independente e a auditoria de concessão/revogação estão disponíveis. A escolha nominal dos responsáveis pela empresa e a reautenticação/MFA ainda são pendências anteriores ao uso real.

Negar por padrão. Adicionar permissões específicas ao usuário sem converter automaticamente todo nível 3 em aprovador bancário. Verificar permissão e escopo da conta/CNPJ no backend a cada ação. Cliente do portal não possui permissões bancárias; só pode consultar seus próprios documentos liberados.

| Ação                                          | Consulta/auditoria     | Operador financeiro       | Aprovador financeiro               | Administrador da integração   | Serviço automático              |
| --------------------------------------------- | ---------------------- | ------------------------- | ---------------------------------- | ----------------------------- | ------------------------------- |
| Consultar operações autorizadas               | Sim                    | Sim                       | Sim                                | Apenas diagnóstico necessário | Somente conciliação             |
| Preparar cobrança baseada em cálculo aprovado | Não                    | Sim                       | Não por atribuição automática      | Não                           | Não                             |
| Solicitar emissão de cobrança validada        | Não                    | Sim, permissão específica | Não por atribuição automática      | Não                           | Executar intenção autorizada    |
| Preparar/editar pagamento                     | Não                    | Sim                       | Não por atribuição automática      | Não                           | Não                             |
| Aprovar saída de dinheiro                     | Não                    | Não                       | Sim, outro usuário                 | Não                           | Não                             |
| Executar pagamento aprovado                   | Não                    | Não diretamente           | Não diretamente                    | Não                           | Sim, após revalidar condições   |
| Solicitar cancelamento                        | Não                    | Sim                       | Autorizar quando aplicável à saída | Não                           | Executar solicitação autorizada |
| Configurar conta, segredo e ambiente          | Não                    | Não                       | Não                                | Sim, reautenticação recente   | Não                             |
| Conciliar divergência manual                  | Consultar              | Propor correção           | Confirmar correção justificada     | Não                           | Apenas evidências verificadas   |
| Exportar auditoria                            | Sim, permissão própria | Não por padrão            | Não por padrão                     | Não por padrão                | Exportação protegida            |

O mesmo usuário pode acumular papéis quando necessário, mas a autoaprovação é proibida para todos os perfis comuns. A única exceção é o perfil crítico **Proprietário**, limitado a duas contas nominais: ele pode preparar e aprovar a própria operação, desde que use MFA ativo, confirmação bancária recente e aceite explícito, ficando a exceção registrada em tabela e auditoria próprias. O Administrador da integração, o Operador financeiro, o Aprovador financeiro e o Guardião de recuperação não recebem essa exceção. A criação ou elevação de um aprovador continua exigindo controle independente; ninguém pode conceder a si mesmo poder financeiro. A autorização exigida pelo Sicoob não é substituída pela aprovação local.

## Regras da autorização

- Vincular aprovação a ID, versão, hash canônico do conteúdo, conta/CNPJ de origem, ambiente, beneficiário, documento do favorecido, linha digitável, valor em centavos e data de execução.
- Mudanças nesses dados invalidam a aprovação. Anexos substituídos também exigem revisão. Dados consultados do banco devem ser conferidos com os apresentados ao aprovador.
- Usar prazo curto para o desafio de reautenticação (proposta: cinco minutos, distinto do agendamento). Exigir MFA na aprovação e na administração de credenciais; escolher mecanismo na implementação.
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

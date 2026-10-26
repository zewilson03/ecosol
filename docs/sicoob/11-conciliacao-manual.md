# Conciliação manual — terceira entrega

Atualizado em: 22/10/2026.

## Objetivo

Permitir que um administrador da integração consulte novamente uma cobrança pendente sem emitir outro boleto. Nesta entrega, o comando funciona exclusivamente com o simulador local em ambiente de homologação. A integração real continua bloqueada.

## Fluxo

1. A central identifica uma operação com resultado desconhecido ou conciliação pendente de recuperação/revisão.
2. A interface apresenta o comando somente ao papel `administrador_integracao` e somente quando há identificador do provedor.
3. O backend exige sessão nominal, papel autorizado, origem confiável e confirmação recente pela senha da equipe.
4. O serviço abre uma posse exclusiva para a operação e registra a identidade do solicitante na auditoria.
5. O adaptador realiza apenas uma consulta. Nenhum registro de cobrança (`POST`) é executado.
6. O retorno é conferido contra o identificador já persistido. Divergência ou ausência de confirmação permanece inconclusiva.
7. Uma liquidação confirmada nunca volta para registrada. Após o resultado, a central é recarregada.

## Estados e recuperação

- `resultado_desconhecido` pode avançar para `registrada` ou `liquidada` após confirmação compatível;
- `registrada` pode avançar para `liquidada`, mas nunca o inverso;
- uma conciliação ativa bloqueia outra tentativa concorrente;
- uma posse expirada é encerrada como inconclusiva antes da nova consulta;
- a resposta atrasada do processo que perdeu a posse é ignorada;
- indisponibilidade gera tentativa falha auditável sem alterar o estado financeiro;
- identificador divergente gera `CONCILIACAO_PROVEDOR_DIVERGENTE` e não altera a cobrança.
- valor pago inferior ou superior ao valor esperado permanece inconclusivo e exige revisão;
- estorno observado não rebaixa automaticamente uma cobrança liquidada;
- repetir a consulta de uma liquidação confirmada preserva um único estado financeiro, mantendo o histórico de consultas.

## Segurança e privacidade

- autorização é repetida no backend; ocultar o botão não é controle de acesso;
- toda mutação exige a prova temporária de confirmação bancária;
- o modo real e produção são recusados nesta entrega;
- a resposta ao navegador contém somente resultado, estado anterior, estado atual e código categorizado;
- snapshot, idempotência, `nossoNumero`, token, certificado, CPF e payload do provedor não são devolvidos;
- a auditoria associa a solicitação ao usuário nominal e preserva a auditoria técnica do serviço.
- cada usuário pode iniciar no máximo cinco consultas da mesma cobrança em quinze minutos;
- o histórico visível mostra somente autoria, horário, tentativa, estados e código categorizado.

## Critérios de aceite

- somente `administrador_integracao` pode iniciar a conciliação;
- confirmação recente pela senha da equipe é obrigatória;
- consulta sem identificador do provedor é recusada antes do adaptador;
- não existe reemissão de cobrança no fluxo;
- concorrência, posse expirada e resposta atrasada são tratadas de forma idempotente;
- divergência não altera o estado financeiro;
- liquidação não sofre regressão;
- falha externa mantém estado anterior e deixa registro auditável;
- central é atualizada após sucesso ou falha;
- antes da autenticação, a interface exige confirmação do valor, vencimento, estado e operação local;
- indisponibilidade, limite, concorrência, ausência, divergência e perda de posse possuem mensagens distintas;
- modo diferente de simulador/homologação é bloqueado;
- testes bancários e build do frontend passam.

## Próximo limite

A substituição do simulador pelo adaptador real exige contrato oficial validado em homologação, configuração segura de OAuth/mTLS, dados sintéticos aceitos pelo Sicoob e autorização operacional específica. O bloqueio atual não deve ser removido apenas porque credenciais ficaram disponíveis.

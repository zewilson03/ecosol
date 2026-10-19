# Plano de trabalho — 20/10/2026

## Objetivo do dia

Deixar a integração Sicoob pronta para receber os dados oficiais de homologação, sem emitir boletos reais nem ativar produção. Encerrar a revisão do código e obter a aprovação de José antes de qualquer commit.

## Sequência

1. **Revisão do commit proposto.** Conferir o diff staged, a exclusão de `output/calculos-validacao-2026-10-14.jpg` (fora do escopo e não staged), a documentação e os testes. José aprova o conteúdo antes do commit. Nenhum push ou implantação faz parte desta etapa.
2. **Segurança bancária.** Validar a chave `BANCARIO_MFA_ENCRYPTION_KEY` em armazenamento seguro, com cópia protegida fora do computador. Criar as contas nominais de Victor e Veygna somente com identidade e credenciais conferidas; obter o e-mail nominal do Guardião Matheus. Atribuir papéis críticos apenas após verificação humana. Cada pessoa ativa o próprio MFA, guarda os códigos e participa de um ensaio presencial de recuperação. Definir e confirmar o canal de notificação do titular antes de usar a recuperação excepcional na operação.
3. **Contrato oficial Sicoob.** Quando o banco entregar a documentação e as credenciais, confirmar versão da API, endpoints de homologação, método OAuth, escopos, mTLS/certificado, identificador da cobrança, chave idempotente, consulta, cancelamento, PDF e limites. Não supor campos ou URLs nem guardar segredos no repositório. Até lá, manter o executor desligado e a fila pausada.
4. **Ensaios pré-token.** Rodar `npm.cmd run test:bancario`, `npm.cmd run test:exportacao-clientes`, `npm.cmd run test:permissoes`, `npm.cmd run test:seguranca`, `npm.cmd run build` e `npm.cmd run format:check`. Revisar duplicidade, concorrência, timeout, resposta desconhecida, persistência, reconciliação, reversão e auditoria. Exercitar no navegador a exportação de clientes com nível 3, a negativa em nível inferior e os caminhos de recuperação MFA.
5. **Decisão de avanço.** Registrar evidências e pendências no Jira. Só iniciar a homologação conectada após contrato oficial, configuração segura, contas nominais e aprovação humana do plano. A emissão real permanece fora de escopo até autorização separada.

## Pendências que não devem ser ocultadas

- Nenhuma conta nominal de Victor ou Veygna foi encontrada no banco local em 19/10/2026; não atribuir papéis críticos a terceiros por aproximação de nome.
- O e-mail nominal do Guardião ainda não foi informado.
- Não existe canal previamente confirmado para notificar o titular após recuperação excepcional; o código registra o evento, mas não envia aviso.
- Passkeys resistentes a phishing dependem de domínio HTTPS definitivo; em `localhost` só cabe ensaio local.
- O adaptador Sicoob está preparado para receber contratos oficiais, mas não contém mapeamento bancário inventado nem credenciais; a integração real não está homologada.

## Critérios de aceite para encerrar o dia

- Diff do commit proposto inspecionado por José, sem segredos, dados pessoais exportados nem exclusões acidentais.
- Testes e build registrados com resultado observado; falhas permanecem abertas, não são tratadas como sucesso.
- Executor bancário continua desligado/pausado; nenhuma operação real enviada.
- Dependências externas e responsáveis visíveis no Jira, com prioridades coerentes.

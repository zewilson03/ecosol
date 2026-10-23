# Senha de confirmação das ações bancárias

## Regra adotada

O Ecosol não exige aplicativo autenticador para o módulo bancário. Cobranças podem ser preparadas e enfileiradas por qualquer conta nominal da equipe sem senha financeira adicional. Pagamentos representam saída de dinheiro e somente podem ser aprovados por uma conta com o papel crítico **Proprietário**, mediante nova digitação da senha de confirmação financeira.

Existe uma única senha financeira para a empresa:

- o **Proprietário 1** é o primeiro Proprietário vigente pelo registro de concessão do papel e é o único que pode cadastrar, alterar ou recuperar a senha;
- o **Proprietário 2** pode utilizar a mesma senha para aprovar pagamentos, mas não pode consultá-la, trocá-la nem iniciar sua recuperação;
- a senha nunca é armazenada ou registrada em texto; o banco conserva apenas um hash `scrypt` com sal;
- cada aprovação registra a conta nominal que efetivamente utilizou a senha, a versão e o hash imutável do pagamento;
- a perda do papel Proprietário invalida a autorização para novas aprovações e para o envio de pagamentos ainda não executados.

## Recuperação

O Proprietário 1 solicita a recuperação em sua própria sessão autenticada. O sistema envia ao e-mail nominal dele uma senha temporária aleatória de seis dígitos, válida por 15 minutos e utilizável uma única vez. Senhas temporárias anteriores são invalidadas quando uma nova é emitida. Depois de confirmá-la, o Proprietário 1 cadastra uma nova senha financeira.

Em desenvolvimento, a mensagem é gravada em `dev_mail`. Em produção, o envio usa as configurações SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` e `SMTP_FROM`). Para usar Gmail, deve-se configurar uma conta Gmail dedicada com senha de aplicativo no SMTP; a conexão atual de leitura de faturas não possui permissão de envio e não é reutilizada.

Solicitação e validação têm limitação de tentativas. A senha temporária e a senha permanente não aparecem na auditoria. A auditoria registra somente os eventos de cadastro, alteração, solicitação e conclusão da recuperação.

## Outras ações sensíveis

Administração do executor e conciliação manual continuam exigindo a senha de login atual da conta nominal, com confirmação temporária vinculada à sessão e proteção de origem. Elas não usam a senha financeira compartilhada. MFA deixou de fazer parte desse fluxo.

## Limites e risco aceito

A senha única reduz a proteção contra phishing, compartilhamento indevido e comprometimento simultâneo dos dois Proprietários. Esse risco é uma decisão operacional explícita. Permanecem obrigatórios: HTTPS em produção, contas nominais, sessões individuais, limitação de tentativas, auditoria, idempotência, reconciliação e separação das credenciais Sicoob.

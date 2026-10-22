# Segurança, credenciais e host

## Segredos

Tokens, client secret, certificado, chave privada, passphrase e chave de MFA ficam fora do Git, do SQLite comum, de logs, erros e diagnósticos. Diagnósticos mostram somente presença, validade, ambiente e identificadores mascarados.

## OAuth e mTLS

Confirme menor escopo possível, cache apenas em memória, renovação concorrente única, invalidação após `401`, TLS validado e HTTP permitido somente em teste local. Certificado e chave usam ACL mínima, usuário de serviço sem privilégio e rotação planejada com alertas em 60, 30, 15 e 7 dias.

## Host

Considere que um invasor com controle do servidor pode usar credenciais válidas. Recomende conta de serviço, firewall de saída, isolamento do executor, atualizações, monitoramento de integridade, cofre de segredos e desligamento emergencial.

## Identidade

MFA TOTP reduz risco, mas não impede phishing em tempo real. Após domínio HTTPS definitivo, priorize WebAuthn/passkeys para Proprietários e ações críticas. Monitore relógio/NTP porque MFA, tokens, leases e expirações dependem dele.

Nunca aceite a desativação de TLS, autorização ou MFA para fazer homologação passar.

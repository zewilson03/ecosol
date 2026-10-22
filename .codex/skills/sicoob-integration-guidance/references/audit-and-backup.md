# Auditoria, artefatos e backup

## Auditoria

Registre ator, papel, sessão/correlação, ação, versão, estado anterior e novo, horário e código controlado. Não registre token, segredo, CPF completo ou payload bancário. Diferencie ação humana, serviço e recuperação automática.

O SQLite e sua auditoria compartilham o mesmo domínio de comprometimento. Para maior garantia, proponha encadeamento por hash e exportação periódica para armazenamento separado e imutável.

## Artefatos

Linha digitável, código de barras, QR Code e PDF pertencem a uma operação e identificador externo específicos. Preserve hash, impeça substituição divergente e proteja leitura no backend. Downloads usam autorização, identificador não enumerável, `Cache-Control: no-store` e trilha de acesso.

## Backup

Backups devem ser cifrados, ter acesso mínimo, hash de integridade, retenção definida e chave separada. Teste restauração incluindo o cenário em que o Sicoob concluiu uma operação e o estado local foi perdido. Nunca considere backup existente sem observar uma restauração bem-sucedida.

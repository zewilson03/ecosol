# Postman Sicoob — homologacao

Esta estrutura prepara somente a obtencao do token OAuth. Ela nao emite boleto,
nao consulta conta e nao executa pagamento.

## Dados que o responsavel deve adicionar

No ambiente `Sicoob - Homologacao`, preencha localmente:

- `sicoob_oauth_token_url`;
- `sicoob_api_base_url`;
- `sicoob_client_id`;
- `sicoob_client_secret`, somente se o contrato exigir;
- `sicoob_scope`.

Use o Postman Vault para `client_id` e `client_secret` quando a equipe usar um
workspace compartilhado. Nao grave valores reais nos arquivos YAML.

## Certificado mTLS

O certificado de cliente pertence a configuracao local do Postman e nao pode ser
incluido com seguranca na colecao:

1. Abra **Settings > Certificates > Add Certificate**.
2. Informe no campo **Host** apenas o host de `sicoob_oauth_token_url`, sem
   protocolo e sem caminho.
3. Selecione o certificado e a chave privada, ou o arquivo PFX/P12, conforme o
   material entregue pelo Sicoob.
4. Informe a passphrase somente no campo protegido do Postman.

Nao copie certificado, chave privada ou passphrase para este repositorio.

## Requisicao correta

- Use `OAuth - client secret` se o Portal Sicoob confirmar client secret.
- Use `OAuth - mTLS sem client secret` se o contrato autenticar a aplicacao por
  certificado e client ID sem segredo.
- Nao teste as duas por tentativa. Confirme o contrato no Portal Developers.

O token aparece somente na resposta da requisicao e nao e persistido por scripts
da colecao. Nao o copie para arquivo, Jira, log, e-mail ou conversa.

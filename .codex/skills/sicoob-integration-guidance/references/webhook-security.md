# Segurança de webhooks

Antes de implementar, confirme no contrato oficial como o Sicoob autentica notificações. Não invente assinatura, certificado ou cabeçalho.

Exija limite de corpo, autenticação antes do processamento, comparação segura, proteção contra replay, identificador único, hash do evento e persistência idempotente. Responda rapidamente e processe em fila com claim e prazo.

Um webhook é aviso, não única prova financeira. Para liquidação, pagamento, cancelamento ou devolução, reconcilie com consulta oficial. Eventos duplicados ou fora de ordem não podem regredir estado. Registre somente metadados necessários e nunca o payload sensível integral em log.

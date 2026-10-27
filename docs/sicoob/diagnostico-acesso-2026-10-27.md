# Diagnóstico de acesso — 27/10/2026

## Correção confirmada

O adaptador de cobrança não enviava `client_id` no cabeçalho HTTP. A composição
agora fornece o identificador configurado ao adaptador, que o envia tanto na
inclusão quanto na consulta. O diagnóstico de saúde também o envia. O token
continua exclusivamente em memória e no cabeçalho de autorização.

Fonte: coleção oficial vinculada pelo Portal Developers, API Cobrança Bancária V3:
https://d1zet1fng6kfaw.cloudfront.net/postman-collections/386bf6bc7598c289e2011e2f31c0d31b-API-Cobranca-Bancaria-Sicoob-V3-3.postman_collection

## Evidências e limites

- Teste local `sicoobContratosOficiais.test.mjs`: HTTP real contra servidor
  simulado local, exigindo o cabeçalho na saúde, inclusão e consulta.
- Teste local `sicoobPreToken.test.mjs`: aprovado, incluindo proteção de
  ambientes, OAuth, concorrência e falhas HTTP.
- Consulta real somente leitura: token obtido; `/health` respondeu `UP`.
- Nenhuma inclusão, pagamento ou alteração bancária executada nesta validação.
- Cinco registros locais anteriores do piloto estavam rejeitados com código
  `5002`, sem identificador do boleto. Esse código isolado não demonstra que
  o número cliente esteja errado, nem comprova a causa da rejeição.

## Pendências antes de nova emissão

1. A configuração carregada se identifica como `homologacao`, mas aponta para
   `api.sicoob.com.br`. Separar explicitamente ambiente e credenciais antes de
   executar nova operação financeira. Não confundir o rótulo com sandbox.
2. Confirmar o vínculo aplicativo/beneficiário/contrato por consulta autorizada
   de um título conhecido ou confirmação do Sicoob. OAuth e saúde não validam
   `numeroCliente`. Não testar números aleatórios nem emitir para descobri-lo.
3. Não presumir que o código do contrato seja `numeroContratoCobranca`: a
   documentação V3 informa que esse campo é opcional e destinado a contrato
   secundário, sob orientação específica da cooperativa.
4. Revisar o executor do piloto: retirar a cópia implícita de configuração de
   homologação para produção; proteger execução concorrente; persistir sucesso
   do registro antes de consultar, preservando-o se a consulta posterior falhar.

A correção do cabeçalho elimina uma divergência objetiva com o contrato HTTP;
não constitui confirmação de que a emissão em produção foi liberada.

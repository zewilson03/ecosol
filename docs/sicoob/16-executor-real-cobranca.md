# Executor real de cobrança Sicoob

Atualização de 27/10/2026.

## Implementação

O executor bancário modular aceita agora o modo `sicoob`, que compõe o mesmo
adaptador da Cobrança Bancária V3 validado nos testes de contrato. A ativação
exige simultaneamente:

- `BANCARIO_EXECUTOR_MODO=sicoob`;
- `SICOOB_AMBIENTE=producao`;
- `NODE_ENV=production`;
- `SICOOB_PRODUCAO_HABILITADA=SIM`;
- configuração completa sob o prefixo `SICOOB_PRODUCAO_`.

Mesmo com esses portões, o executor respeita o controle persistido da fila. Uma
fila pausada não despacha cobrança. Retomar a fila continua sendo uma ação
autorizada, confirmada e auditada no backend.

O modo `simulado` permanece restrito ao ambiente de homologação. Não há cópia
automática de segredos ou parâmetros entre ambientes.

## Evidência local

O teste `executorSicoobReal.test.mjs` comprova que ambiente incorreto e produção
não habilitada falham antes da composição, e que a configuração válida injeta o
adaptador real sem efetuar despacho no teste. A suíte bancária cobre ainda claim,
concorrência, resultado desconhecido, consulta de recuperação, falha permanente,
persistência de artefatos e pausa operacional.

## Ativação pendente

A implementação não confirma por si só o vínculo do Client ID ao beneficiário e
ao produto contratado. Antes de retirar a pausa, deve ser executado um único
piloto autorizado, seguido de consulta e conciliação manual. Falha inconclusiva
deve ser consultada; nunca se repete a emissão para tentar garantir o resultado.

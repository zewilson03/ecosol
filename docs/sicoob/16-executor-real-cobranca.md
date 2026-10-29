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

## Revisão de 28/10/2026

`test:bancario`, `test:implantacao` e `build` passaram localmente. Isso valida o
comportamento testado com provedores simulados e a composição do adaptador,
mas não confirma acesso bancário de produção. O arquivo de configuração local
tem apenas chaves de homologação; não foi ativado o modo real nem feita chamada
de emissão nesta revisão. Permanecem necessários a configuração de produção
separada, a confirmação do convênio, um piloto único autorizado e a consulta
confirmatória antes de ampliar o uso.

A [coleção oficial da Cobrança Bancária V3](https://d1zet1fng6kfaw.cloudfront.net/postman-collections/386bf6bc7598c289e2011e2f31c0d31b-API-Cobranca-Bancaria-Sicoob-V3-3.postman_collection)
estava acessível em 28/10/2026 e lista inclusão, consulta, segunda via,
alteração e baixa. A busca pública complementar não trouxe um contrato Sicoob
equivalente; a coleção oficial permanece a referência. A disponibilidade da
coleção não comprova permissões efetivas do convênio Ecosol.

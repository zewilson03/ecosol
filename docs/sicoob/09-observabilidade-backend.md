# Observabilidade bancária — primeira entrega

Atualizado em: 22/10/2026.

## Escopo

A primeira entrega expõe somente leitura pelo endpoint `GET /api/admin/bancario/observabilidade`. Ela não chama o Sicoob, não altera estados, não recupera conciliações, não enfileira operações e não despausa o executor.

O acesso exige um dos papéis:

- `consulta_auditoria`;
- `administrador_integracao`.

O parâmetro opcional `limite` aceita inteiros de 1 a 200 e usa 50 por padrão.

## Conteúdo seguro

A resposta contém:

- ambiente e situação do executor;
- contagem de operações, intenções e conciliações por estado;
- identificador interno da operação;
- tipo, moeda, valor em centavos, vencimento e estado;
- idade do estado;
- presença, mas nunca valor, do identificador do provedor;
- resultado categorizado da última tentativa;
- situação da última conciliação;
- ação necessária e prioridade operacional.

A resposta não contém snapshot, chave de idempotência, `nossoNumero`, linha digitável, código de barras, PDF, nome, CPF/CNPJ, contato, token, certificado, segredo ou payload do Sicoob. Códigos fora do formato controlado são omitidos.

## Critérios de aceite observados

- Usuário sem papel de auditoria ou integração recebe `403`.
- Auditor e administrador da integração recebem a visão consolidada.
- Operações terminais sem pendência de conciliação não aparecem na lista de intervenção, mas permanecem nas contagens.
- Resultado desconhecido é classificado para conciliação com prioridade alta.
- Conciliação inconclusiva é classificada para revisão.
- A idade é calculada no backend e nunca fica negativa.
- O limite inválido é rejeitado com `400`.
- Conteúdo sensível sem formato de código não é devolvido.
- A resposta usa `Cache-Control: no-store`.
- A consulta não produz efeito financeiro ou chamada externa.

## Metodologia

Foi usada uma projeção de leitura explícita sobre as tabelas bancárias, em vez de serializar entidades completas. As informações são agregadas no backend, onde autorização e classificação permanecem confiáveis. A implementação segue menor privilégio, minimização de dados, estados financeiros explícitos e separação entre observação e ação.

## Fora desta entrega

- tela administrativa;
- filtros visuais e paginação por cursor;
- consulta manual ao Sicoob;
- recuperação acionada pelo usuário;
- alertas externos e métricas históricas;
- executor Sicoob real.

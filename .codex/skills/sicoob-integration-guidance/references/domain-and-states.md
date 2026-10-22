# Domínio, estados e reconciliação

## Operações

Trate cobrança, cancelamento, pagamento, recebimento, devolução e Pix como domínios distintos. Para cada um, identifique moeda, escala, arredondamento, origem imutável, versão, identificador local, identificador externo e estado terminal.

## Invariantes

- Uma chave idempotente representa uma única versão imutável da operação.
- Alterar valor, vencimento, favorecido ou documento cria nova versão e invalida aprovação anterior.
- Só repetir quando o contrato oficial garantir segurança ou uma consulta provar que não houve efeito.
- Sucesso externo com falha local exige reconciliação, não novo envio.
- Resultado não encontrado não equivale automaticamente a rejeição definitiva.
- Liquidação confirmada não regride para registrada.

## Falhas a analisar

Inclua duplicidade, concorrência, timeout antes e depois do aceite, resposta perdida, `401`, `403`, `429`, `5xx`, resposta malformada, identificador divergente, persistência local falhando, reinício e posse expirada.

Claims de processamento precisam de proprietário, prazo e recuperação auditada. Uma execução recuperada consulta o provedor antes de considerar qualquer reenvio.

## Conciliação

Compare identificador, conta/convênio, valor, vencimento e estado quando o contrato oficial os fornecer. Registre correlação, resultado categorizado e transição local sem persistir payload sensível. Divergências ficam para intervenção humana e nunca sobrescrevem silenciosamente dados confirmados.

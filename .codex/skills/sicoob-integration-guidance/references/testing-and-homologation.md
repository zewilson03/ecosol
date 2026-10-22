# Testes, homologação e ativação

## Matriz mínima

Cubra caminho normal, entrada inválida, autorização negada, duplicidade, concorrência, timeout antes/depois do aceite, `401`, `403`, `429`, `5xx`, resposta malformada, identificador divergente, falha de persistência, reinício, claim expirado, resposta grande, PDF inválido e recuperação com executor pausado.

Use banco temporário, credenciais sintéticas e servidor falso. Testes automatizados nunca chamam produção. Homologação real exige autorização explícita e dados aceitos pelo ambiente do Sicoob.

## Ativação

Antes do piloto: credenciais fora do Git, certificado válido, escopos e convênio confirmados, backup e restauração testados, monitoramento ativo, limites definidos, executor pausado e plano de desligamento. Comece com poucas operações, acompanhe manualmente e reconcilie todas antes de ampliar.

Relate comandos realmente executados e seus resultados. Não declare validação de produção com base apenas em mocks.

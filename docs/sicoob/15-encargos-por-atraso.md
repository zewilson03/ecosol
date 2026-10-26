# Encargos por atraso incorporados ao boleto seguinte

## Regra vigente

- As primeiras 24 horas após o vencimento são uma tolerância sem encargos.
- A partir do segundo dia corrido de atraso, aplica-se uma única multa de 3% sobre o principal vencido.
- Os juros são simples e proporcionais: 1,5% ao mês dividido por 30, equivalente a 0,05% por dia tarifado.
- Dias tarifados correspondem aos dias corridos de atraso menos a tolerância inicial de um dia.
- Multa e juros são arredondados separadamente para centavos com `ROUND_HALF_UP`.
- O boleto vencido não é alterado. Os encargos são adicionados ao próximo boleto da mesma UC.

## Integridade financeira

Cada encargo mantém o vínculo entre a operação vencida e a operação de destino, com principal, vencimento, data de referência, dias de atraso, dias tarifados, multa, juros e regra utilizada. Uma cobrança vencida só pode possuir uma aplicação ativa, evitando duplicidade em reprocessamentos concorrentes ou idempotentes.

Se o boleto de destino for rejeitado ou cancelado, a aplicação é preservada como liberada. Enquanto a cobrança de origem continuar registrada e vencida, o encargo poderá ser incorporado à cobrança substituta. Boletos liquidados, cancelados, rejeitados ou com resultado ainda desconhecido não originam novos encargos automáticos.

## Fórmula

```text
dias_atraso = data_referencia - vencimento

se dias_atraso <= 1:
  multa = 0
  juros = 0

se dias_atraso > 1:
  dias_juros = dias_atraso - 1
  multa = principal × 3%
  juros = principal × (1,5% ÷ 30) × dias_juros
```

O valor enviado ao Sicoob é a soma do valor-base aprovado para o boleto seguinte com todos os encargos elegíveis e ainda não aplicados daquela UC. A memória aprovada da fatura permanece imutável; a composição adicional fica congelada no snapshot da operação bancária.

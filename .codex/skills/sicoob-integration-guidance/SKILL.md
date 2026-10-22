---
name: sicoob-integration-guidance
description: Orientar e revisar a integração Sicoob do Ecosol em cobranças, pagamentos, recebimentos, relatórios e Pix, usando contratos oficiais e controles financeiros seguros.
---

# Orientação da integração Sicoob

## Resultado esperado

Produza uma orientação verificável que preserve confidencialidade, autorização, idempotência, rastreabilidade e recuperação. Não execute efeitos financeiros nem transforme hipótese sobre o provedor em contrato.

## Fluxo essencial

1. Delimite operação, ambiente, ativos, atores, entradas e efeitos externos.
2. Leia o código e a documentação interna aplicáveis antes de recomendar mudanças.
3. Confirme comportamento externo em fonte oficial atual; registre versão e data.
4. Trace estados locais e externos, autorização, idempotência, falhas parciais e recuperação.
5. Separe fato confirmado, inferência, decisão do Ecosol, risco e dependência pendente.
6. Entregue recomendação proporcional, critérios de aceite, testes e próximo passo.

## Regras invariantes

- Nunca receber, mostrar, registrar ou versionar segredos bancários.
- Nunca sugerir repetição cega após resultado externo inconclusivo.
- Consulta e reconciliação precedem nova tentativa quando não há prova de falha anterior segura.
- Estados financeiros não regridem sem evento de domínio explícito; uma liquidação confirmada não volta a aberta.
- Somente o Proprietário pode autoaprovar. Demais casos exigem aprovador distinto.
- A interface não substitui autorização no backend.
- Homologação e produção usam configurações, credenciais e dados separados.
- Dados fictícios ficam restritos a testes temporários e homologação autorizada.

## Roteamento de referências

- Para estados, idempotência e conciliação, leia [domain-and-states.md](references/domain-and-states.md).
- Para endpoints, escopos e contratos externos, leia [official-api-routing.md](references/official-api-routing.md).
- Para OAuth, mTLS, chaves, host e phishing, leia [security-and-secrets.md](references/security-and-secrets.md).
- Para autoaprovação, fraude interna e alterações de favorecido, leia [fraud-and-insider-risk.md](references/fraud-and-insider-risk.md).
- Para callbacks e notificações, leia [webhook-security.md](references/webhook-security.md).
- Para evidências, PDFs, logs e restauração, leia [audit-and-backup.md](references/audit-and-backup.md).
- Para testes, piloto e ativação, leia [testing-and-homologation.md](references/testing-and-homologation.md).
- Para suspeita de comprometimento ou divergência financeira, leia [incident-response.md](references/incident-response.md).

## Formato da resposta

Apresente, conforme necessário: escopo; fatos confirmados e fontes; comportamento atual; achados classificados; recomendação; critérios de aceite; testes; dependências; limites; próximo passo. Classifique observações como vulnerabilidade confirmada, risco arquitetural, hardening, dependência operacional ou funcionalidade ainda não implementada.

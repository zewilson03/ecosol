# Extrato da Conta Corrente Sicoob

Revisão do contrato oficial e decisão arquitetural em 26/10/2026.

## Contrato confirmado

- Produto: Conta Corrente, versão 4.
- URL-base: `https://api.sicoob.com.br/conta-corrente/v4`.
- Operação: `GET /extrato/{mes}/{ano}`.
- Escopo OAuth habilitado no aplicativo Ecosol: `cco_consulta`.
- Cabeçalho obrigatório: `client_id`.
- Consulta obrigatória: `numeroContaCorrente`.
- Filtros opcionais: `diaInicial`, `diaFinal` e `agruparCNAB`.
- Resposta de sucesso: saldos e uma lista de transações com identificador,
  tipo, valor, data, descrição, número de documento, CPF/CNPJ e informação
  complementar.
- Respostas documentadas: `200`, `400` e `500`. A integração também trata
  `401`, `403` e `429` de maneira defensiva por serem respostas possíveis na
  fronteira HTTP/OAuth.
- Limite oficial da API Conta Corrente: 2 requisições por segundo.

Fontes oficiais:

- <https://developers.sicoob.com.br/portal/apis>
- <https://developers.sicoob.com.br/portal/documentacao?slugItem=seguranca&slugSubItem=autenticacao>
- <https://developers.sicoob.com.br/portal/documentacao?slugItem=seguranca&slugSubItem=1>

O aplicativo `ECOSOL .SYS` aparece no Portal Developers como ativo para a API
Conta Corrente. Cooperativa, conta, Client ID, certificado, passphrase e tokens
não são registrados neste documento nem no Git.

## Decisão arquitetural

Foi mantido o monólito modular. Criar um microserviço apenas para o extrato
introduziria uma segunda implantação, comunicação de rede interna, propagação
de identidade, nova observabilidade e acesso adicional ao certificado mTLS.
Esses custos não são compensados enquanto pagamentos, autenticação, auditoria
e SQLite pertencem ao mesmo processo.

A implementação preserva uma fronteira extraível:

1. `contaCorrenteSicoob.mjs` conhece somente o contrato externo.
2. `extratoBancario.mjs` coordena o caso de uso financeiro.
3. A rota administrativa expõe um contrato interno estável para a interface.
4. A tela não conhece URLs, tokens nem nomes de campos privados do Sicoob.

Se volume, disponibilidade ou equipe exigirem independência operacional, o
módulo pode ser extraído atrás do mesmo contrato interno. Antes disso seria
necessário substituir o SQLite compartilhado por uma integração explícita e
definir autenticação serviço-a-serviço, fila/reconciliação, observabilidade,
implantação e gestão isolada de segredos.

## Controles aplicados

- Consulta disponível somente para equipe autenticada de nível 2 ou superior.
- Operação exclusivamente `GET`, iniciada manualmente; não altera o banco.
- OAuth e mTLS permanecem exclusivamente no backend.
- Renovação de token ocorre uma única vez após `401`.
- As chamadas são enfileiradas com intervalo mínimo de 500 ms, inclusive entre
  a resposta `401` e sua única repetição autorizada.
- `429` preserva `Retry-After`; falhas externas não são repetidas em laço.
- Resposta é validada por tamanho, tipos, datas e valores decimais.
- CPF/CNPJ é mascarado antes de sair do backend.
- Nenhum payload integral do extrato é persistido ou registrado em log.

## Limite desta entrega

O extrato é exibido para conferência, mas ainda não efetua conciliação automática
com as solicitações de pagamento. Essa etapa deverá usar regras explícitas e
auditáveis; coincidência apenas por data e valor não poderá dar baixa automática.

# Integração real Ecosol–Sicoob e homologação

> Documento principal para leitura: [PDF visual com BPMN e roteiro de homologação](../../output/pdf/ecosol-sicoob-integracao-bpmn.pdf).
>
> Este arquivo mantém o detalhamento técnico. Os arquivos `.bpmn` são modelos editáveis/importáveis; o PDF apresenta um resumo visual, não uma exportação automática desses arquivos.

Status: **contratos oficiais de OAuth e Cobrança v3 implementados localmente; aguardando configuração e homologação conectada**.

Atualizado em: 22/10/2026.

Este documento transforma o levantamento anterior em uma entrega operacional para a homologação. Ele não autoriza emissão nem pagamento real. O executor bancário continua desligado e a fila bancária permanece pausada até todos os portões de liberação serem aprovados.

## Objetivo e escopo

O Ecosol deverá emitir e acompanhar cobranças dos clientes, registrar pagamentos recebidos e, em etapa independente, preparar e acompanhar pagamentos a fornecedores. A integração será feita pela API oficialmente habilitada para a conta da Ecosol no Sicoob.

Cobrança e pagamento não compartilham autorização de produção: cobrança pode ser homologada e liberada antes; pagamentos exigem homologação, limites e aceite próprios.

Fora do escopo desta entrega: ativar produção, cadastrar credenciais reais no repositório, emitir títulos reais, movimentar dinheiro ou supor campos/endpoints que não estejam no contrato oficial recebido.

## Arquivos BPMN

Os fluxos abaixo são BPMN 2.0 e podem ser importados no [bpmn.io](https://bpmn.io/) ou em outro modelador compatível.

Para entender os símbolos e os caminhos antes de abrir o XML, consulte o [guia de leitura](bpmn/README.md). O Sicoob é representado como participante externo, pois seu processo interno depende do contrato oficial da API.

- [Homologação e ativação controlada](bpmn/01-homologacao-sicoob.bpmn)
- [Cobrança, retorno e conciliação](bpmn/02-cobranca-conciliacao-sicoob.bpmn)

## Arquitetura aprovada

| Camada              | Responsabilidade                                                        | Regra de segurança                                                         |
| ------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Interface           | Preparar, revisar e aprovar operações autorizadas                       | Não recebe token, certificado, segredo ou chave privada.                   |
| Operações bancárias | Snapshot, aprovação segregada, idempotência, estados e auditoria        | Cada operação possui uma única intenção durável por versão.                |
| Executor            | Chamar o adaptador, registrar tentativas e recuperar após falhas        | Pausado por padrão; não repete despacho financeiro inconclusivo.           |
| Adaptador Sicoob    | Converter exclusivamente o contrato oficial para HTTP/OAuth             | Origem fixa, HTTPS/mTLS, resposta validada e sem payload sensível em logs. |
| Sicoob              | Autorizar, registrar, consultar e notificar conforme produto contratado | Fonte de verdade para o efeito financeiro externo.                         |
| Conciliação         | Comparar banco e estado local                                           | Não dá baixa somente por valor ou por data.                                |

## O que já está pronto no Ecosol

- Ambientes de homologação e produção separados; produção exige habilitação explícita.
- Token OAuth mantido somente em memória, com expiração, margem de renovação e proteção contra renovações concorrentes.
- Cliente HTTP com HTTPS obrigatório, mTLS disponível, origem fixa, sem redirecionamentos, timeout total, limites de tamanho e erros sanitizados.
- Contrato oficial Client Credentials e Cobrança Bancária v3 implementado para `POST /boletos`, `GET /boletos` e `GET /health`, conforme Portal Developers Sicoob consultado em 22/10/2026.
- Dados do convênio são lidos somente do ambiente; nenhum número de cliente, modalidade, conta ou contrato é presumido no código.
- Linha digitável, código de barras, QR Code e PDF retornados são validados e persistidos com vínculo à operação; o PDF recebe hash SHA-256.
- Unicidade de `provedor_id` por ambiente e conta; duplicidade existente interrompe a inicialização para conciliação humana.
- Registro de cobrança que recebe erro ou resposta inconclusiva não é reenviado às cegas. O próximo passo é consulta/reconciliação.
- `Retry-After` e resultado desconhecido são preservados pela fila.

## Dados ainda necessários para homologação conectada

Registrar em cofre/arquivo de ambiente local, nunca em chat, commit, PDF de evidência ou planilha compartilhada:

1. Produto(s) habilitado(s): cobrança, consulta de liquidação, cancelamento/baixa, pagamentos, extrato e webhook, se aplicável.
2. Ambiente de homologação: URL base, URL OAuth, versão da API, escopos, método de autenticação e documentação de erros.
3. Credenciais: `client_id`, segredo quando aplicável e referência interna da conta/convenio/carteira. O número completo de conta não deve aparecer em telas ou logs.
4. Certificado mTLS, chave privada, senha e data de expiração, se exigidos pelo produto.
5. Contrato de cobrança: campos obrigatórios, identificação externa, consulta por referência/idempotência, estados, baixa e limites.
6. Contrato de pagamento: favorecido, validação, agendamento, autenticação adicional, limites, comprovante e cancelamento.
7. Retornos: webhook/evento, autenticação/verificação, política de repetição, ordenação, formato e limite de retenção.
8. Dados de teste e roteiro de homologação autorizado pelo banco.

## Configuração local esperada

Preencher somente no ambiente do servidor os campos documentados em [`backend/.env.example`](../../backend/.env.example). Os principais são:

```text
BANCARIO_EXECUTOR_MODO=desligado
SICOOB_AMBIENTE=homologacao
SICOOB_CONTA_REFERENCIA=<referencia-interna>
SICOOB_HOMOLOGACAO_API_BASE_URL=<url-oficial>
SICOOB_HOMOLOGACAO_OAUTH_TOKEN_URL=<url-oficial>
SICOOB_HOMOLOGACAO_CLIENT_ID=<segredo>
SICOOB_HOMOLOGACAO_CLIENT_SECRET=<segredo-quando-aplicavel>
SICOOB_HOMOLOGACAO_CONTRATO_VERSAO=<versao-oficial>
```

Certificado e chave privada devem ficar fora do repositório, com permissões restritas ao processo do backend. O segredo do banco é independente da chave de cifragem do Gmail.

## Sequência de homologação

| Ordem | Ação                                                 | Evidência exigida                                   | Critério para avançar                                           |
| ----- | ---------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| 1     | Registrar o produto e responsáveis no portal Sicoob  | Protocolo/tela do banco, sem segredo                | Produto de homologação ativo.                                   |
| 2     | Configurar ambiente local e certificado              | Checagem mascarada de configuração                  | Nenhuma credencial exibida; executor segue desligado.           |
| 3     | Implementar contrato oficial                         | Teste de contrato local com respostas autorizadas   | Token, cabeçalhos, payloads e estados aderentes à documentação. |
| 4     | Testar OAuth e consulta sem efeito financeiro        | Auditoria de correlação e resultado sanitizado      | Sem vazamento de segredo e sem emissão.                         |
| 5     | Emitir um título de homologação autorizado           | ID externo, valor, vencimento e consulta posterior  | Um único título; valor e beneficiário corretos.                 |
| 6     | Exercitar rejeição, timeout, 401/403, 429 e reinício | Tentativas e auditoria                              | Sem reenvio cego; prazo do banco respeitado.                    |
| 7     | Exercitar retorno/liquidação e reconciliação         | Evento/consulta e estado local                      | Baixa aplicada uma vez; divergência fica visível.               |
| 8     | Autorizar piloto de produção                         | Checklist assinado por operação, segurança e gestão | Produção ainda começa com executor pausado e lote limitado.     |

## Regras obrigatórias de operação

- Regra geral: uma pessoa prepara e outra aprova. Exceção exclusiva: o perfil crítico **Proprietário** pode autoaprovar a própria operação com MFA ativo, confirmação recente, aceite explícito e auditoria específica. Nenhum outro perfil pode autoaprovar.
- Qualquer alteração de valor, favorecido, vencimento, conta, linha digitável ou versão da fatura invalida a aprovação.
- Timeout, queda de conexão, 401/403 durante registro e reinício após envio são **resultado desconhecido**, não falha financeira confirmada.
- Repetir consulta pode ser seguro conforme contrato. Repetir registro/pagamento somente é permitido quando a idempotência remota tiver sido comprovada e testada.
- Liquidação não pode rebaixar estado já confirmado; evento duplicado ou fora de ordem deve ser idempotente.
- Operação rejeitada pelo banco, erro técnico e resultado desconhecido devem aparecer como estados distintos na interface.
- Pausar a fila interrompe novos envios, mas não apaga auditoria, tentativas ou necessidade de conciliação.

## Critérios de aceite antes de produção

1. Contrato oficial revisado e implementado sem campos inventados.
2. Contas, convenios, escopos, certificados e limites conferidos para o ambiente correto.
3. Papéis financeiros nominais definidos; reautenticação recente e proteção CSRF concluídas para ações bancárias mutantes.
4. Testes P0 do [plano de testes](04-plano-de-testes.md) aprovados e evidenciados em homologação.
5. Backup e restauração ensaiados com o executor desabilitado e reconciliação posterior.
6. Monitoramento de fila, falhas de autenticação, vencimento de certificado, retornos pendentes e divergências ativo.
7. Piloto de produção aprovado com limite de valor/quantidade e conferência diária.

## Pendências de implementação após os dados do banco

- Conectar os contratos OAuth, cobrança, consulta, baixa e pagamentos à documentação efetivamente contratada.
- Criar a rota de webhook somente se o produto a suportar, com autenticação oficial, deduplicação e reconciliação.
- Implementar conciliação diária com bruto, tarifa, líquido, data e identificadores externos.
- Reautenticação recente, MFA TOTP e confirmação explícita contra CSRF já protegem as mutações bancárias (validade de cinco minutos, vínculo à sessão e bloqueio por origem). Configurar a chave, concluir a validação assistida e definir recuperação organizacional para perda de todos os fatores antes da operação financeira em produção. Ver [guia de MFA](06-mfa-acoes-bancarias.md).
- Criar a interface de emissão final, comprovantes, retorno de pagamentos e tratamento manual de divergências.
- Executar homologação e, após aceite, piloto de produção controlado.

## Recuperação e contingência

Em incidente de integração: pausar executor, preservar logs sanitizados e IDs de correlação, consultar o Sicoob, reconciliar cada operação inconclusiva e somente depois retomar a fila. Nunca “reemitir para garantir”. Em restauração de backup, iniciar o sistema pausado e reconciliar o período posterior ao backup antes de liberar novos despachos.

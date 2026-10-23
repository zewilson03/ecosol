# Prontidão para o primeiro boleto de homologação Sicoob

Data da revisão: 23/10/2026.

## Objetivo e limite

Emitir uma única cobrança com dados de teste no ambiente oficialmente habilitado
pelo Sicoob, sem ativar produção e sem depender do Postman durante a operação do
Ecosol. O executor permanece pausado até a conferência humana final.

## Concluído

- Aplicação `ECOSOL .SYS` confirmada como ativa no Portal Developers em
  23/10/2026; Client ID registrado somente na configuração local ignorada pelo
  Git.
- O portal informa expressamente que Secret ID não é necessário para as APIs
  habilitadas nesta aplicação.
- Cobrança Bancária V3 está vinculada com `boletos_inclusao` e
  `boletos_consulta` disponíveis.
- OAuth Client Credentials confirmado no Postman com resposta `200`, mTLS e
  token com validade de 300 segundos.
- Contrato OAuth implementado no backend sem persistir ou registrar o token.
- Cache de token exclusivamente em memória, margem de renovação e renovação
  concorrente única.
- Uma nova autenticação é tentada após `401` somente para consulta; registro de
  boleto não é repetido automaticamente depois de atravessar a fronteira
  financeira.
- URLs, escopos e versão da Cobrança Bancária v3 documentados.
- Cliente HTTP restringe origem, HTTPS, TLS 1.2+, tamanho, timeout e resposta.
- Backend aceita mTLS por PFX ou pelo par certificado/chave PEM, nunca ambos.
- PFX principal localizado fora do repositório e seu caminho registrado somente
  na configuração local ignorada pelo Git.
- PFX, chave privada e senha validados pelo backend em 23/10/2026 mediante
  autenticação OAuth mTLS real; o token foi mantido exclusivamente em memória.
- Configuração completa falha de forma segura quando o material mTLS estiver
  ausente.
- Mapeamento de inclusão `POST /boletos` e consulta `GET /boletos` possui testes
  sintéticos de contrato.

## Pendências de configuração local

As informações abaixo ficam somente em `backend/.env.local`, que é ignorado
pelo Git. Valores secretos não devem aparecer neste documento.

1. Dado oficial do convênio de cobrança ainda não confirmado:
   - número do cliente/beneficiário na Plataforma de Serviços Financeiros.

O Portal Developers da aplicação confirmou em 23/10/2026 a cooperativa `3246`
e a conta corrente `15.837-2`. Como o contrato de inclusão recebe a conta como
inteiro, a configuração local usa `15837`; o dígito `2` é preservado apenas como
referência e não é enviado no corpo. O boleto anterior e o contrato V3 também
confirmam modalidade `1` (simples com registro) e espécie `DM`.

As decisões do primeiro piloto já estão registradas localmente: o Sicoob emite
(`identificacaoEmissaoBoleto = 1`), a Ecosol distribui
(`identificacaoDistribuicaoBoleto = 2`) e a resposta deve solicitar o PDF.

O campo `numeroContratoCobranca` é opcional e só deve ser enviado quando o
beneficiário possuir mais de um contrato e houver orientação expressa do Sicoob.
O campo `tipoFormularioImpressaoPDF` não faz parte do contrato oficial de
inclusão V3 consultado e foi removido da prontidão e do corpo enviado.

O `client_secret` permanece vazio porque o fluxo mTLS validado não o utilizou.
Só deve ser configurado se o Sicoob alterar formalmente o contrato da aplicação.

## Pendência de implementação

O executor iniciado pelo servidor ainda aceita somente o modo `simulado`. Antes
do primeiro boleto pelo Ecosol, é necessário adicionar um modo explícito de
homologação real que componha `criarIntegracaoSicoob()`. Esse modo deve:

- recusar produção;
- exigir a prontidão completa antes de iniciar;
- nascer e permanecer pausado até liberação nominal;
- processar inicialmente uma única intenção de teste;
- preservar idempotência, auditoria e reconciliação;
- interromper a fila em falha permanente de credencial ou autorização.

## Dados necessários para a cobrança piloto

- cliente fictício/autorizado com CPF ou CNPJ no formato aceito;
- nome, endereço, bairro, cidade, CEP e UF;
- e-mail apenas quando disponível;
- valor positivo, vencimento igual ou posterior à emissão;
- UC de teste e fatura aprovada no fluxo local;
- chave de idempotência única gerada pelo Ecosol.

## Origem possível dos dados ainda pendentes

### Podem aparecer em um boleto Sicoob já emitido

- número/código do beneficiário, candidato a `numeroCliente`;
- conta do beneficiário, candidata a `numeroContaCorrente`;
- carteira ou modalidade, candidata a `codigoModalidade`;
- espécie do documento, candidata a `codigoEspecieDocumento`;
- presença de QR Code Pix, que comprova apenas que aquele título foi híbrido.

Neste caso, conta, modalidade e espécie foram cruzadas com os dados autenticados
do Portal e o contrato oficial. O código de beneficiário impresso continua sem
equivalência comprovada com o `numeroCliente` exigido pela API: consultas somente
de leitura com os candidatos extraídos retornaram o código negocial `5002`.

### Não podem ser comprovados somente pelo boleto

- formato exato em que a API espera o número da conta, quando o impresso contém
  máscara ou dígito verificador;
- habilitação padrão de Pix no cadastro do beneficiário para títulos futuros;
- existência de múltiplos contratos secundários que exigiriam o campo opcional
  `numeroContratoCobranca`;
- autorização operacional definitiva para homologação e posterior produção;
- dados completos e autorização do cliente usado no piloto.

## Contrato oficial consultado

- Portal Developers Sicoob, Cobrança Bancária V3, consultado em 23/10/2026;
- coleção Postman oficial disponibilizada pelo próprio portal para a V3;
- `POST /boletos` limitado a 5 requisições por segundo;
- campos opcionais são omitidos quando não aplicáveis, em vez de enviados vazios
  ou nulos;
- consulta e reconciliação precedem qualquer nova tentativa após resultado
  inconclusivo da inclusão.

## Critérios de liberação

1. Diagnóstico da interface informa OAuth, mTLS, escopos e convênio completos.
2. Token é obtido pelo backend e nunca exibido ou persistido.
3. Executor está em homologação real e pausado.
4. Uma única cobrança piloto foi revisada por pessoa nominal.
5. Após liberação, o Sicoob devolve `nossoNumero` e o Ecosol persiste o vínculo.
6. Consulta posterior confirma a cobrança antes de qualquer repetição.
7. Linha digitável/PDF, quando devolvidos, têm formato validado e trilha de
   auditoria.
8. Produção continua bloqueada.

## Evidências desta revisão

- `npm run test:bancario`: aprovado.
- `npm run build`: aprovado, com aviso já conhecido de bundle acima de 500 kB.
- `git diff --check`: sem erros; apenas avisos de normalização LF/CRLF do
  ambiente Windows.

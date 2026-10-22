# Processo 01 — Modelos contratuais GO/DF

Card principal: [SEJM-29](https://sistema-ecosol.atlassian.net/browse/SEJM-29). Prioridade: média. Estado inicial: A Desenvolver.

## Resultado esperado

Entregar dois pacotes contratuais aprovados e versionados, Goiás e Distrito Federal, preparados para geração automática sem dados reais. Cada pacote contém contrato, procuração e convênio. O processo termina somente quando campos, regras, PDFs de referência e responsáveis pelo aceite estiverem definidos; ele não envia envelopes ao DocuSign.

## Camadas e ordem de execução

### Camada 1 — Fontes e governança

**Objetivo:** congelar as seis minutas de origem e definir quem pode aprovar conteúdo jurídico e comercial.

**Atividades**

1. Registrar nome, região, tipo documental, empresa contratada, concessionária e hash de cada fonte.
2. Solicitar as versões editáveis DOCX; PDF continua sendo referência de comparação.
3. Registrar responsáveis pelo aceite jurídico, comercial e operacional.
4. Abrir lista formal de divergências: PF/PJ, 23% fixos de Goiás, datas, local, foro, potência, signatários e repetição por UC.

**Tecnologias úteis:** Git para versionamento; SHA-256 do Node.js para integridade; Markdown para decisões; DOCX como fonte editável. Nenhuma PII real em repositório ou Jira.

**Aceite da camada**

- [ ] As seis fontes têm identificação e hash.
- [ ] GO e DF possuem três documentos cada, sem mistura.
- [ ] Responsáveis pelo aceite estão nomeados.
- [ ] Toda divergência tem decisão, responsável ou estado pendente explícito.
- [ ] Alterações posteriores exigem nova versão, sem sobrescrever fonte aprovada.

**Entrega:** registro de fontes e matriz de decisões.

### Camada 2 — Contrato de dados e manifesto de marcadores

**Objetivo:** transformar cada `XXXX...` e `****...` em um campo nomeado, validável e rastreável.

**Atividades**

1. Inventariar cada marcador por documento, página e contexto.
2. Definir chave estável, origem, tipo, obrigatoriedade, formato, máscara, regra de ausência e regra de repetição.
3. Modelar PF/PJ, representante, endereço, signatários e identificadores regionais.
4. Modelar uma ou mais UCs e um percentual obrigatório informado pelo vendedor.
5. Determinar como valor numérico e por extenso são produzidos.

**Tecnologias úteis:** JSON Schema para validar manifestos; TypeScript para tipos de domínio; `decimal.js`, já usado no projeto, para preservar o percentual sem ponto flutuante binário; fixtures sintéticas para testes.

**Aceite da camada**

- [ ] Cada marcador das seis minutas possui exatamente um campo no manifesto.
- [ ] Campo sem valor obrigatório gera pendência e impede preparar o pacote.
- [ ] Nenhum valor é inventado ou preenchido por padrão.
- [ ] Os 23% fixos de Goiás foram substituídos pelo desconto informado pelo vendedor na versão revisada.
- [ ] GO aceita uma ou mais UCs atuais; DF aceita pares código da instalação + código do cliente.
- [ ] Usina não existe no contrato de dados desta feature.

**Entrega:** dicionário e manifestos regionais validados.

### Camada 3 — Composição das famílias documentais

**Objetivo:** definir como os dados entram nos três documentos de cada região e como múltiplas UCs afetam a quantidade de arquivos.

**Atividades**

1. Criar tabela dinâmica de UCs no contrato principal.
2. Definir, com aprovação jurídica, quando procuração e convênio são únicos ou repetidos por titular/imóvel/UC.
3. Definir destinatários, papéis, ordem e locais de assinatura.
4. Fixar regras regionais de empresa, concessionária, textos, datas e identificação.

**Tecnologias úteis:** PDF original versionado como base imutável, biblioteca de composição capaz de desenhar texto com coordenadas e fontes controladas, manifesto declarativo por versão e renderização Poppler para comparação visual. DocuSign Document Generation com DOCX só será alternativa se a saída for comprovadamente fiel ao original. O domínio deve depender de uma interface de geração, não da ferramenta escolhida.

**Aceite da camada**

- [ ] Selecionar GO gera somente documentos de GO; selecionar DF gera somente documentos do DF.
- [ ] A contagem real de arquivos é explicada antes do envio.
- [ ] UCs, titulares e endereços diferentes seguem a regra jurídica aprovada.
- [ ] Nenhuma posição de assinatura depende de coordenada frágil em conteúdo variável.

**Entrega:** mapa de composição e dois conjuntos de templates candidatos.

### Camada 4 — Prova de geração e comparação

**Objetivo:** provar com dados sintéticos que a tecnologia escolhida gera documentos legíveis e determinísticos.

**Atividades**

1. Gerar casos PF, PJ, uma UC, várias UCs, nomes longos, acentos e endereço extenso.
2. Validar desconto numérico e por extenso.
3. Detectar marcador residual e campo vazio antes da publicação.
4. Comparar visualmente com a fonte e testar quebras de página, margens, fontes e tabelas.
5. Produzir hash e metadados da saída.

**Tecnologias úteis:** Node.js na stack atual; SDK oficial DocuSign apenas se o gerador contratado for usado; navegador headless para a alternativa HTML/PDF; `pdfjs-dist` para inspeções automatizáveis; testes no padrão Node já existente no projeto.

**Aceite da camada**

- [ ] Nenhum PDF contém `XXXX`, `****`, corte, sobreposição ou página vazia indevida.
- [ ] O PDF preparado conserva o visual do modelo original; fora das áreas variáveis mapeadas, não há alteração visual nem textual.
- [ ] Prévia, download e arquivo destinado ao DocuSign são o mesmo artefato preparado, confirmado pelo mesmo hash.
- [ ] Duas gerações da mesma versão e dos mesmos dados resultam no mesmo conteúdo lógico e metadados controlados.
- [ ] Dados de uma região não aparecem na outra.
- [ ] Casos com várias UCs preservam todas as linhas.
- [ ] Fixtures e PDFs de homologação usam somente dados sintéticos.

**Entrega:** prova técnica, amostras renderizadas e relatório de testes.

### Camada 5 — Aprovação e publicação da versão

**Objetivo:** transformar os candidatos aprovados em versões imutáveis utilizáveis pela próxima entrega.

**Atividades**

1. Obter aceite jurídico, comercial e operacional das amostras.
2. Registrar versão, hash, data, aprovadores e manifesto associado.
3. Publicar a versão como disponível para novos rascunhos.
4. Manter versões anteriores para leitura de contratos históricos.
5. Definir procedimento de correção, desativação e rollback.

**Tecnologias úteis:** controle de versão no Git; metadados persistidos posteriormente pelo módulo de contratos; feature flag para ativação gradual. Assinatura da minuta, envio remoto e banco serão implementados nos cards seguintes.

**Aceite da camada**

- [ ] Os três responsáveis aprovam os arquivos correspondentes.
- [ ] A versão publicada referencia fontes, manifesto e hashes exatos.
- [ ] Um rascunho sempre conhece a versão usada.
- [ ] Versão utilizada em contrato preparado não pode ser alterada.
- [ ] Rollback desativa novos usos sem apagar histórico.

**Entrega:** pacote regional publicado para consumo da SEJM-30, SEJM-31 e SEJM-33.

## Critério de aceite total da SEJM-29

- [ ] Camadas 1 a 5 concluídas com evidências anexadas ao card.
- [ ] Dois pacotes aprovados, cada um com contrato, procuração e convênio.
- [ ] Todos os marcadores mapeados e nenhum campo obrigatório sem origem.
- [ ] Uma ou várias UCs suportadas conforme regra regional.
- [ ] Desconto obrigatório informado pelo vendedor, sem 23% padrão.
- [ ] Usina excluída do processo contratual.
- [ ] Prévia/download não liberam a venda; DocuSign confirmado no backend é o gate dos contratos novos.
- [ ] Importação manual e contrato atualizado possuem regras aprovadas de conferência, vigência e histórico.
- [ ] PF/PJ, representantes, signatários, datas, foro, potência e repetição documental decididos.
- [ ] Tecnologia de geração escolhida por evidência e encapsulada para permitir substituição.
- [ ] Dados sintéticos passam nos testes funcionais, visuais e de segurança documental.
- [ ] Próximos cards recebem contratos e interfaces estáveis, sem depender de interpretação das minutas.

## Dependências e bloqueios

- Fontes DOCX ou autorização para reconstrução fiel dos documentos.
- Decisões jurídica/comercial sobre os pontos abertos.
- Confirmação do recurso Document Generation no plano DocuSign de produção.
- Definição dos responsáveis formais pelo aceite.

Enquanto uma decisão jurídica estiver pendente, as camadas técnicas podem usar valores e textos sintéticos, mas o pacote não pode ser publicado como pronto para produção.

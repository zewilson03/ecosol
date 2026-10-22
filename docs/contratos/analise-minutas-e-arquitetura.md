# Análise das minutas e arquitetura de contratos

Data da análise: 21/10/2026. Escopo: seis minutas fornecidas, requisitos de múltiplas UCs, seleção Goiás ou Distrito Federal e futura assinatura pelo DocuSign.

Esta é uma especificação técnica e operacional, não uma revisão jurídica. Nenhuma cláusula foi alterada. Pontos de conteúdo que afetam a automação precisam de validação do responsável jurídico/comercial antes da implementação.

## 1. Resultado executivo

O sistema deve tratar um contrato comercial como um **pacote regional versionado**:

| Pacote           | Abrangência            | Concessionária citada         | Contratada                          | Documentos exibidos                                    |
| ---------------- | ---------------------- | ----------------------------- | ----------------------------------- | ------------------------------------------------------ |
| Goiás            | Todo o estado de Goiás | Equatorial Distribuição Goiás | Grupo Ecosol Condomínio Solar Ltda. | Contrato, procuração e convênio de utilização de Goiás |
| Distrito Federal | Somente DF             | Neoenergia                    | Ecosol Energy Hub Ltda.             | Contrato, procuração e convênio de utilização do DF    |

O vendedor escolhe o pacote antes de preencher UCs e documentos. Essa escolha determina empresa contratada, concessionária, textos, identidade visual, campos regionais e os três documentos que serão preparados. Não é permitido misturar documentos dos dois pacotes dentro do mesmo contrato.

Um contrato pode conter **uma ou mais UCs**. A usina não participa dessa etapa: o vínculo da UC com uma usina será realizado depois, por analistas de energia, em processo próprio de rateio. O dado comercial nesta etapa é o **percentual de desconto contratado**.

## 2. O que existe nas minutas

Os seis PDFs são A4, não criptografados e sem AcroForm. Portanto, não possuem campos interativos confiáveis para preenchimento direto. Os dois contratos possuem 7 páginas; as procurações, 1 página; e os convênios, 2 páginas.

### Goiás

- Contrato: qualificação do contratante, endereço, uma lista de unidades consumidoras, desconto, data e assinaturas.
- Procuração: endereço do outorgante, dados fixos da Ecosol e poderes perante a Equatorial.
- Convênio: qualificação e endereço do concedente, endereço do imóvel, data e assinaturas.
- O contrato atual fixa desconto de **23%**; no modelo automatizado, esse trecho será substituído pelo percentual informado pelo vendedor, após aprovação da versão revisada.

### Distrito Federal

- Contrato: qualificação do contratante, endereço, potência do gerador, pares **código da instalação + código do cliente**, desconto, data e assinaturas.
- Procuração: qualificação do outorgante, dados fixos da Ecosol Energy Hub e poderes perante a Neoenergia.
- Convênio: qualificação e endereço do concedente, endereço do imóvel, data e assinaturas.
- O desconto já aparece como variável na minuta.

## 3. Dicionário de dados proposto

### Regra dos marcadores `XXXX` e `****`

Toda sequência de `X` ou de `*` usada como lacuna nas seis minutas é um **campo de substituição**, conforme orientação do responsável pelo projeto. Na geração final, o marcador inteiro deixa de existir e recebe o dado correspondente do cliente, da UC ou do contrato. Não se deve substituir caractere por caractere nem manter asteriscos ou `X` residuais.

Cada marcador precisa constar num manifesto versionado do modelo com:

- chave estável do campo, documento, página e trecho de referência;
- origem do dado (cliente, representante, endereço, UC, condição comercial ou sistema);
- tipo, formato, obrigatoriedade e validação;
- regra de repetição para múltiplas UCs;
- regra de ausência, que deve gerar pendência em vez de texto vazio ou valor inventado;
- amostra sintética e teste de renderização para textos curtos, longos e acentuados.

Exemplo conceitual:

```text
XXXXXXXX (nome)      → cliente.nome_razao_social
XXXXXXXX (documento) → cliente.cpf_cnpj
XX%                  → contrato.percentual_desconto
XXXX por cento       → contrato.percentual_desconto_por_extenso
XXXXXX - XXXXXXX     → uc.codigo_instalacao + uc.codigo_cliente
```

Os marcadores não serão identificados em produção por uma busca genérica no texto do PDF. Eles serão convertidos, uma única vez, em campos nomeados nos modelos editáveis aprovados. Assim, uma alteração de redação não desloca silenciosamente os dados para o lugar errado. Valores fixos que não estejam marcados — como os 23% da minuta goiana — continuam sendo divergências de conteúdo e só podem se tornar variáveis após aprovação da revisão do modelo.

### Contrato e cliente

| Campo                      | Obrigatório                | Destino                 | Observação                                                                                                        |
| -------------------------- | -------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Região contratual          | Sim                        | Contrato                | Enumeração `GO` ou `DF`; imutável após preparar a versão.                                                         |
| Tipo de pessoa             | Sim                        | Cliente/contrato        | PF ou PJ. As minutas atuais descrevem apenas pessoa física; texto de PJ precisa ser fornecido/aprovado.           |
| Nome ou razão social       | Sim                        | Três documentos         | Não usar nome como identificador único.                                                                           |
| CPF ou CNPJ                | Sim                        | Cliente/três documentos | Normalizado para busca; validação documental separada.                                                            |
| Nacionalidade              | A confirmar                | Três documentos         | Hoje aparece fixa como “brasileiro”; não assumir para todos.                                                      |
| E-mail                     | Sim para assinatura remota | Cliente/DocuSign        | E-mail do signatário; não liberar portal sem e-mail conforme regra vigente.                                       |
| Telefone                   | Sim                        | Cliente/três documentos | Não substitui e-mail do DocuSign.                                                                                 |
| Endereço completo          | Sim                        | Três documentos         | Estruturar logradouro, número, complemento, quadra, lote, bairro, cidade, UF e CEP; renderizar conforme o pacote. |
| Signatário/representante   | Condicional                | DocuSign/documentos     | Obrigatório para PJ; documento e poderes a confirmar.                                                             |
| Data e local de assinatura | Sim                        | Três documentos         | Gerados de forma consistente; local exato precisa de regra de negócio.                                            |
| Documento com foto         | Sim para conferência       | Armazenamento privado   | Não anexar ao envelope por padrão e não tratar upload como identidade validada.                                   |

### UCs e condições comerciais

| Campo                 | Goiás                          | Distrito Federal                          | Regra                                                                                                                                                                       |
| --------------------- | ------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UC atual              | Obrigatória, uma ou mais       | Manter se houver equivalência no cadastro | Chave principal interna existente; sem usina nesta etapa.                                                                                                                   |
| Código da instalação  | Não aparece separado na minuta | Obrigatório por UC                        | Renderizar na relação do contrato do DF.                                                                                                                                    |
| Código do cliente     | Não aparece separado na minuta | Obrigatório por UC                        | Renderizar junto ao código da instalação.                                                                                                                                   |
| Endereço da UC/imóvel | Obrigatório para convênio      | Obrigatório para convênio                 | Necessário para decidir quantas instâncias de procuração/convênio gerar.                                                                                                    |
| Titular da UC         | Obrigatório                    | Obrigatório                               | Divergência não altera titularidade automaticamente.                                                                                                                        |
| Percentual contratado | Obrigatório                    | Obrigatório                               | Informado pelo vendedor; um valor do contrato aplicado a todas as UCs desta versão, armazenado como decimal exato e também produzido por extenso. Não usar 23% como padrão. |
| Potência do gerador   | Fórmula textual existente      | Campo `kWp` na minuta                     | Regra de cálculo e se é total ou por UC precisam de validação.                                                                                                              |

O percentual é propriedade da versão do contrato. Depois da assinatura, a integração com o cadastro pode criar a vigência comercial de cada UC, preservando o histórico e registrando o contrato como origem. A data inicial da vigência continua sendo uma decisão explícita; assinatura não deve retroagir ou recalcular faturas antigas.

## 4. Múltiplas UCs e quantidade de documentos

Modelo de dados recomendado:

```text
Contrato 1 ── N Versões
   │
   ├── N UCs contratadas
   │      ├── identificadores regionais
   │      ├── titular e endereço confirmados
   │      └── situação de vínculo no cadastro
   │
   └── N Instâncias documentais
          ├── contrato principal
          ├── procuração por agrupamento aprovado
          └── convênio por agrupamento aprovado
```

O contrato principal pode mostrar uma tabela dinâmica com todas as UCs. Procuração e convênio são mais sensíveis: as minutas usam imóvel, titular e endereço no singular. O sistema deve estar preparado para gerar uma instância por imóvel/UC quando os endereços ou titulares forem diferentes, ou uma instância conjunta quando o jurídico aprovar essa composição. Não condensar automaticamente várias propriedades em um único documento sem essa regra.

No DocuSign, todas as instâncias geradas compõem **um envelope do contrato**. Assim, o cliente recebe uma única solicitação e assina o pacote correspondente à sua região. O sistema precisa exibir a contagem real, por exemplo: “5 documentos: 1 contrato, 2 procurações e 2 convênios”, em vez de prometer sempre três arquivos quando houver repetição por UC.

## 5. Fluxo funcional revisado

1. **Tipo e cliente**: escolher Goiás ou DF; procurar/criar o cliente; preencher PF/PJ, documento, contato e endereço.
2. **UCs e desconto**: adicionar uma ou mais UCs; validar formato regional; mostrar duplicidades e titular divergente; preencher percentual contratado; não mostrar usina.
3. **Documentos**: anexar documento com foto para conferência e mostrar somente as três famílias documentais da região selecionada, com a quantidade de instâncias derivada das UCs.
4. **Revisar e preparar**: conferir dados, UCs, desconto, signatários e prévia; gerar snapshot imutável; permitir download ou compartilhamento da cópia ainda não assinada, identificada como tal.
5. **Enviar ao DocuSign**: somente uma ação explícita envia a versão preparada. Download, e-mail manual ou visualização da prévia não liberam a venda nem o cadastro definitivo.
6. **Assinatura**: acompanhar envelope, recusa/cancelamento, eventos e resultado incerto; baixar documentos concluídos e certificado.
7. **Arquivar e liberar**: após confirmação no backend, guardar a versão assinada na aba Contratos, liberar a continuidade do cadastro/venda e registrar condições comerciais nas UCs na vigência aprovada. A alocação de usina permanece pendente para os analistas de energia.
8. **Importar histórico ou atualização**: receber contratos já celebrados manualmente e versões atualizadas por fluxo separado, com origem, data, hash e conferência humana. A importação nunca sobrescreve a versão anterior.

## 6. Estados e invariantes

- Região não muda depois de uma versão ser preparada. Troca de GO para DF exige nova versão ou novo contrato antes do envio.
- Uma versão enviada nunca tem PDF, UCs, desconto, destinatários ou template alterados silenciosamente.
- Uma UC pode aparecer apenas uma vez dentro da mesma versão.
- Nenhum documento preparado pode conservar `XXXX`, `****` ou campo obrigatório sem valor; a preparação deve listar exatamente a pendência e o documento afetado.
- Texto fixo do modelo não é alterado por substituição de campos; qualquer mudança de cláusula exige nova versão aprovada.
- Todas as UCs do contrato usam o desconto daquela versão; desconto diferente exige outro contrato/versão, salvo futura regra aprovada.
- O percentual é entrada obrigatória do vendedor, não pode ser preenchido por valor padrão da minuta e deve aparecer na prévia antes do envio.
- Usina é ausente no fluxo comercial e não bloqueia assinatura.
- Assinatura não aloca usina, não executa rateio, não gera boleto e não altera faturas antigas.
- Um envelope remoto corresponde a exatamente uma versão preparada e a um pacote regional.
- Repetição de clique, concorrência ou reinício não cria outro envelope.
- Evento do navegador não confirma assinatura; apenas estado confirmado no backend pelo provedor.
- Documento de identidade e documentos assinados têm autorização, retenção e auditoria separadas.
- Prévia, download ou envio manual de uma versão preparada não alteram seu estado para assinada e não liberam a venda.
- Cadastro criado antes da assinatura permanece provisório. A liberação exige contrato DocuSign confirmado no backend ou contrato manual importado e validado por pessoa autorizada.
- Contrato manual importado possui origem `manual`, situação de conferência e responsável pela validação; não se atribui retroativamente um envelope DocuSign inexistente.
- Contrato atualizado cria nova versão ligada à anterior. A anterior permanece consultável e só passa a substituída quando a nova estiver assinada/validada e vigente.
- A aba Contratos distingue versão atual, substituída, importada, pendente de conferência e assinada pelo DocuSign.

## 7. Decisão de tecnologia

### Linguagens e aplicação

Manter **TypeScript/React no frontend e Node.js/Express no backend**. O repositório já utiliza esse ecossistema e a DocuSign mantém um SDK oficial para Node.js. Uma aplicação separada em Python, Java ou .NET aumentaria implantação, observabilidade, autenticação e manutenção sem resolver uma limitação atual.

Manter **SQLite** nesta fase, usando migrações aditivas, transações curtas, constraints únicas, controle otimista de versão e o padrão outbox/inbox. A carga comercial informada não justifica uma migração imediata. Reavaliar PostgreSQL apenas antes de múltiplas instâncias de servidor ou quando contenção/alta disponibilidade comprovarem a limitação.

### Geração dos três documentos

| Alternativa                                            | Vantagem                                                                                      | Limitação                                                                               | Decisão                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| PDF original como base + camada de dados versionada    | Preserva exatamente o modelo aprovado e altera apenas os campos permitidos.                   | Exige mapa preciso de posições, fontes e regras para conteúdo variável e múltiplas UCs. | **Abordagem obrigatória definida pelo produto.** |
| DocuSign Document Generation com DOCX fiel ao original | Pode preencher dados e tabelas dinâmicas dentro de uma reconstrução validada do mesmo modelo. | Requer DOCX visualmente idêntico, contratação do recurso e comparação página a página.  | Alternativa somente após prova de fidelidade.    |
| HTML/CSS redesenhado → PDF                             | Facilita paginação e desenvolvimento web.                                                     | Pode produzir documento apenas semelhante e divergir do modelo aprovado.                | Descartado como fonte do contrato.               |
| Serviço separado em outra linguagem                    | Isola renderização.                                                                           | Nova stack, deploy e observabilidade sem ganho comprovado.                              | Não adotar agora.                                |

A primeira atividade técnica é guardar versões controladas dos seis PDFs aprovados e criar, para cada versão, um manifesto de composição com página, coordenadas, área disponível, fonte, tamanho, alinhamento, origem e validação de cada campo. O gerador fica atrás de uma interface (`gerarPacoteContratual`) para não acoplar o domínio à biblioteca usada. A saída preparada é única: prévia, download e envio ao DocuSign consomem o mesmo arquivo e o mesmo hash.

Uma futura versão DOCX/Document Generation só poderá substituir essa composição se reproduzir o modelo aprovado e passar por comparação visual página a página. HTML/CSS pode estruturar a tela e o visualizador, mas não poderá recriar livremente o conteúdo contratual.

### Integração DocuSign

- SDK oficial Node.js `docusign-esign`, fixado por versão e encapsulado em adaptador próprio.
- OAuth Authorization Code confidencial com `state`; PKCE quando suportado no fluxo implementado; tokens cifrados e acessíveis apenas no backend.
- Envio remoto por e-mail em um único envelope com todos os documentos aplicáveis; assinantes e ordem definidos no template aprovado.
- Posições de assinatura por template ou âncoras estáveis; não depender de coordenadas frágeis em PDFs variáveis.
- Outbox transacional, chave idempotente local, estado “resultado incerto” e reconciliação antes de qualquer reenvio.
- Webhook Connect com HMAC validado sobre corpo bruto, inbox durável, deduplicação, tolerância a eventos fora de ordem e consulta de reconciliação.
- Separação total de demo/produção, conta, base URI, templates, segredos e dados de teste.

### Arquivos em produção

Desenvolvimento pode usar diretório privado fora da pasta pública. Em produção de instância única, um volume persistente cifrado e com backup pode ser suficiente. Se houver múltiplas instâncias ou hospedagem sem disco persistente, usar armazenamento de objetos compatível com S3 atrás de uma interface, com criptografia, versionamento, acesso privado e política de retenção aprovada. A escolha depende da hospedagem; não colocar imagens de documentos dentro do SQLite nem em URLs públicas.

## 8. Segurança, privacidade e auditoria

- Autorização por recurso no servidor: vendedor acessa os próprios contratos; gestor acessa a equipe; conferente acessa documentos apenas quando necessário.
- Upload em quarentena, limite de tamanho, identificação do tipo pelo conteúdo, nomes gerados, varredura antimalware e bloqueio quando scanner indisponível.
- Não enviar documento com foto ao DocuSign salvo decisão explícita e necessidade aprovada.
- Não registrar CPF/CNPJ completo, telefone, endereço, conteúdo do contrato, tokens ou links de assinatura em logs/Jira.
- Criptografia de tokens e arquivos, rotação e revogação, download autenticado, `Cache-Control` privado e auditoria de leitura.
- Snapshot do consentimento operacional, template, campos, UCs, desconto, signatários e hashes.
- Definir finalidade, aviso de privacidade, retenção e descarte antes da produção; não inventar prazo jurídico.
- Não apresentar um simples upload como validação de identidade ou serviço de IDV.

## 9. Lacunas encontradas nas minutas

Antes de transformar os PDFs em modelos automáticos, confirmar por escrito:

1. Texto de qualificação para pessoa jurídica, representante e comprovação de poderes; as seis minutas atuais usam pessoa física.
2. Aprovar a redação revisada de Goiás que substitui o valor fixo de 23% pelo percentual informado pelo vendedor e sua representação por extenso.
3. Regra para uma ou várias procurações/convênios quando existem UCs, titulares ou endereços diferentes.
4. Se o percentual é único para todas as UCs do contrato, como especificado nesta proposta.
5. Como calcular/preencher potência do gerador e se é total do contrato ou por UC.
6. Quem assina cada documento, ordem, obrigatoriedade do procurador e eventual testemunha.
7. Local e data: as minutas do DF também indicam Anápolis; as minutas de Goiás possuem datas fixas antigas em procuração e convênio.
8. Foro de Anápolis no convênio do DF e demais diferenças que podem ser intencionais.
9. Dados fixos com possível erro tipográfico, incluindo CNPJs, nomes empresariais e a lista de possíveis titulares da minuta goiana.
10. Política de vigência comercial após assinatura e momento de ativar o portal do cliente.

Esses pontos não impedem modelar banco, UX e integração simulada, mas impedem declarar o documento gerado como juridicamente pronto para produção.

## 10. Testes e aceite

- GO e DF nunca misturam entidades, concessionárias, logotipos ou documentos.
- Uma, duas e muitas UCs; duplicação na mesma versão; UCs com endereços/titulares iguais e diferentes.
- Percentuais válidos nos limites aprovados, precisão e texto por extenso; rejeitar notação ambígua.
- PF/PJ, nomes longos, acentos, endereços extensos, páginas e tabela de UCs sem corte.
- Snapshot e hash correspondem aos arquivos enviados; revisão posterior cria nova versão.
- Cliente/UC existente, divergência de titularidade e criação concorrente.
- Envio duplicado, timeout após POST, 429, token expirado, sucesso remoto/falha local e reconciliação.
- HMAC inválido, replay, evento duplicado, fora de ordem e envelope de outra conta/ambiente.
- Download final e certificado pendentes sem perder estado da assinatura.
- Permissão cruzada entre vendedores, revogação de acesso, upload malicioso e scanner indisponível.
- Celular 360 px, tablet 768 px e desktop; teclado, foco, leitor de tela, contraste e movimento reduzido.

## 11. Etapas de implantação

1. Aprovar dicionário, lacunas jurídicas e arquivos DOCX; versionar pacotes GO/DF.
2. Implementar permissões e rascunhos com região, múltiplas UCs e desconto, sem usina.
3. Implementar armazenamento privado, conferência e geração/prévia dos documentos.
4. Integrar sandbox DocuSign, envio idempotente, webhook e reconciliação.
5. Integrar pós-assinatura com cadastro/condições comerciais e fila de alocação para analistas.
6. Homologar com dados sintéticos e contratos internos autorizados; liberar por feature flag a poucos vendedores.

Nenhum código de produção, migração, cliente ou envelope foi criado nesta fase.

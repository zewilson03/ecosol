# Contratos e vendas em campo

Proposta de solução — 21/10/2026. Prioridade das novas entregas: **média**.

Este documento organiza o trabalho futuro. A integração ainda não está implementada, nenhum cliente foi criado e nenhum documento foi enviado ao DocuSign. As seis minutas recebidas foram analisadas e deram origem à especificação detalhada em `analise-minutas-e-arquitetura.md`; elas ainda precisam de aprovação jurídica/comercial antes de virarem modelos produtivos.

## 1. Decisão recomendada

Criar **Contratos** como entrada própria do menu, próxima de **Cadastros**, e como página inicial do perfil **Vendedor**. Não esconder esse trabalho dentro de Faturas: a venda começa antes da cobrança, e os vendedores precisam de um caminho curto no celular.

Manter React, Node/Express e SQLite. Implementar um módulo isolado de contratos, reaproveitando cadastro, autenticação e identidade visual. Não introduzir CRM, microsserviço, banco ou biblioteca de documentos antes de avaliar o modelo real.

O contrato não substitui o cadastro. Ele guarda uma fotografia dos dados e condições daquele momento; o cadastro continua evoluindo sem modificar documentos já enviados ou assinados.

## 2. Jornada do vendedor

```text
Contratos → Novo contrato
               ↓
        1. Tipo e cliente
               ↓
        2. UCs e desconto
               ↓
        3. Documentos
               ↓
        4. Revisar e preparar
               ↓
      Mostrar prévia e permitir
       download não assinado
               ↓
      Enviar obrigatoriamente
          para o DocuSign
               ↓
       Aguardar assinaturas
               ↓
    Confirmar conclusão no servidor
               ↓
  Guardar contrato final + certificado
               ↓
  Oferecer ativação segura do portal
```

O vendedor pode salvar rascunhos incompletos, sair e retomar. Preparar a versão cria ou reutiliza o cadastro do cliente **em situação provisória**, sem liberar a venda ou o acesso comercial. A continuidade do cadastro e da venda ocorre somente depois que o backend confirmar a assinatura DocuSign. Clientes já existentes mantêm seu acesso, mas a nova contratação continua bloqueada até sua própria assinatura.

O envio ao DocuSign só ocorre por uma ação explícita, com destinatários e documento conferidos. Digitar, salvar, visualizar, baixar ou compartilhar a cópia não assinada nunca dispara assinatura, libera venda ou gera cobrança.

### Dados por etapa

| Etapa              | Informações                                                                  | Comportamento                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tipo e cliente     | Pacote Goiás ou DF; nome/razão social, CPF/CNPJ, e-mail, telefone e endereço | A escolha regional determina empresa, concessionária e os três documentos. Procurar cadastro existente e apresentar diferenças.                                            |
| UCs e desconto     | Uma ou mais UCs; identificadores regionais; percentual contratado            | O vendedor informa obrigatoriamente o percentual, sem valor padrão. Goiás usa número da UC; DF também exige código da instalação e código do cliente. Não solicitar usina. |
| Documentos         | Três famílias da região; documento com foto; representante de PJ             | Gerar apenas contrato, procuração e convênio da região escolhida. Upload privado e conferência humana registrada.                                                          |
| Revisar e preparar | Dados, UCs, desconto, instâncias documentais, destinatários e pendências     | Mostrar prévia; permitir download identificado como não assinado; bloquear o DocuSign enquanto existir pendência obrigatória.                                              |

Todo trecho `XXXX...` ou `****...` nas minutas é um campo a substituir pelo dado correspondente. Cada ocorrência terá chave, origem, tipo, validação, documento e posição no manifesto do modelo. O sistema suporta várias UCs; o contrato principal usa uma lista dinâmica e a quantidade de procurações/convênios depende da regra jurídica aprovada para titulares e imóveis distintos.

O percentual contratado é sempre informado pelo vendedor, exibido na revisão e congelado na versão preparada. O valor de 23% que hoje aparece fixo na minuta de Goiás não será usado como padrão; a versão automatizada o substituirá pelo percentual informado e pela forma por extenso.

### Identidade e divergências

- Usar CPF/CNPJ normalizado como candidato principal de identidade; nome sozinho não autoriza fusão. E-mail e telefone não substituem a identificação documental.
- Reutilizar a resolução de UC atual e seus aliases. Uma UC antiga não vira uma segunda unidade por engano.
- UC vinculada a outro titular: parar para conferência autorizada, sem transferência silenciosa ou alteração de faturas antigas.
- Dois vendedores concorrentes: constraints no banco e idempotência devem impedir criação duplicada; retornar o registro permitido, sem expor dados de outro vendedor.
- A política anterior de aceitar formato/quantidade de caracteres de CPF/CNPJ não significa identidade verificada. Documentos fictícios ou pendentes devem continuar sinalizados e não podem ser usados como identidade validada para assinatura real.
- Não sobrescrever nome, documento, contato ou desconto existente apenas porque uma nova venda digitou outro valor. Registrar a divergência e o aceite autorizado.
- A usina não faz parte do contrato: será vinculada depois pelos analistas de energia, no processo de rateio.

## 3. Perfis e permissões

| Perfil                      | Permissões propostas                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Vendedor                    | Criar e retomar seus rascunhos; consultar o mínimo necessário para localizar cliente/UC; acompanhar seus contratos; solicitar envio quando autorizado. |
| Conferente/gestor comercial | Validar identidade, resolver divergências e revisar contratos de sua equipe; aprovar envio e correções conforme política.                              |
| Administrador               | Gerenciar modelos, conta DocuSign, permissões, auditoria e contingência.                                                                               |
| Cliente                     | Receber a solicitação de assinatura; depois acessar somente seus documentos e cadastros autorizados.                                                   |

O perfil Vendedor precisa de permissões explícitas no backend, não apenas menus escondidos. Não atribuir simplesmente o nível 1 atual, que possui escopo diferente. Definir quem pode conferir documentos e enviar antes da liberação. Nem acesso comercial nem assinatura concede poder bancário.

## 4. Estados separados

| Objeto             | Estados propostos                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Contrato           | Rascunho → Preparado → Aguardando assinatura → Assinado → Atual; alternativas: Recusado, Cancelado, Substituído. |
| Envio              | Pendente, Em processamento, Confirmado, Resultado incerto, Falha corrigível.                                     |
| Identificação      | Pendente, Em análise, Aprovada, Rejeitada.                                                                       |
| Arquivo final      | Pendente de obtenção, Arquivado, Falha recuperável.                                                              |
| Acesso do cliente  | Pendente de ativação, Ativo, Bloqueado; independente de já existir cadastro.                                     |
| Origem             | Gerado pelo Ecosol/DocuSign ou Importado manualmente.                                                            |
| Conferência manual | Pendente, Validada, Rejeitada; aplicável a contratos importados.                                                 |

Expiração e demais eventos serão mapeados conforme o contrato oficial da API e a configuração da conta. Não inventar transição por suposição. Evento atrasado não regride um contrato concluído. Assinatura confirmada com download pendente deve aparecer como tal, sem afirmar que a cópia já está arquivada.

## 5. Modelo técnico proposto

### Componentes

```text
Interface Contratos
       │ sessão e permissões por recurso
       ▼
Rotas Express → Serviço de contratos → SQLite
                      │                   ├─ versões e vínculos
                      │                   ├─ caixa de saída (outbox)
                      │                   ├─ caixa de eventos (inbox)
                      │                   └─ auditoria
                      ▼
            Armazenamento privado
                      ▲
Executor → Adaptador DocuSign → eSignature API
                     ▲
Webhook HTTPS → validar HMAC → persistir → processar
```

Usar o padrão de executor e reconciliação já praticado no módulo bancário como referência, mas manter tabelas, permissões e adaptador de contratos separados. Nenhum compartilhamento de credenciais com Sicoob ou Gmail.

### Dados e propriedade

- Cliente e UC continuam nas estruturas existentes, com vínculo e histórico preservados.
- Contratos: responsável comercial, estado, referências ao cliente, criação e versão para controle de concorrência.
- Versões: dados confirmados, condições, destinatários, versão do modelo, arquivo e hash; imutáveis após preparação para envio.
- Contrato–UC: relação explícita, sem transformar nome de usina em identificador.
- Versões importadas: arquivo, origem, data de celebração, vigência, hash, responsáveis pelo upload e conferência e vínculo com a versão anterior.
- Anexos: chave privada, tipo real, hash, tamanho, resultado da varredura, conferente, resultado e política de retenção.
- Envelopes: ambiente, conta, identificador remoto, versão local e chave idempotente única.
- Outbox/inbox: persistência durável, tentativas, agenda, erro categorizado e correlação; dados sensíveis mínimos.
- Auditoria: autor, ação, recurso e diferença relevante; não registrar tokens, documentos completos ou links de assinatura.

Migrações futuras serão aditivas e testadas com banco temporário e backup. Criar/reutilizar cliente, associar UC e preparar contrato deve ser uma transação local. A chamada remota acontece depois, sem manter uma transação SQLite aberta durante a rede.

### Interfaces a implementar

Rotas propostas, não existentes: listar/criar rascunhos; editar com versão esperada; anexar documento; registrar conferência; preparar versão; confirmar envio; consultar histórico; obter PDF autorizado; cancelar quando permitido; receber eventos; importar contrato manual; conferir/rejeitar importação; criar versão atualizada.

Usar a convenção `/api/admin/contratos` com autorização comercial por recurso (o prefixo não concede privilégios). Paginar listas e não carregar a base inteira de clientes no celular. Atualizações concorrentes devolvem conflito e pedem revisão, em vez de perder a alteração anterior.

### Contratos manuais e atualizações

- Contrato já realizado manualmente pode ser importado sem reenvio retroativo ao DocuSign, mas entra como **Pendente de conferência**.
- Pessoa autorizada confere identidade, UCs, desconto, assinatura aparente, data e integridade antes de marcá-lo **Importado validado**. Upload sozinho não prova validade jurídica.
- Contrato atualizado nunca substitui o arquivo anterior: cria nova versão com motivo, data e vínculo de precedência.
- Atualização gerada no Ecosol precisa passar pelo DocuSign antes de vigorar. Atualização já assinada fora do sistema segue importação e conferência.
- A versão anterior só recebe **Substituída** quando a nova estiver assinada/validada e vigente; ambas permanecem consultáveis conforme permissão.

## 6. Documento e DocuSign

### Duas opções reais

| Opção                                 | Benefício                                                                        | Limitação / custo                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| DocuSign Document Generation com DOCX | Campos nomeados e tabela dinâmica para várias UCs; integra geração e assinatura. | Exige fontes editáveis e contratação do recurso na conta de produção.               |
| HTML/CSS versionado → PDF + envelope  | Controle local de conteúdo, paginação e várias UCs sem depender do gerador pago. | Exige recriação aprovada das minutas, navegador de renderização e gestão de fontes. |

Os seis PDFs aprovados são a referência visual obrigatória. O sistema não deve apresentar um contrato redesenhado nem apenas semelhante: contrato, procuração e convênio precisam conservar páginas, identidade visual, cláusulas, tipografia, margens e demais elementos do respectivo modelo de Goiás ou do Distrito Federal. Somente os locais mapeados para dados variáveis podem ser alterados.

A composição usará cada página aprovada como base imutável e aplicará uma camada controlada de dados sobre as posições cadastradas no manifesto versionado. Essa camada substitui os marcadores e também o percentual fixo aprovado para se tornar variável, sem reescrever as demais cláusulas. Nomes longos, endereços e múltiplas UCs terão regras explícitas de ajuste, quebra e continuidade; se o conteúdo não couber sem alterar indevidamente o modelo, a preparação será bloqueada para conferência em vez de deformar o documento.

A prévia exibida, o arquivo baixado e o arquivo enviado ao DocuSign serão derivados do mesmo PDF preparado e do mesmo hash. Uma visualização HTML pode existir apenas como interface ao redor do visualizador de PDF; ela nunca substitui o documento contratual nem serve como fonte independente de geração.

A assinatura inicialmente será remota, pelo convite do DocuSign. Não é necessário criar uma conta DocuSign para cada cliente nem duplicar o envio pelo Gmail. Assinatura embarcada pode ser evolução futura, não dependência do primeiro lançamento. [Referência oficial de envio com template](https://developers.docusign.com/docs/esign-rest-api/how-to/request-signature-template-remote/).

### Conexão

Proposta inicial: um administrador autoriza a conta remetente no backend via OAuth Authorization Code confidencial, com `state` e PKCE. Os vendedores usam suas próprias contas Ecosol, sem conhecer credenciais DocuSign. JWT com consentimento/impersonação é alternativa se a política da conta exigir execução como serviço; não assumir permissão apenas porque a empresa já usa assinatura manualmente. [Autenticação oficial](https://developers.docusign.com/platform/auth/confidential-authcode-get-token/).

Tokens e segredo ficam cifrados no servidor, com rotação, expiração e revogação. A conta e a URI-base devem ser obtidas e vinculadas à configuração autorizada. Separar demonstração de produção. Confirmar plano, acesso à API, remetente, templates, Connect e procedimento de promoção aplicável à conta. Não assumir que o plano atual já cobre a integração. [Developer Console e promoção](https://developers.docusign.com/platform/create-ik-developer-console/).

### Envio e retorno confiáveis

1. Confirmar versão, destinatários, autorização e documentos antes de criar a saída durável.
2. Reservar uma única operação por contrato/versão. Repetir o clique retorna a mesma operação; payload diferente exige nova versão.
3. Executor com lease envia e associa o envelope. Validar o uso de `transactionId` e sua janela na documentação vigente durante a implementação; ele não substitui o registro local permanente.
4. Timeout após envio vira **resultado incerto**. Consultar/reconciliar antes de reenviar; quando não for possível provar o resultado, pedir intervenção, sem criar outro envelope às cegas.
5. Validar HMAC sobre os bytes originais do webhook, vincular conta/ambiente/envelope e persistir o evento antes de confirmar recebimento. Processar com deduplicação e tolerância a reordenação. [HMAC oficial](https://www.docusign.com/blog/developers/manually-authenticating-hmac-signatures-docusign-connect-webhook-configurations).
6. Confirmar estado remotamente quando houver conflito; buscar PDF final e certificado de conclusão, guardar cópia protegida e hash. Não marcar como assinado pelo redirecionamento do navegador.

Configurar limites, timeouts e consultas conforme a API efetivamente contratada. Repetir apenas leituras ou operações comprovadamente seguras; 429 respeita a orientação de espera do provedor. Falha de credencial pede reconexão administrativa, não tentativas infinitas.

## 7. Segurança e documentos pessoais

- Upload em área privada; limite de tamanho e quantidade; tipo verificado por conteúdo; nomes gerados no servidor; proteção contra travessia de diretórios e conteúdo ativo.
- Arquivos em quarentena até varredura. Scanner indisponível mantém a pendência, não libera automaticamente.
- Sem CPF, fotos, segredo ou documento real em Jira, protótipo, telemetria ou repositório. Sem PII em `localStorage`, cache offline ou service worker por padrão.
- Download e prévia autenticados por recurso, sem URL pública permanente. Arquivos sensíveis sem cache público, com trilha de consulta.
- Documento de identidade não é anexado ao envelope por padrão: limitar o compartilhamento ao necessário.
- Definir finalidade, aviso de privacidade, responsável, retenção e descarte com a empresa antes da produção. Não estabelecer prazo legal por suposição.
- Ativação do cliente por token único, expirável e revogável; vendedor não escolhe nem vê senha. Preservar política de não liberar portal sem e-mail.
- Verificação automática/biométrica não faz parte da proposta inicial; depende de serviço específico, contratação e avaliação própria.

## 8. Design e localização

**Contratos** terá navegação própria ao lado de Cadastros e será a página inicial do perfil Vendedor. Cadastros continua como manutenção da base, Usinas como alocação posterior e Faturas como cobrança. Nos detalhes do cliente pode haver um atalho para seus contratos, sem duplicar o formulário.

Para vendedor: página inicial com **Meus contratos**, busca, filtros de situação e **Novo contrato** dentro da barra do card. Lista enxuta com cliente, UC, situação e última atividade; documentos e histórico ficam no detalhe. Gestores podem ampliar para a equipe se autorizados.

O cadastro tem quatro etapas, no máximo duas colunas no desktop e uma no celular. Campos obrigatórios são identificados, ajuda aparece onde necessária, e erro leva ao campo com foco visível. Pendência tem texto e ícone, não só cor. Uma ação principal por etapa; rodapé móvel com Voltar/Continuar sem cobrir conteúdo.

Usar `frontend/src/identidadeMinimalista.css`: azul-petróleo `#0f6670`, texto `#173642`, fundo `#f5f7f5`, branco e amarelo solar pontual `#e9b832`. Bordas suaves, sombras leves, ícones com texto e animações discretas com `prefers-reduced-motion`. Sem painéis gigantes, brilhos intensos ou informações repetidas.

Rascunho salvo somente após confirmação do servidor. Rede perdida mostra **Sem conexão — alterações ainda não salvas**. Não prometer funcionamento offline completo; persistência offline de documentos pessoais é uma fase separada.

O arquivo `prototipo.html` é apenas uma demonstração local, sem backend, upload ou envio. Não inserir dados reais nele.

## 9. Testes e implantação

| Frente     | Evidência exigida antes da liberação                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| Cadastro   | Cliente novo/existente, várias UCs, aliases, titular divergente, duplicidade e concorrência.                          |
| Acesso     | Vendedor não consulta/edita contrato alheio, downloads e buscas restritos, revogação de sessão e papéis.              |
| Documentos | Arquivo inválido, grande, malicioso, ilegível, scanner indisponível e rejeição registrada.                            |
| Contrato   | Campos ausentes, acentos, nomes longos, PF/PJ, múltiplas páginas, snapshot e prévia equivalentes.                     |
| Integração | Mock determinístico, sandbox, token expirado, limites, timeout antes/depois do POST e sucesso remoto com falha local. |
| Eventos    | HMAC inválido, replay, duplicados, fora de ordem, envelope/conta errados e falha de gravação.                         |
| Conclusão  | PDF/certificado pendentes, reprocessamento sem duplicar, convite único e assinatura sem gerar boleto.                 |
| UX         | Celular 360px, tablet 768px, desktop 1440px, teclado, foco, contraste e rede instável.                                |

Liberar por feature flag para poucos vendedores, com sandbox antes de produção. Monitorar envelopes incertos, filas atrasadas, falhas de webhook, downloads pendentes e custo/quantidade de envios. Suspender novos envios como rollback, mantendo recepção e reconciliação dos envelopes já ativos. Testar restauração de backup antes da operação real.

Não foram executados testes de integração DocuSign nesta fase de planejamento.

## 10. Dependências e sequência

1. Aprovação dos dois pacotes regionais, manifesto de marcadores, papéis e política de conferência.
2. Navegação e permissões do vendedor; cadastro integrado; documentos protegidos.
3. Geração/prévia; conexão e envio idempotente.
4. Retorno das assinaturas, arquivos e convite; homologação completa.

Podemos construir a estrutura e testar com exemplos sintéticos enquanto as lacunas jurídicas são resolvidas. Envio real depende também da conta/API autorizada, HTTPS, política de dados e aceite dos modelos. Confirmar texto de PJ, regra de procurações/convênios para múltiplas UCs, potência, signatários, datas/foro e quando liberar acesso ao portal.

As novas entregas serão vinculadas à SEJM-11 e registradas em `backlog.md`. O projeto Jira atualmente oferece o tipo Tarefa; não será criada uma hierarquia fictícia de épicos. As tarefas existentes de maior prioridade permanecem inalteradas.

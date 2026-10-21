# Matriz de decisões — Camada 1

Data do levantamento: 21/10/2026. Escopo: conteúdo necessário para transformar as seis minutas registradas em fontes editáveis aprovadas. Esta matriz não interpreta validade jurídica; ela identifica decisões que os responsáveis precisam confirmar antes da publicação.

## Decisões de produto já estabelecidas

| ID   | Decisão                                                            | Efeito no modelo                                                                                | Responsável pelo aceite final |
| ---- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------- |
| D-01 | Um contrato aceita uma ou mais UCs.                                | Relação repetível no contrato principal; procuração/convênio dependem de regra jurídica.        | Jurídico + comercial          |
| D-02 | O vendedor informa o percentual contratado.                        | Campo obrigatório, mostrado na revisão e congelado na versão preparada.                         | Comercial + jurídico          |
| D-03 | Não existe desconto padrão.                                        | Os 23% fixos do contrato de Goiás precisam ser substituídos por campo variável.                 | Jurídico                      |
| D-04 | A usina não integra o contrato.                                    | Nenhum campo, validação ou bloqueio de usina; alocação ocorre depois, por analistas de energia. | Operação de energia           |
| D-05 | Goiás e DF são pacotes independentes.                              | Cada seleção usa somente seus três documentos, empresa e concessionária.                        | Comercial + jurídico          |
| D-06 | Todo `XXXX...` ou `****...` é substituído por dado correspondente. | Marcadores viram campos nomeados; marcador residual bloqueia publicação/envio.                  | Produto + jurídico            |
| D-07 | Prévia e download são permitidos antes da assinatura.              | Cópia permanece identificada como não assinada e não libera cadastro ou venda.                  | Produto + operação            |
| D-08 | DocuSign é obrigatório para concluir contratos gerados no Ecosol.  | Somente confirmação do backend libera a venda e o arquivamento como assinado.                   | Produto + jurídico            |
| D-09 | Contratos já realizados manualmente podem ser importados.          | Entram com origem manual e conferência; não recebem envelope DocuSign retroativo fictício.      | Produto + operação            |
| D-10 | Contrato atualizado é uma nova versão.                             | Histórico não é sobrescrito; versão anterior só é substituída após nova validação e vigência.   | Produto + jurídico            |

## Decisões pendentes que bloqueiam a fonte aprovada

| ID   | Documento/página                         | Situação encontrada                                                                          | Decisão necessária                                                                                                | Responsável sugerido              |
| ---- | ---------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| P-01 | Todos os contratos e convênios, p. 1     | Qualificação usa pessoa física, “brasileiro” e CPF.                                          | Fornecer redação para pessoa jurídica, representante e comprovação de poderes; confirmar nacionalidade variável.  | Jurídico                          |
| P-02 | Contrato GO, p. 5                        | Desconto fixo de 23% e “vinte e três por cento”.                                             | Aprovar redação com percentual do vendedor em número e por extenso.                                               | Jurídico + comercial              |
| P-03 | Contrato GO, p. 3                        | Relação de UC possui um único marcador em lista singular.                                    | Aprovar tabela/lista repetível para várias UCs e sua paginação.                                                   | Jurídico + comercial              |
| P-04 | Contrato DF, p. 3                        | Usa par “código da instalação + código do cliente”.                                          | Confirmar se esses dois campos representam a UC atual no cadastro e se ambos são sempre obrigatórios.             | Operação DF + comercial           |
| P-05 | Procuração GO, p. 1                      | Outorgante contém somente endereço variável; nome e CPF não aparecem como marcadores.        | Confirmar qualificação completa do outorgante e os campos obrigatórios.                                           | Jurídico                          |
| P-06 | Procurações GO/DF, p. 1                  | Campo de procurador aparece como opcional.                                                   | Definir quem assina, se procurador é opcional e a ordem/papel no DocuSign.                                        | Jurídico + operação DocuSign      |
| P-07 | Procuração e convênio GO                 | Data está fixa em 26/05/2026.                                                                | Substituir por data do pacote, data da assinatura ou outra regra aprovada.                                        | Jurídico                          |
| P-08 | Todos os documentos                      | Ano aparece fixo como 2026, com dia/mês parcialmente variáveis.                              | Definir data completa dinâmica e fonte oficial do valor.                                                          | Jurídico + operação               |
| P-09 | Documentos DF                            | Fecho usa Anápolis, embora o pacote se destine ao DF.                                        | Confirmar local de assinatura ou regra baseada no signatário.                                                     | Jurídico                          |
| P-10 | Convênio DF, p. 2                        | Foro indicado é Comarca de Anápolis.                                                         | Confirmar se é intencional ou fornecer foro correto do pacote DF.                                                 | Jurídico                          |
| P-11 | Contrato GO, p. 1                        | Potência usa fórmula `(kWh - taxa mínima / 132) kWp`.                                        | Confirmar precedência, unidade, arredondamento, fonte dos valores e se o resultado é total ou por UC.             | Energia + comercial + jurídico    |
| P-12 | Contrato DF, p. 1                        | Potência é marcador `XXX kWp`.                                                               | Definir origem, precisão, unidade e se é total ou por UC.                                                         | Energia + comercial               |
| P-13 | Procurações e convênios                  | Texto trata um titular/imóvel no singular.                                                   | Decidir quando gerar um documento conjunto ou uma instância por UC, titular ou imóvel.                            | Jurídico                          |
| P-14 | Todos os documentos                      | Não há regra aprovada para testemunhas, representantes adicionais ou assinatura pela Ecosol. | Definir signatários, papéis, ordem, campos e obrigatoriedade por documento.                                       | Jurídico + operação DocuSign      |
| P-15 | Dados fixos das seis minutas             | Empresas, representantes, CPF/CNPJ, endereços e concessionárias são texto fixo.              | Conferir cada dado cadastral numa fonte corporativa autorizada e registrar aprovador; não corrigir por suposição. | Administrativo + jurídico         |
| P-16 | Contrato GO, cláusula 3.7                | Lista de possíveis titulares/empresas precisa de conferência cadastral e textual.            | Validar nomes e CNPJs ou retirar a enumeração na versão revisada.                                                 | Jurídico + administrativo         |
| P-17 | Contratos, p. 7; procurações e convênios | Quantidade de vias e linguagem de assinatura variam, embora o fluxo seja digital.            | Fornecer redação adequada ao DocuSign e confirmar validade da via eletrônica.                                     | Jurídico                          |
| P-18 | Contratos e convênios                    | Prazos e renovação aparecem como texto fixo, inclusive 12 meses/um ano.                      | Confirmar se são imutáveis ou condições comerciais versionadas.                                                   | Jurídico + comercial              |
| P-19 | Desconto contratado                      | Não há faixa, escala, precisão ou regra para escrita por extenso aprovada.                   | Definir mínimo/máximo, casas decimais, truncamento/arredondamento e forma por extenso.                            | Comercial + financeiro + jurídico |
| P-20 | Documento com foto                       | Minutas não definem como o anexo pessoal participa do contrato.                              | Confirmar que serve apenas para conferência e não integra o envelope, além de finalidade e retenção.              | Privacidade + jurídico + operação |
| P-21 | Importação manual                        | Não há política para decidir se contrato externo está suficientemente assinado e completo.   | Definir conferentes autorizados, evidências mínimas, rejeição, recurso e auditoria.                               | Jurídico + operação               |
| P-22 | Contratos atualizados                    | Não há regra de vigência e substituição entre versões.                                       | Definir motivo, data de vigência, efeito sobre condições/UCs e quando a versão anterior vira substituída.         | Jurídico + comercial              |

## Governança a preencher

| Papel                    | Pessoa definida | Responsabilidade                                                                    |
| ------------------------ | --------------- | ----------------------------------------------------------------------------------- |
| Aprovador jurídico       | Pendente        | Texto, foro, qualificação, poderes, signatários, composição e validade das versões. |
| Aprovador comercial      | Pendente        | Condições, desconto, vigência e aderência ao processo de venda.                     |
| Aprovador operacional    | Pendente        | Execução do fluxo, DocuSign, conferência e publicação.                              |
| Consultado — energia     | Pendente        | Identificadores, potência e transição posterior para alocação/rateio.               |
| Consultado — privacidade | Pendente        | Documento com foto, acesso, finalidade, retenção e descarte.                        |

Uma mesma pessoa pode ocupar mais de um papel se isso for formalmente decidido, mas cada tipo de aceite deve ficar registrado separadamente.

## Regra de encerramento

A Camada 1 somente passa para **Concluída** quando:

1. os arquivos editáveis forem recebidos ou a reconstrução for autorizada;
2. os três aprovadores forem definidos;
3. P-01 a P-22 tiverem decisão registrada ou forem explicitamente adiados para uma versão futura sem afetar o primeiro pacote;
4. qualquer fonte revisada receber novo hash e histórico de versão;
5. jurídico, comercial e operação confirmarem que a Camada 2 pode criar o manifesto sem interpretar cláusulas por conta própria.

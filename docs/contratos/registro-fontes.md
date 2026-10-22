# Registro de fontes contratuais

Inventário iniciado em 21/10/2026 para a Camada 1 da [SEJM-29](https://sistema-ecosol.atlassian.net/browse/SEJM-29). Os PDFs permanecem fora do repositório; este registro guarda apenas metadados técnicos necessários para identificar as versões analisadas.

## Pacote Goiás

| Tipo                   | Arquivo de origem                                | Páginas | Tamanho (bytes) | SHA-256                                                            |
| ---------------------- | ------------------------------------------------ | ------: | --------------: | ------------------------------------------------------------------ |
| Contrato               | `MINUTA - CONTRATO - ECOSOL.pdf`                 |       7 |          250789 | `19b49109a3f39784f0cc0723412e545f3e17a95ffa13e49cd4b438ee249e4987` |
| Procuração             | `MINUTA PROCURAÇÃO.pdf`                          |       1 |          110445 | `ae669fd657c89d2e6058c13e0c80302a3400e28667c66168afe7b49a5da45c05` |
| Convênio de utilização | `MINUTA - CONTRATO - Convenio de Utilização.pdf` |       2 |          196894 | `996c90b5e9501ee1442d7936064b94ae775d024ecc7488ec5f308265295ddc69` |

**Empresa contratada na fonte:** Grupo Ecosol Condomínio Solar Ltda.

**Concessionária citada:** Equatorial Distribuição Goiás.

**Abrangência definida:** estado de Goiás.

## Pacote Distrito Federal

| Tipo                   | Arquivo de origem                                         | Páginas | Tamanho (bytes) | SHA-256                                                            |
| ---------------------- | --------------------------------------------------------- | ------: | --------------: | ------------------------------------------------------------------ |
| Contrato               | `MINUTA - CONTRATO ECOSOL ENERGY HUB LTDA (1).pdf`        |       7 |          243977 | `9f6af209185ee0dd9404ed1c5c9f46ad5bb3b70d01b5cf5db6d505b1c4307011` |
| Procuração             | `MINUTA PROCURAÇÃO - ECOSOL ENERGY HUB LTDA .pdf`         |       1 |          102644 | `9a64a94d9751ba2d5b84be980fc8ea0b47a92154164f980d9b78f7ff5413c83e` |
| Convênio de utilização | `MINUTA CONVÊNIO UTILIZAÇÃO - ECOSOL ENERGY HUB LTDA.pdf` |       2 |          179114 | `934fc80ec32f3c3b67ddba1ddf79dfcfc3c5b867f9dbe949902358be45db6b8e` |

**Empresa contratada na fonte:** Ecosol Energy Hub Ltda.

**Concessionária citada:** Neoenergia.

**Abrangência definida:** Distrito Federal.

## Controles aplicados

- Os seis arquivos são PDFs A4, não criptografados e sem campos AcroForm.
- O hash identifica exatamente o arquivo analisado. Arquivo com conteúdo diferente é uma nova fonte e precisa de novo registro.
- O PDF aprovado é a base visual imutável da composição de produção. Ele não será alterado diretamente: o sistema gera uma nova instância aplicando somente os dados variáveis nas posições versionadas.
- Arquivos editáveis DOCX ainda não foram recebidos.
- Dados pessoais reais não devem ser adicionados ao repositório, ao Jira ou aos exemplos de homologação.

## Matriz inicial de decisões

| Decisão                                                   | Situação                                                     | Responsável pelo aceite                   |
| --------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------- |
| Desconto informado pelo vendedor, sem valor padrão        | Definida pelo produto; redação de Goiás precisa ser revisada | Jurídico + comercial                      |
| Mais de uma UC por contrato                               | Definida pelo produto                                        | Jurídico valida composição documental     |
| Usina fora do contrato                                    | Definida pelo produto                                        | Operação/energia recebe a etapa posterior |
| Texto de pessoa jurídica e representante                  | Pendente                                                     | Jurídico                                  |
| Uma ou várias procurações/convênios por titular ou imóvel | Pendente                                                     | Jurídico                                  |
| Potência do gerador e fórmula                             | Pendente                                                     | Comercial + energia + jurídico            |
| Datas, local e foro dos dois pacotes                      | Pendente                                                     | Jurídico                                  |
| Papéis, ordem e locais de assinatura                      | Pendente                                                     | Jurídico + operação DocuSign              |
| Document Generation disponível em produção                | Pendente                                                     | Administrador da conta DocuSign           |

## Critério para concluir a Camada 1

- [x] Seis fontes identificadas, separadas por região e tipo.
- [x] Hash SHA-256 e metadados registrados.
- [x] Divergências iniciais listadas.
- [ ] Fontes editáveis DOCX recebidas ou reconstrução formalmente autorizada.
- [ ] Aprovador jurídico definido.
- [ ] Aprovador comercial definido.
- [ ] Aprovador operacional definido.
- [ ] Cada divergência possui decisão ou responsável com acompanhamento.

A Camada 1 permanece **em andamento**. O inventário técnico está completo; os itens organizacionais e jurídicos acima impedem seu aceite final.

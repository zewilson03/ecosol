# Backlog — Contratos e DocuSign

Registrado no Jira em 21/10/2026. Todas as oito entregas novas têm prioridade **Medium (média)** e ficam a desenvolver; planejamento não representa implementação concluída.

| Ordem | Tarefa                                                         | Entrega                                    | Dependência principal                           |
| ----- | -------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| 1     | [SEJM-29](https://sistema-ecosol.atlassian.net/browse/SEJM-29) | Aprovar modelos GO/DF, marcadores e regras | Revisão jurídica/comercial e arquivos editáveis |
| 2     | [SEJM-30](https://sistema-ecosol.atlassian.net/browse/SEJM-30) | UX móvel por região, UCs e desconto        | Regras da SEJM-29 e permissões                  |
| 3     | [SEJM-31](https://sistema-ecosol.atlassian.net/browse/SEJM-31) | Cadastro integrado e múltiplas UCs         | Cadastro existente e identificadores regionais  |
| 4     | [SEJM-32](https://sistema-ecosol.atlassian.net/browse/SEJM-32) | Documentos e conferência protegida         | Política documental e permissões                |
| 5     | [SEJM-33](https://sistema-ecosol.atlassian.net/browse/SEJM-33) | Gerar e versionar pacotes GO/DF            | 1, 3 e 4; confirmação do recurso DocuSign       |
| 6     | [SEJM-34](https://sistema-ecosol.atlassian.net/browse/SEJM-34) | Conexão DocuSign e envio idempotente       | 5 e acesso técnico à conta                      |
| 7     | [SEJM-35](https://sistema-ecosol.atlassian.net/browse/SEJM-35) | Assinatura, arquivo e pós-assinatura       | 3, 4 e 6                                        |
| 8     | [SEJM-36](https://sistema-ecosol.atlassian.net/browse/SEJM-36) | Homologar pacotes e contingência           | Aceite integrado de 1–7                         |

Relacionadas à tarefa existente [SEJM-11 — Cadastros de clientes e contratos](https://sistema-ecosol.atlassian.net/browse/SEJM-11). Sua prioridade original não foi reduzida: ela também cobre fundamentos já existentes do cadastro. O projeto oferece somente o tipo Tarefa, por isso não foi criado um épico nem uma hierarquia artificial.

As dependências acima indicam ordem de implementação; as relações com SEJM-11 servem para rastreabilidade. Não alteram a responsabilidade do Matheus sobre Faturas. Não foram atribuídas contas por suposição nem alterados os tickets bancários.

## Próximo passo

Executar a [SEJM-29](https://sistema-ecosol.atlassian.net/browse/SEJM-29) em cinco camadas: fontes e governança; contrato de dados e marcadores; composição documental sobre os PDFs originais; prova de geração; aprovação e publicação. Começar pela identificação e hash das seis fontes, pelo manifesto de posições variáveis e pela definição dos responsáveis pelo aceite. A saída deve manter exatamente o modelo recebido; HTML/CSS pode compor a interface, mas não substituir o documento contratual.

## Artefatos

- [Solução, fluxo, segurança e testes](README.md)
- [Análise das seis minutas e arquitetura](analise-minutas-e-arquitetura.md)
- [Processo 01 — etapas, tecnologias e aceites da SEJM-29](processo-01-modelos.md)
- [Registro das seis fontes e hashes](registro-fontes.md)
- [Matriz de decisões e governança da Camada 1](matriz-decisoes-camada-1.md)
- [Checklist para aceite da Camada 1](checklist-aceite-camada-1.md)
- [Protótipo navegável — somente demonstração](prototipo.html)

O protótipo não salva dados, não faz upload e não envia documentos. Não inserir dados pessoais reais.

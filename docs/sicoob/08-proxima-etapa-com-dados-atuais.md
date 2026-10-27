# Próxima etapa com os dados atuais

Atualizado em: 22/10/2026.

## Objetivo

Avançar a integração Sicoob sem depender temporariamente do endereço real dos clientes e sem emitir boleto no banco. Dados fictícios são permitidos somente em testes automatizados e na homologação local; nunca são gravados como cadastro definitivo nem usados em produção.

## Trabalho possível agora

1. **Fechar o contrato de cobrança local — concluído:** inclusão e consulta seguem o contrato oficial Cobrança v3, com tratamento seguro de rejeição, autenticação, limite, timeout, resposta malformada, `nossoNumero` divergente e situação desconhecida.
2. **Preservar artefatos — concluído:** linha digitável, código de barras, QR Code, PDF e hash são persistidos; conteúdo divergente não substitui silenciosamente o registro anterior.
3. **Consulta e conciliação manual — concluída em homologação simulada:** o serviço e a ação administrativa consultam somente operações com `nossoNumero`, impedem concorrência por cobrança, registram o solicitante e cada tentativa e nunca rebaixam uma liquidação confirmada. Claims expirados são recuperados com nova consulta, sem reemissão, e respostas atrasadas do processo anterior são ignoradas. O comando real permanece bloqueado até a integração oficial ser homologada.
4. **Prontidão operacional — backend e interface concluídos:** o endpoint administrativo expõe somente presença e suficiência de OAuth, mTLS, escopos, versão e convênio, sem caminhos ou segredos. A interface exclusiva do administrador diferencia consulta, emissão, executor e produção, traduz pendências e informa explicitamente que configuração completa não autoriza operação.
5. **Observabilidade — backend e interface concluídos:** o endpoint protegido consolida executor, operações, intenções, tentativas, conciliações, idade do estado, prioridade e ação necessária. A interface apresenta saúde, totais e pendências para auditoria ou administração da integração; somente o administrador da integração pode iniciar a consulta manual, mediante a senha atual da equipe. Não retorna nem apresenta snapshot, idempotência, identificador externo, CPF, segredo ou payload.
6. **Testes sintéticos:** cobrir concorrência, reinício, perda de resposta, persistência local, PDF inválido, divergência de identificador e restauração com executor pausado.

## Dependências que ficam aguardando

- O trabalho de Clientes/Usinas fornecerá endereço, bairro, cidade, CEP e UF reais.
- A ligação do cadastro ao snapshot bancário será feita somente após o merge e revisão do contrato de dados.
- Certificado, chave privada, `client_id` e dados oficiais do convênio permanecem fora do repositório.
- Emissão conectada exige autorização específica e dados sintéticos aceitos pelo ambiente de homologação do Sicoob.
- Produção depende dos testes P0, backup/restauração, monitoramento, limites e piloto formalmente aprovados.

## Critérios de aceite desta próxima etapa

- Nenhum dado fictício aparece em cadastro ou configuração de produção.
- Nenhum POST financeiro é repetido após resultado inconclusivo.
- Consulta exige identificador bancário válido e confere o `nossoNumero` retornado.
- Artefatos divergentes permanecem visíveis para conferência e nunca sobrescrevem silenciosamente o registro anterior.
- Testes bancários, teste do contrato oficial, build e verificação de formatação passam.
- Executor continua desligado e nenhuma chamada financeira real é realizada.

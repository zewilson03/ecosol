# Validação desta proposta

Data: 21/10/2026.

## Confirmado

- Atualização das oito tarefas existentes SEJM-29 a SEJM-36, todas mantidas em prioridade Medium, com pacotes GO/DF, múltiplas UCs, desconto informado pelo vendedor, marcadores e ausência de usina no contrato.
- Formatação dos arquivos Markdown e HTML: Prettier passou.
- JavaScript do protótipo: análise de sintaxe com `vm.Script` passou.
- Script sem chamadas de rede e sem armazenamento persistente no navegador.
- Inspeção visual na janela disponível do navegador: lista e formulário sem sobreposição observada.
- Interação Novo contrato abriu o formulário; alternância PF/PJ mostrou CPF/CNPJ, razão social e representante; conclusão exibiu explicitamente que nenhum cliente ou envio foi criado.
- Análise textual e visual das seis minutas: dois contratos de 7 páginas, duas procurações de 1 página e dois convênios de 2 páginas; PDFs sem AcroForm.
- Regra documentada: cada `XXXX...`/`****...` é substituído por campo nomeado; desconto é obrigatório e informado pelo vendedor, sem 23% padrão.
- SEJM-29 dividida em cinco camadas com objetivo, tecnologias, entrega e aceite por camada, além do critério de aceite total.
- Camada 1 iniciada: seis PDFs separados por região/tipo, metadados e hashes SHA-256 registrados; comentário de andamento confirmado pelo Jira (`10029`).
- Matriz da Camada 1 consolidada com 10 decisões de produto, 22 decisões pendentes, responsáveis sugeridos e regra objetiva de encerramento; o comentário `10029` foi atualizado em vez de criar duplicata.
- Checklist de aceite criado para registrar fontes editáveis, responsáveis, parecer por área, resultado e controle de mudança sem dados pessoais.
- Fluxo confirmado: prévia/download não liberam venda; DocuSign é obrigatório para contratos novos; contratos manuais exigem conferência; atualizações criam versão sem sobrescrever histórico. SEJM-29, SEJM-30, SEJM-33, SEJM-34 e SEJM-35 foram atualizadas.
- `git diff --check` sem erros. Alterações desta tarefa restritas a `docs/contratos/`, inicialmente não rastreadas; nenhum código de produção alterado.

## Não realizado / pendente

- Teste de API, webhook, geração de contrato real, criação de cliente ou envio de assinatura.
- Homologação em celular real, larguras 360/768/1440 e auditoria completa de acessibilidade.
- Aprovação jurídica/comercial das minutas, fontes editáveis e manifesto final dos marcadores.
- Definição nominal dos aprovadores jurídico, comercial e operacional da Camada 1.
- O workflow atual da SEJM-29 não oferece status “Em andamento”; “Em espera - Andamento” representa espera e não foi usado. O trabalho iniciado ficou registrado no comentário `10029`, mantendo o card em “A Desenvolver”.
- Decisão jurídica sobre uma ou várias procurações/convênios quando houver UCs, titulares ou imóveis distintos.
- Confirmação de API/plano, credenciais, remetentes e política documental da empresa.
- Um primeiro pedido de atualização da SEJM-31 retornou timeout; a gravação foi repetida individualmente e o Jira confirmou o novo resumo, descrição, prioridade Medium e status A Desenvolver.

O servidor local de apresentação serve somente `prototipo.html` em `127.0.0.1:4178`. É temporário, não faz parte do servidor Ecosol e não acessa o banco. O HTML também pode ser aberto diretamente como arquivo.

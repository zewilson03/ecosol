# Prontidão operacional — quarta entrega

Atualizado em: 22/10/2026.

## Objetivo

Apresentar ao administrador da integração os portões técnicos que ainda impedem a homologação e a produção, sem revelar valores de credenciais, certificado, chave privada, convênio ou conta bancária.

## Acesso

O endpoint e a interface exigem `administrador_integracao`. O frontend apenas deixa de renderizar o painel para outros papéis; a autorização obrigatória permanece no backend.

## Portões apresentados

- referência interna da conta;
- endereço oficial da API;
- OAuth e escopos;
- certificado e chave mTLS;
- versão do contrato oficial;
- convênio suficiente para consulta;
- convênio suficiente para emissão;
- disponibilidade e pausa do executor real;
- ambiente selecionado e bloqueio de produção.

Cada portão apresenta somente `Configurado` ou `Pendente`. A tela nunca devolve o valor, caminho, identificador bancário ou segredo correspondente.

## Regra de liberação

Configuração completa não significa autorização operacional. Produção depende também de executor real implementado, homologação conectada aprovada, testes P0, responsáveis nominais, backup e restauração verificados e autorização humana explícita.

Nesta entrega, `executor_real_disponivel` permanece falso. Portanto, mesmo uma configuração completa continua visualmente bloqueada para produção.

## Critérios de aceite

- somente o administrador da integração consulta o diagnóstico;
- carregamento, erro e atualização manual são tratados;
- consulta, emissão, executor e produção aparecem como portões independentes;
- pendências técnicas recebem descrições compreensíveis;
- código desconhecido não é apresentado diretamente como instrução;
- não existe comando de emissão, ativação ou teste de credencial nesta tela;
- segredo, caminho de certificado, conta e dados do convênio não aparecem na resposta ou interface;
- layout é compreensível por texto e não depende apenas de cor;
- frontend responsivo e build são validados;
- o executor e a produção permanecem bloqueados.

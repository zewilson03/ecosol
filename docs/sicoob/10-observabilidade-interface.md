# Observabilidade bancária — segunda entrega

Atualizado em: 22/10/2026.

## Escopo

A segunda entrega apresenta no painel bancário os dados seguros produzidos pelo endpoint `GET /api/admin/bancario/observabilidade`. A tela é exclusivamente consultiva: não chama o Sicoob, não altera operações, não executa conciliação e não muda o executor.

## Acesso e integração

A visão é solicitada somente para usuários com `consulta_auditoria` ou `administrador_integracao`. O backend continua sendo a autoridade final e rejeita qualquer perfil sem esses papéis.

A interface reutiliza a sessão, o cliente HTTP e os componentes de estado já existentes. Não foi criada dependência, rota de navegação ou fonte paralela de verdade.

## Conteúdo apresentado

- ambiente, modo e situação do executor;
- total de operações e conciliações;
- quantidade de pendências e intervenções;
- prioridade, ação recomendada e tempo no estado;
- valor com moeda BRL explícita, vencimento, identificador local abreviado e presença do identificador do provedor;
- contexto categorizado da conciliação e código seguro da tentativa;
- horário de geração da visão e atualização manual.

## Critérios de aceite

- a tela só consulta o endpoint para auditor ou administrador da integração;
- nenhuma ação financeira está disponível na visão;
- prioridade alta, média e informativa são distinguíveis por texto e cor;
- prioridades são ordenadas da mais urgente para a menos urgente e, dentro do grupo, da mais antiga para a mais recente;
- a priorização ocorre no backend antes do limite de resposta, impedindo que uma urgência recente seja omitida;
- quando o resultado é limitado, a tela informa quantas pendências existem e quantas estão visíveis;
- valores BRL exibem a moeda e códigos inesperados não são formatados como reais;
- a informação permanece compreensível sem depender apenas da cor;
- carregamento, erro, lista vazia e atualização manual são tratados;
- a tela se reorganiza em larguras intermediárias e móveis;
- nenhum CPF, segredo, payload ou identificador externo é apresentado;
- o fluxo bancário existente permanece independente da visão.
- regras de prioridade, moeda e ausência de comandos financeiros possuem teste automatizado próprio.

## Metodologia

Foi adotada divulgação progressiva: primeiro saúde e totais, depois as pendências que exigem atenção. A interface deriva rótulos de códigos controlados do backend, mas não toma decisões financeiras. A segurança combina menor privilégio no cliente com autorização obrigatória no servidor, e a apresentação usa texto, hierarquia e contraste além de cor.

## Fora desta entrega

- filtros e paginação por cursor;
- consulta ou recuperação manual;
- alertas externos e séries históricas;
- mudança de estado ou controle do executor a partir da observabilidade.

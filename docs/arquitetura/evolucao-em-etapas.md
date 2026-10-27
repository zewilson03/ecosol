# Evolução arquitetural em etapas

## Decisão reavaliada em 26/10/2026

Manter o monólito modular e fortalecer as fronteiras por fluxo. A decisão é
provisória e baseada no acoplamento observado, na equipe atual e na operação
prevista; não é uma conclusão de benchmark. Ainda faltam medições de latência
p95, CPU, memória, atraso do event loop, idade das filas e contenção SQLite.
Volume financeiro em reais não mede demanda computacional. Os volumes informados
de até 170 boletos emitidos e 70 pagos por dia não bastam para dimensionar picos
de importação, usuários simultâneos ou tempo de processamento de PDFs.

O processo em `backend/servidor/iniciar.mjs` reúne HTTP, agendador Gmail e executor
bancário. `bancoDeDados.mjs` fornece uma conexão compartilhada e inicializa os
esquemas. Há módulos internos, mas a separação de persistência e composição ainda
é parcial. Distribuir esses mesmos acessos por rede criaria dependências entre
serviços antes de esclarecer quem é responsável por cada alteração de dados.

Microserviços oferecem implantação e escala independentes, mas exigem resolver
consistência entre serviços e operação distribuída. Referências consultadas:
[estilo microserviços](https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/microservices)
e [propriedade dos dados](https://learn.microsoft.com/en-us/azure/architecture/microservices/design/data-considerations).

## Fronteiras propostas

| Módulo             | Responsabilidade                                     | Dependências a controlar                         |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------ |
| Identidade         | Sessões, equipe e permissões                         | Persistência de identidade                       |
| Cadastros          | Clientes, UCs, usinas e vigências                    | Identidade; históricos preservados               |
| Faturamento        | Documentos, conferência, cálculo e aprovação interna | Dados de cadastro e condições da competência     |
| Bancário           | Solicitação, execução e conciliação externa          | Cobrança aprovada; autorização; adaptador Sicoob |
| Pagamentos/compras | Catálogo, despesas e aprovação                       | Identidade; execução bancária quando aplicável   |
| Gmail/documentos   | Captura e triagem                                    | Entrada explícita de documento no faturamento    |

Esta tabela é o destino organizacional, não uma afirmação de isolamento já
concluído. O banco continua compartilhado. Toda extração deve preservar os
limites das transações e a autorização aplicada antes de acessar os dados.

## Etapa 1 — fronteira de leitura de faturamento

Implementada: a rota recebe uma fábrica de repositório explicitamente, sem
importar o banco global ou escolher o adaptador SQLite. A composição permanece
no módulo de rotas existente, com aquisição tardia da conexão. Não é necessário
criar uma camada de caso de uso que apenas repasse esses dois métodos de leitura.

Contrato preservado:

- `GET /api/admin/faturamento/unidades`: array completo, com vínculos e descontos
  no formato anterior à otimização em lote;
- `GET /api/admin/faturamento/documentos`: array completo de faturas de cobrança
  não excluídas, em ordem decrescente de ID, sem BLOB PDF nem texto bruto;
- com `limite`, documentos retornam `{itens, proximo_cursor}`; teto de 200 itens;
- cursor usa ID exclusivo, evitando deslocamento causado por novas inserções;
- autorização de nível 1 permanece no roteador pai;
- nenhuma escrita, chamada externa, alteração de schema ou estado financeiro.

Critérios de aceite: testar HTTP com SQLite temporário, negativa sem sessão,
compatibilidade de respostas, exclusão de pagamentos/triagem/excluídos, paginação
com inserção entre páginas, última página e entrada inválida antes da leitura.
Manter o teste de quantidade fixa de consultas e executar regressões de
faturamento. O comando `test:arquitetura` incorpora esses testes.

## Próximas entregas, uma por vez

1. Medir gargalos e volumes de respostas, com metas de desempenho acordadas;
   não registrar corpos ou dados pessoais. Aceite: baseline reproduzível em
   base sintética e diagnóstico do caminho realmente lento.
2. Extrair um fluxo de escrita do controlador de faturamento. Aceite: caso de
   uso com dependências explícitas e testes de autorização, repetição,
   concorrência, rollback e auditoria, preservando atomicidade.
3. Concluir o executor de migrações e retirar preparadores gradualmente.
   Aceite: banco vazio e cópia representativa, checksum do DDL, falha parcial,
   reinício e plano de recuperação demonstrados.
4. Paginar telas com filtros e totais no servidor. Aceite: nenhuma fatura
   perdida, cálculos cruzados completos e exportações integrais. Somente então
   restringir os endpoints que hoje devolvem arrays completos.
5. Dividir componentes por responsabilidade e medir jobs. Aceite: navegação e
   estados de erro/carregamento preservados; importações sem degradar HTTP além
   da meta definida na primeira medição.

Cada etapa termina com diff revisado e testes direcionados. Deploy, commit e
merge seguem as autorizações do usuário. A ordem pode mudar diante das medições.

## Critério para extração futura

Reavaliar quando houver necessidade comprovada de deploy, escala, segurança ou
disponibilidade independente, fronteira estável de dados e capacidade operacional
para suportá-la. Primeiro comparar otimização local, worker em processo separado
e serviço independente. Um worker continua podendo pertencer ao monólito.
Gmail/PDF é candidato a investigar, não uma extração previamente aprovada.
Troca de SQLite para outro banco é uma decisão separada, apoiada em contenção e
requisitos de disponibilidade observados. Microserviços não exigem por si só
troca de linguagem, Kubernetes ou reescrita de todos os módulos.

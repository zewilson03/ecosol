# Padrão de riscos e arquitetura do Ecosol

Registro consolidado da decisão de 26/10/2026 às 09:58. O sistema permanece um
monólito modular Node.js/Express/React/SQLite. Microserviços, ORM, reescrita em
TypeScript no backend e troca de banco não resolvem uma limitação comprovada
neste momento e, por isso, não fazem parte desta etapa.

## Direção arquitetural

A reavaliação e os critérios de cada entrega estão em
[Evolução em etapas](evolucao-em-etapas.md). A primeira fronteira de leitura já
recebe persistência por injeção explícita e possui cobertura HTTP com SQLite.

```text
HTTP / React
  -> casos de uso da aplicação
    -> regras puras do domínio
      -> portas de persistência e integrações
        -> adaptadores SQLite, Google, Sicoob e PDF
```

As dependências apontam para dentro. Regras de domínio não importam Express,
SQLite, Gmail ou Sicoob. Rotas traduzem HTTP; casos de uso controlam uma
transação curta; repositórios executam consultas orientadas ao domínio. Chamadas
externas nunca ficam dentro de transação SQLite.

## Regras obrigatórias

1. Dinheiro usa centavos inteiros ou decimal explícito, nunca `number` binário
   para cálculo intermediário.
2. Estados financeiros e transições são explícitos, versionados e auditáveis.
3. Repetição com efeito externo exige idempotência e reconciliação.
4. Listas grandes são resumidas e paginadas; detalhes são carregados sob demanda.
5. Consultas relacionadas são feitas em lote; N+1 é defeito de arquitetura.
6. DTOs são explícitos; a interface não recebe `SELECT *` sem fronteira.
7. Erros possuem código/categoria; decisões não dependem do texto do erro.
8. Logs usam allowlist e correlação, sem corpo, query string, CPF, e-mail, token,
   certificado ou payload bancário.
9. Migrações novas são numeradas, imutáveis, transacionais e protegidas por
   checksum. Não existe down migration automática de operação financeira.
10. Toda mudança passa pelo mesmo gate automatizado de testes, build e auditoria
    de dependências.

## Implementado nesta etapa

- senha inicial fraca removida dos exemplos e rejeitada em produção;
- limitação de login passa a validar a identidade antes de persistir chaves,
  combina rede e identidade e expurga registros vencidos;
- Express/body-parser e Nodemailer atualizados para versões sem os alertas altos
  encontrados na auditoria;
- leitura de UCs reduzida de `1 + 5U + V` para seis consultas fixas;
- leitura de documentos em lote, com paginação opcional por cursor e sem N+1;
- repositório de leitura extraído do controlador de faturamento;
- ledger `schema_migrations` com baseline e checksum, mantendo temporariamente os
  preparadores legados durante a transição;
- `foreign_keys=ON` aplicado na abertura da conexão, antes do esquema;
- telemetria HTTP estruturada com request ID, status e duração;
- liveness pública mínima e readiness administrativa com migração, administrador
  nominal e filas críticas;
- endpoint legado `/api/admin/faturas` marcado como depreciado;
- `test:all`, `quality:check` e workflow de pull request;
- backup com `foreign_key_check`, retenção local, timer diário e ensaio de
  restauração que não toca no banco real;
- lazy loading por etapa de faturamento e revalidação sem apagar a tela atual.

## Transição ainda controlada

O baseline é a primeira das duas versões de compatibilidade. Os cinco
preparadores de esquema antigos ainda executam na inicialização. A próxima
alteração de schema deve ser a primeira migração numerada real; depois de um
ensaio sobre cópia recente, os preparadores passam a somente verificar o
esquema. Não se deve reconstruir FKs, mover PDFs ou retirar tabelas legadas no
mesmo lote.

Os componentes grandes serão extraídos por fluxo, sem reescrita: primeiro
Preparação de Faturas, depois Gmail, Clientes e UCs. O endpoint legado só poderá
ser removido após telemetria confirmar ausência de consumidores e os dados
históricos receberem destino explícito.

## Operação e recuperação

- Antes de migração: pausar jobs, criar backup, validar SHA-256, `quick_check` e
  `foreign_key_check`, e ensaiar a restauração em cópia.
- Rollback de código só é válido para release compatível com o schema aplicado.
- Depois de aceitar novas operações financeiras, recuperar por forward-fix e
  conciliação; restaurar um backup antigo pode duplicar ou perder efeitos reais.
- Backups locais não protegem contra perda do host. A hospedagem deve adicionar
  réplica cifrada fora do servidor, retenção e alerta de idade do último backup.

# Auditoria das tabelas vazias do SQLite

Data da verificação: 27/10/2026. Banco inspecionado em modo somente leitura:
`backend/data/ecosol.db`. Não foram lidos nem exportados dados pessoais.

## Resultado

- 75 tabelas de aplicação; 44 vazias e 31 com pelo menos um registro.
- A tabela legada `faturas` está vazia, mas o endpoint
  `/api/admin/faturas` ainda a consulta. A fonte do faturamento atual é
  `faturamento_documentos`, que possui 980 registros. Não eliminar `faturas`
  antes de retirar ou migrar o endpoint legado e seus testes.
- `financeiro_solicitacoes_pagamento` está vazia. Ela é usada pelo módulo de
  pagamentos, inclusive pela proteção contra duplicidade de faturas, e faz
  parte da assinatura do baseline de migrações. Deve permanecer.
- As tabelas vazias de autenticação, importações, Gmail, faturamento, financeiro
  e operações bancárias possuem consultas, inserções, controles ou testes no
  código atual. Ausência de registros não significa ausência de uso.

## Candidatas a remoção futura

As seis tabelas abaixo estão vazias e não têm referências no código atual,
além dos próprios objetos SQLite que as relacionam. São vestígios do fluxo
de MFA removido do produto:

- `bancario_mfa_equipe`
- `bancario_mfa_recuperacao`
- `bancario_mfa_auditoria`
- `bancario_mfa_pedidos_recuperacao`
- `bancario_mfa_aprovacoes_recuperacao`
- `bancario_mfa_auditoria_recuperacao`

Não houve `DROP TABLE` nesta auditoria. Antes de limpar, conferir também os
bancos de outros ambientes, obter backup consistente do SQLite, testar a
restauração, criar uma migração versionada com dependências em ordem correta
e executar os testes de migração, permissões e banco. Bancos antigos e versões
anteriores do aplicativo precisam continuar compatíveis durante a implantação.

## Limpeza preparada

A migração de versão 2 foi adicionada ao código. Ela remove somente essas seis
tabelas, em transação única, e somente se estiverem vazias, sem dependências
externas e com o baseline íntegro. A migração é idempotente e não recria as
tabelas em bancos novos. Se houver registros ou dependências em outro ambiente,
ela interrompe a inicialização sem remover nada; investigar antes de prosseguir.

Foi criado um backup consistente do banco local em
`backend/data/backups/ecosol-before-mfa-cleanup-2026-10-27.db`, ignorado pelo
Git. O backup passou no `PRAGMA integrity_check`. Uma cópia dele recebeu a
migração com sucesso: versão 2, integridade `ok`, zero erros no
`PRAGMA foreign_key_check` e 980 documentos de faturamento preservados.

Como o servidor local estava em execução com o código anterior, o banco
original não foi alterado durante esta preparação. Ao reiniciar o serviço
com o código novo, a migração será aplicada automaticamente. Não executar
simultaneamente uma instância antiga: seu verificador de saúde espera a
versão 1. Para recuperar o banco, parar o serviço e restaurar o backup com
procedimento SQLite apropriado, preservando qualquer dado novo que tenha
sido criado após o backup.

## Limite da verificação

Os números acima são uma fotografia do banco local no instante da leitura.
Uma tabela vazia pode receber dados posteriormente ou conter registros em
outro ambiente. Esta auditoria não comprova que os seis objetos podem ser
removidos de todos os bancos sem uma verificação de implantação e recuperação.

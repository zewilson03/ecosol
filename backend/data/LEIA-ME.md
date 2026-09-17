# Dados do projeto

- ecosol.db: banco de dados SQLite usado pelo site. É binário e não deve ser aberto como texto.
- ecosol.db-wal e ecosol.db-shm: arquivos auxiliares usados pelo SQLite. Não edite, renomeie ou apague enquanto o site estiver em execução.
- consultas/clientes.json, consultas/contatos.json e consultas/administradores.json: cópias legíveis criadas pelo comando de exportação. Não são atualizadas automaticamente ao cadastrar ou excluir registros.

No terminal do VS Code, na raiz do projeto, execute .\ver-dados.cmd. Depois abra os arquivos em consultas. Execute novamente após novos cadastros, mudanças de nível ou exclusões.

Os arquivos de clientes e administradores incluem o campo `senha_hash`, quando a conta possui senha. Ele contém um hash com sal individual, nunca a senha original. Hashes também são dados sensíveis: não publique nem compartilhe estes JSONs. Tokens e sessões não são exportados.

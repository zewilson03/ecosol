# Operação do servidor Ecosol

## Escopo desta entrega

Esta entrega prepara a hospedagem reproduzível em uma VPS Linux de instância
única. Ela não cria a VPS, não aponta DNS, não instala segredos e não ativa o
executor Sicoob real. Os arquivos em `infra/producao` são modelos versionados;
os valores reais pertencem somente ao servidor.

## Pré-requisitos

- Ubuntu LTS atualizado em uma VPS Lightsail na região de São Paulo;
- IP estático e portas públicas 80/443; porta 3000 fechada externamente;
- SSH restrito aos endereços administrativos;
- Node.js 24, `pnpm`, Caddy, `sqlite3`, `curl`, Git e `rsync`;
- domínio sob controle da Ecosol apontado ao IP estático;
- usuário de sistema `ecosol`, sem login interativo.

## Estrutura e permissões

Execute como administrador do servidor, conferindo cada caminho:

```bash
sudo useradd --system --home /var/lib/ecosol --shell /usr/sbin/nologin ecosol
sudo install -d -m 0755 -o root -g root /opt/ecosol/releases
sudo install -d -m 0700 -o ecosol -g ecosol /var/lib/ecosol
sudo install -d -m 0700 -o ecosol -g ecosol /var/lib/ecosol/backups
sudo install -d -m 0750 -o root -g ecosol /etc/ecosol
sudo install -d -m 0750 -o root -g ecosol /etc/ecosol/segredos
```

Copie `infra/producao/ecosol.env.example` para `/etc/ecosol/ecosol.env`, troque
o domínio e preencha os segredos diretamente no servidor. Depois aplique:

```bash
sudo chown root:ecosol /etc/ecosol/ecosol.env
sudo chmod 0640 /etc/ecosol/ecosol.env
```

O PFX fica em `/etc/ecosol/segredos`, nunca em `/opt/ecosol`, Git, logs ou
backup comum. A senha do PFX fica apenas no arquivo de ambiente protegido ou,
em etapa posterior, em um cofre de segredos.

## Instalação do serviço e do proxy

1. Copie `infra/producao/systemd/ecosol.service` para
   `/etc/systemd/system/ecosol.service`.
2. Copie o Caddyfile, substitua `SEU_DOMINIO_ECOSOL` pelo domínio definitivo e
   valide com `caddy validate --config /etc/caddy/Caddyfile`.
3. Não habilite access log sem uma política que remova query strings: o retorno
   OAuth do Gmail possui código temporário na URL.
4. Recarregue e habilite os serviços:

```bash
sudo systemctl daemon-reload
sudo systemctl enable ecosol.service caddy.service
sudo systemctl reload caddy.service
```

## Preparação e ativação de um release

Use como nome o commit aprovado, copie o código para um diretório novo e nunca
edite o release ativo:

```bash
sudo install -d -m 0755 -o ecosol -g ecosol /opt/ecosol/releases/COMMIT
git archive --format=tar COMMIT | sudo -u ecosol tar -xf - -C /opt/ecosol/releases/COMMIT
sudo -u ecosol bash infra/producao/scripts/validar-release.sh /opt/ecosol/releases/COMMIT
sudo bash infra/producao/scripts/ativar-release.sh /opt/ecosol/releases/COMMIT
```

`git archive` inclui somente arquivos versionados no commit: banco, `.env.local`,
certificados e outras sobras locais não entram no release. O validador instala
exatamente o lockfile e executa `pnpm quality:check`, com todos os testes, build
e auditoria de dependências altas.
O ativador cria primeiro um backup SQLite consistente, troca o link `current`
atomicamente, reinicia uma única instância e consulta `/api/saude`. Se a saúde
não responder em até um minuto, restaura o link anterior e reinicia o serviço.
Ele não restaura dados automaticamente.

## Verificação posterior

```bash
curl --fail --silent https://SEU_DOMINIO_ECOSOL/api/saude
sudo systemctl status ecosol.service caddy.service
sudo journalctl -u ecosol.service --since "10 minutes ago"
sudo ss -lntp
```

Confirme também login nominal, permissões, listagem de faturas e abertura de um
PDF. O executor bancário deve continuar desligado. Não imprima o ambiente do
processo nem use `systemctl show` com propriedades que exponham variáveis.

## Backup agendado e ensaio de restauração

Instale e habilite o timer diário. Ele conserva 30 dias de cópias locais e
valida integridade e referências antes de publicar cada arquivo:

```bash
sudo cp infra/producao/systemd/ecosol-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ecosol-backup.timer
sudo systemctl list-timers ecosol-backup.timer
```

Uma vez por mês, valide uma cópia sem alterar o banco ativo:

```bash
sudo bash infra/producao/scripts/validar-restauracao-sqlite.sh \
  /var/lib/ecosol/backups/ecosol-INSTANTE.db
```

O agendamento local não substitui a réplica cifrada fora do servidor. Configure
o destino externo na infraestrutura e alerte quando a última cópia confirmada
ultrapassar 26 horas.

## Encerramento e reinício seguro

Ao receber `SIGTERM` do `systemd` ou `SIGINT` no terminal, a aplicação:

1. passa a responder indisponível na verificação de saúde;
2. cancela os próximos ciclos automáticos do Gmail e do executor bancário;
3. deixa as requisições abertas e os ciclos já iniciados terminarem;
4. executa `PRAGMA wal_checkpoint(TRUNCATE)` e fecha o SQLite;
5. encerra com código zero.

O limite interno é 45 segundos e o `systemd` concede 60 segundos. Se a drenagem
falhar, as conexões HTTP são encerradas, o banco não é fechado por baixo de uma
tarefa ainda ativa e o processo sai com erro. Uma intenção bancária que tenha
ficado inconclusiva conserva seu estado persistido e deve seguir o fluxo de
consulta/reconciliação; o reinício não autoriza novo envio cego.

## Rollback e recuperação

- **Falha antes da ativação:** descarte apenas o novo diretório de release.
- **Falha de saúde após ativação:** o script retorna automaticamente ao link
  anterior e preserva o backup recém-criado.
- **Mudança de esquema incompatível:** pare a aplicação e siga uma restauração
  revisada; não restaure banco automaticamente durante rollback de código.
- **Falha de armazenamento:** mantenha o serviço parado, restaure para diretório
  limpo e valide `PRAGMA integrity_check`, faturas, PDFs, usuários, operações e
  auditoria antes de reabrir o acesso.

Nunca execute dois releases contra o mesmo SQLite e nunca copie somente
`ecosol.db` com a aplicação escrevendo. O script usa a operação `.backup` do
SQLite, que produz uma cópia consistente mesmo com WAL ativo.

## Limitações restantes

- a VPS, o domínio, o DNS e o certificado HTTPS ainda dependem das contas da
  Ecosol;
- o backup criado localmente precisa ser replicado para armazenamento externo;
- a restauração possui verificação automatizada, mas o procedimento operacional
  completo ainda precisa ser ensaiado em uma VPS descartável;
- métricas de disco, memória, erros e validade dos backups ainda precisam de
  alertas externos;
- a parada coordenada foi implementada e testada localmente; ainda precisa ser
  ensaiada sob carga na VPS e observada pelo `systemd` antes do go-live.

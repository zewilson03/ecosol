import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function ler(caminho) {
  return readFileSync(new URL(`../../${caminho}`, import.meta.url), "utf8");
}

const servico = ler("infra/producao/systemd/ecosol.service");
assert.match(servico, /^User=ecosol$/m);
assert.match(servico, /^EnvironmentFile=\/etc\/ecosol\/ecosol\.env$/m);
assert.match(servico, /^WorkingDirectory=\/opt\/ecosol\/current$/m);
assert.match(servico, /^NoNewPrivileges=true$/m);
assert.match(servico, /^ProtectSystem=strict$/m);
assert.match(servico, /^ReadWritePaths=\/var\/lib\/ecosol$/m);
assert.doesNotMatch(
  servico,
  /Environment=.*(?:PASSWORD|SECRET|TOKEN|PASSPHRASE)/,
);

const caddy = ler("infra/producao/caddy/Caddyfile");
assert.match(caddy, /reverse_proxy 127\.0\.0\.1:3000/);
assert.match(caddy, /health_uri \/api\/saude/);
assert.doesNotMatch(caddy, /^\s*log\s*\{/m);

const ambiente = ler("infra/producao/ecosol.env.example");
assert.match(ambiente, /^NODE_ENV=production$/m);
assert.match(ambiente, /^HOST=127\.0\.0\.1$/m);
assert.match(ambiente, /^BANCARIO_EXECUTOR_MODO=desligado$/m);
assert.doesNotMatch(ambiente, /Ecosol123|BEGIN (?:RSA )?PRIVATE KEY/);

const backup = ler("infra/producao/scripts/backup-sqlite.sh");
assert.match(backup, /\.backup/);
assert.match(backup, /PRAGMA quick_check/);
assert.match(backup, /PRAGMA foreign_key_check/);
assert.match(backup, /sha256sum/);
assert.match(backup, /basename "\$destino"/);
assert.match(backup, /cd "\$pasta_backups"/);
assert.doesNotMatch(backup, /sha256sum "\$destino"/);
assert.doesNotMatch(backup, /\bcp\s+.*ecosol\.db/);

const restauracao = ler("infra/producao/scripts/validar-restauracao-sqlite.sh");
assert.match(restauracao, /sha256sum --check/);
assert.match(restauracao, /PRAGMA quick_check/);
assert.match(restauracao, /PRAGMA foreign_key_check/);
assert.match(restauracao, /mktemp/);
assert.doesNotMatch(restauracao, /\/var\/lib\/ecosol\/ecosol\.db/);

const timerBackup = ler("infra/producao/systemd/ecosol-backup.timer");
assert.match(timerBackup, /^Persistent=true$/m);
assert.match(timerBackup, /^OnCalendar=/m);

const ativacao = ler("infra/producao/scripts/ativar-release.sh");
assert.match(ativacao, /\/api\/saude/);
assert.match(ativacao, /release_anterior/);
assert.match(ativacao, /systemctl restart ecosol\.service/);
assert.doesNotMatch(ativacao, /rm\s+-rf/);

console.log(
  "OK: artefatos de produção preservam instância única, segredos externos, backup consistente e rollback por saúde.",
);

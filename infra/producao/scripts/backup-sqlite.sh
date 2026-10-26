#!/usr/bin/env bash
set -Eeuo pipefail

readonly banco="/var/lib/ecosol/ecosol.db"
readonly pasta_backups="/var/lib/ecosol/backups"

if [[ ! -f "$banco" ]]; then
  echo "Banco de produção não encontrado em $banco." >&2
  exit 1
fi
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "O utilitário sqlite3 é obrigatório para o backup consistente." >&2
  exit 1
fi

install -d -m 0700 -o ecosol -g ecosol "$pasta_backups"
readonly instante="$(date -u +%Y%m%dT%H%M%SZ)"
readonly temporario="$pasta_backups/.ecosol-$instante.db.tmp"
readonly destino="$pasta_backups/ecosol-$instante.db"

limpar() {
  rm -f -- "$temporario"
}
trap limpar EXIT

sqlite3 "$banco" ".timeout 10000" ".backup '$temporario'"
readonly integridade="$(sqlite3 "$temporario" "PRAGMA quick_check;")"
if [[ "$integridade" != "ok" ]]; then
  echo "A cópia não passou no PRAGMA quick_check." >&2
  exit 1
fi

chown ecosol:ecosol "$temporario"
chmod 0600 "$temporario"
mv -- "$temporario" "$destino"
sha256sum "$destino" >"$destino.sha256"
chown ecosol:ecosol "$destino.sha256"
chmod 0600 "$destino.sha256"
trap - EXIT

echo "$destino"

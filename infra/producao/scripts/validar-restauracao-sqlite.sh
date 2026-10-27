#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  echo "Uso: validar-restauracao-sqlite.sh /caminho/ecosol-data.db" >&2
  exit 2
fi

readonly origem="$(realpath -- "$1")"
readonly hash="$origem.sha256"
if [[ ! -f "$origem" || ! -f "$hash" ]]; then
  echo "Informe um backup e seu arquivo .sha256 correspondente." >&2
  exit 1
fi
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "O utilitário sqlite3 é obrigatório." >&2
  exit 1
fi

(cd "$(dirname "$origem")" && sha256sum --check "$(basename "$hash")")
readonly ensaio="$(mktemp --suffix=.db ecosol-restore-XXXXXX)"
limpar() { rm -f -- "$ensaio"; }
trap limpar EXIT
cp -- "$origem" "$ensaio"
chmod 0600 "$ensaio"

[[ "$(sqlite3 "$ensaio" 'PRAGMA quick_check;')" == "ok" ]]
[[ -z "$(sqlite3 "$ensaio" 'PRAGMA foreign_key_check;')" ]]
readonly tabelas="$(sqlite3 "$ensaio" \
  "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name IN ('customers','staff_users','sessions','usinas','faturamento_unidades','faturamento_documentos','gmail_contas','bancario_operacoes','schema_migrations');")"
if [[ "$tabelas" -ne 9 ]]; then
  echo "O backup não contém o schema mínimo esperado." >&2
  exit 1
fi

echo "Ensaio de restauração aprovado sem alterar o banco de produção."

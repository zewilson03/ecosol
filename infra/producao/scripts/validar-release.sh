#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  echo "Uso: validar-release.sh /opt/ecosol/releases/<commit>" >&2
  exit 2
fi

readonly release="$(realpath -e -- "$1")"
case "$release" in
  /opt/ecosol/releases/*) ;;
  *)
    echo "O release deve estar dentro de /opt/ecosol/releases/." >&2
    exit 2
    ;;
esac

if [[ ! -f "$release/package.json" || ! -f "$release/pnpm-lock.yaml" ]]; then
  echo "Release incompleto: package.json ou pnpm-lock.yaml ausente." >&2
  exit 1
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm não está disponível no servidor." >&2
  exit 1
fi

cd "$release"
pnpm install --frozen-lockfile
pnpm run quality:check
test -r frontend/dist/index.html

echo "Release validado: $release"

#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  echo "Uso: ativar-release.sh /opt/ecosol/releases/<commit>" >&2
  exit 2
fi

readonly novo_release="$(realpath -e -- "$1")"
case "$novo_release" in
  /opt/ecosol/releases/*) ;;
  *)
    echo "O release deve estar dentro de /opt/ecosol/releases/." >&2
    exit 2
    ;;
esac
test -r "$novo_release/frontend/dist/index.html"

readonly link_atual="/opt/ecosol/current"
readonly pasta_script="$(cd -- "$(dirname -- "$0")" && pwd)"
release_anterior=""
if [[ -L "$link_atual" ]]; then
  release_anterior="$(readlink -f -- "$link_atual")"
fi

backup="$(bash "$pasta_script/backup-sqlite.sh")"
echo "Backup verificado: $backup"

link_temporario="/opt/ecosol/.current.$$.tmp"
limpar() {
  rm -f -- "$link_temporario"
}
trap limpar EXIT
ln -s -- "$novo_release" "$link_temporario"
mv -Tf -- "$link_temporario" "$link_atual"

systemctl restart ecosol.service
saudavel=false
for _ in {1..30}; do
  if curl --fail --silent --show-error --max-time 3 \
    http://127.0.0.1:3000/api/saude >/dev/null; then
    saudavel=true
    break
  fi
  sleep 2
done

if [[ "$saudavel" == "true" ]]; then
  trap - EXIT
  echo "Release ativo e saudável: $novo_release"
  exit 0
fi

echo "O novo release não ficou saudável; iniciando rollback de código." >&2
if [[ -n "$release_anterior" && -d "$release_anterior" ]]; then
  ln -s -- "$release_anterior" "$link_temporario"
  mv -Tf -- "$link_temporario" "$link_atual"
  systemctl restart ecosol.service
  trap - EXIT
  echo "Release anterior reativado: $release_anterior" >&2
else
  systemctl stop ecosol.service
  echo "Sem release anterior válido; serviço mantido parado." >&2
fi
exit 1

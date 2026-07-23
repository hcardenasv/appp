#!/bin/sh
set -e

# Solo la API (main.js) ejecuta migraciones; el worker las omite
if [ "$1" = "node" ] && [ "$2" = "dist/main.js" ]; then
  echo "[entrypoint] Aplicando migraciones Prisma..."
  npx prisma migrate deploy
  echo "[entrypoint] Migraciones listas."
fi

exec "$@"

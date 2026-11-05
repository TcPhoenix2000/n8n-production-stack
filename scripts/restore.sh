#!/bin/sh
# Restore the n8n database from a backup file.
# Usage: scripts/restore.sh backups/n8n_2026-11-05_0300.sql.gz
#
# The .env must contain the SAME N8N_ENCRYPTION_KEY as when the backup was made,
# otherwise saved credentials cannot be decrypted.
set -eu
cd "$(dirname "$0")/.."

FILE="${1:?Usage: $0 backups/<file>.sql.gz}"
[ -f "$FILE" ] || { echo "Not found: $FILE"; exit 1; }

printf "This REPLACES the current n8n database with %s. Type 'yes' to continue: " "$FILE"
read -r ANSWER
[ "$ANSWER" = "yes" ] || { echo "Aborted."; exit 1; }

echo "==> Stopping n8n"
docker compose stop n8n

echo "==> Recreating database"
docker compose exec -T postgres sh -c \
  'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'

echo "==> Restoring $FILE"
gunzip -c "$FILE" | docker compose exec -T postgres sh -c 'psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

echo "==> Starting n8n"
docker compose start n8n
echo "Done."

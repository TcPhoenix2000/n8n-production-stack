#!/bin/sh
# Nightly PostgreSQL dump of the n8n database, with retention.
# Runs inside the "backup" container (connection settings come from PG* env vars).
set -eu

STAMP=$(date +%Y-%m-%d_%H%M)
FILE="/backups/n8n_${STAMP}.sql.gz"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

echo "[backup] $(date -Iseconds) starting dump -> ${FILE}"
pg_dump --no-owner --no-privileges | gzip > "${FILE}.tmp"
mv "${FILE}.tmp" "${FILE}"
echo "[backup] done: $(du -h "${FILE}" | cut -f1)"

find /backups -name 'n8n_*.sql.gz' -mtime +"${KEEP_DAYS}" -print -delete \
  | sed 's/^/[backup] removed old: /'

#!/bin/sh
# Safe update: back up first, then pull new images and restart.
set -eu
cd "$(dirname "$0")/.."

echo "==> Backing up database before update"
docker compose exec -T backup /bin/sh /usr/local/bin/backup.sh

echo "==> Pulling new images"
docker compose pull

echo "==> Restarting stack"
docker compose up -d

echo "==> Removing old images"
docker image prune -f

docker compose ps

#!/usr/bin/env bash
# Starts a throwaway local PostgreSQL 16 for development/tests (not for production).
# Usage: scripts/local-postgres.sh   -> prints DATABASE_URL
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DATA=${KEPT_PGDATA:-/tmp/kept-pgdata}
PORT=${KEPT_PGPORT:-5433}
RUN_AS=""
if [ "$(id -u)" = "0" ]; then RUN_AS="runuser -u postgres --"; fi
if [ ! -d "$DATA" ]; then
  mkdir -p "$DATA"; [ -n "$RUN_AS" ] && chown postgres "$DATA"
  $RUN_AS "$PGBIN/initdb" -D "$DATA" -A trust -U postgres >/dev/null
fi
if ! $RUN_AS "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
  $RUN_AS "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp" -l "$DATA/server.log" start >/dev/null
  sleep 1
fi
for db in kept kept_test; do
  psql -h /tmp -p "$PORT" -U postgres -tc "select 1 from pg_database where datname='$db'" | grep -q 1 || psql -h /tmp -p "$PORT" -U postgres -c "create database $db" >/dev/null
done
echo "DATABASE_URL=postgres://postgres@localhost:$PORT/kept"
echo "TEST_DATABASE_URL=postgres://postgres@localhost:$PORT/kept_test"

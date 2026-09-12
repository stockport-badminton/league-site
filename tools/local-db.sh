#!/usr/bin/env bash
# A local Postgres for development, so `npm run dev` stops writing to production.
#
#   tools/local-db.sh up        start the container
#   tools/local-db.sh load      schema + seed + sanitise (safe to re-run: it rebuilds)
#   tools/local-db.sh status    what is in it
#   tools/local-db.sh psql      a shell on it
#   tools/local-db.sh url       the DATABASE_URL to put in dev.env
#   tools/local-db.sh down      stop, keep the data
#   tools/local-db.sh nuke      stop and delete the data
#
# WHY: dev.env has always carried the same connection string as .env, so every local run
# has talked to the live Supabase database. Three messer_scorecard rows in production were
# written from a dev server — and because a dev server logs nothing to Cloud Run, they
# exist with no request behind them, which also made a route-usage audit report the entire
# Messer flow as dead. See docs/hardening/HARD-13-dev-database-guard.md.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.local.yml"
CONTAINER=sdbl-local-db
DB_USER=sdbl
DB_NAME=sdbl
PORT=5433
# Not a secret, and deliberately not the production one: this database must not be able to
# decrypt production data, nor production this.
LOCAL_DB_PI_KEY="${LOCAL_DB_PI_KEY:-local-dev-not-a-secret}"

psql_in() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" "$@"; }

wait_healthy() {
  for _ in $(seq 1 60); do
    [ "$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || true)" = healthy ] && return 0
    sleep 1
  done
  echo "database did not become healthy" >&2; exit 1
}

case "${1:-}" in
  up)
    $COMPOSE up -d
    wait_healthy
    echo "up on localhost:$PORT"
    ;;

  load)
    wait_healthy
    # Rebuild from scratch every time. A half-applied load is worse than no load, and the
    # whole point of a local database is that throwing it away costs nothing.
    echo "→ dropping and recreating the public schema"
    psql_in -q -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'

    echo "→ schema (001_initial + the numbered migrations)"
    # psql, not tools/run-migration.js: that splits on ';' without regard for comments and
    # would cut these files in the wrong place (HARD-18).
    #
    # Some migrations are no-ops against a freshly built schema, because the file they
    # fixed has since been corrected in place. 003 is the example: it adds "homeMan3" to
    # messer_scorecard, and 002 now creates that table with the column already there. On
    # production the pair applied in order and both did something; replayed from nothing,
    # the second has nothing to do. So an "already exists" is expected and reported;
    # ANY OTHER error stops the load, because that one is real.
    for f in migrations/001_initial.sql $(ls migrations/0*.sql | grep -v 001_initial | sort); do
      if err=$(psql_in -q -f - < "$f" 2>&1); then
        printf '    %s\n' "$f"
      elif printf '%s' "$err" | grep -qiE 'already exists'; then
        printf '    %s   (no-op: %s)\n' "$f" "$(printf '%s' "$err" | grep -oiE '[^ ]*already exists' | head -1)"
      else
        printf '    %s   FAILED\n' "$f"
        printf '%s\n' "$err" | sed 's/^/      /'
        exit 1
      fi
    done

    if [ -f migrations/data/002_data.sql ]; then
      echo "→ seed data (migrations/data/002_data.sql)"
      psql_in -q -f - < migrations/data/002_data.sql
    else
      echo "→ NO SEED FOUND at migrations/data/002_data.sql — schema only."
      echo "  That directory is gitignored, so a fresh clone has no data. The app will"
      echo "  boot but every page will be empty."
    fi

    # Without statistics the planner has nothing to go on and picks sequential scans over
    # a 35,000-row game table, so pages that are instant in production take seconds here —
    # slow enough that the browser suite starts timing out and looks flaky. A freshly
    # restored database has never been analysed; production has autovacuum doing it.
    echo "→ dev fixtures the seed cannot supply"
    psql_in -q -f - < tools/local-db/dev-fixtures.sql

    echo "→ analysing (planner statistics)"
    psql_in -q -c 'ANALYZE;'

    echo "→ replacing real contact details"
    psql_in -q -c "SET sdbl.local_key = '$LOCAL_DB_PI_KEY';" -f - < tools/local-db/sanitise.sql

    echo
    "$0" status
    ;;

  status)
    wait_healthy
    psql_in -P pager=off -c "
      SELECT relname AS table, n_live_tup AS rows
        FROM pg_stat_user_tables WHERE n_live_tup > 0
       ORDER BY n_live_tup DESC LIMIT 10;"
    echo "contact details (should be plus-aliases and 07700 900xxx):"
    psql_in -P pager=off -t -c "
      SELECT '  ' || pgp_sym_decrypt(\"playerEmail\", '$LOCAL_DB_PI_KEY') || '   ' ||
                     pgp_sym_decrypt(\"playerTel\", '$LOCAL_DB_PI_KEY')
        FROM player WHERE \"playerEmail\" IS NOT NULL LIMIT 3;" 2>/dev/null ||
      echo "  (none decryptable — has load run?)"
    ;;

  # With no extra arguments this is an interactive shell. With them it is a one-shot:
  # `local-db.sh psql -c 'DROP ...'`. The -t is dropped in that case, because `docker exec
  # -it` with no terminal fails with "the input device is not a TTY" — which is what made
  # the one-shot form appear to succeed while doing nothing.
  psql)    wait_healthy
           shift
           if [ "$#" -gt 0 ]; then
             docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" "$@"
           else
             docker exec -it "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME"
           fi ;;
  url)     echo "postgresql://$DB_USER:$DB_USER@127.0.0.1:$PORT/$DB_NAME" ;;
  key)     echo "$LOCAL_DB_PI_KEY" ;;
  down)    $COMPOSE down ;;
  nuke)    $COMPOSE down -v; echo "container and data removed" ;;
  *)       sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac

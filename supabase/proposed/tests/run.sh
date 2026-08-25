#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Rejoue toute la séquence sur une base PostgreSQL JETABLE.
# Ne se connecte jamais à Supabase : il faut un serveur local.
#
#   ./run.sh                       # utilise $PGHOST/$PGPORT/$PGUSER
#   PGPORT=5433 ./run.sh
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${DB:-morada_gestion_check}"
PSQL="psql -v ON_ERROR_STOP=1 -q"

echo "→ base jetable $DB"
$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null

echo "→ fixture (surface de production)"
$PSQL -d "$DB" -f tests/00_fixture_production.sql

for f in 0001_gestion_spine 0002_gestion_foundation 0003_gestion_portefeuille_baux \
         0004_gestion_argent_operations 0005_gestion_conformite_fiscal 0006_gestion_portail; do
  echo "→ $f"
  $PSQL -d "$DB" -f "$f.sql"
done

echo "→ tests"
$PSQL -d "$DB" -f tests/01_checks.sql

echo "→ rollback"
$PSQL -d "$DB" -f tests/02_rollback.sql

echo "✓ tout est passé"

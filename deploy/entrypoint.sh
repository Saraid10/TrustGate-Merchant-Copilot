#!/bin/sh
# Bring a fresh deployment all the way up: schema, store, then the server.
#
# The store is seeded only when there is not one already, so a restart does not silently move the
# demo to a new tenant while someone is standing in front of it. `/api/v1/merchant/demo-reset`
# remains the deliberate way to start the morning again.
set -e

# Render hands the database URL in the driverless form, and this application talks psycopg 3.
if [ -n "$DATABASE_URL" ]; then
  DATABASE_URL=$(printf '%s' "$DATABASE_URL" | sed 's|^postgresql://|postgresql+psycopg://|; s|^postgres://|postgresql+psycopg://|')
  export DATABASE_URL
fi

# The payment rail is mounted inside this process, so both of these are this service's own URL.
# Deriving them means the deployment has no hostname written into it by hand.
: "${TRUSTGATE_BASE_URL:=${RENDER_EXTERNAL_URL:-http://127.0.0.1:8000}}"
: "${PAYTM_SIM_HOST:=${TRUSTGATE_BASE_URL}/rail}"
export TRUSTGATE_BASE_URL PAYTM_SIM_HOST

export TRUSTGATE_HOST="${TRUSTGATE_HOST:-0.0.0.0}"
export TRUSTGATE_PORT="${TRUSTGATE_PORT:-${PORT:-8000}}"

echo "Applying migrations"
alembic upgrade head

echo "Seeding the store if it is not there yet"
python deploy/seed_if_absent.py

echo "Serving on ${TRUSTGATE_HOST}:${TRUSTGATE_PORT}"
exec python -m api.serve

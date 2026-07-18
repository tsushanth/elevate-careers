#!/bin/sh
# Daily job ingestion cron
# Calls /ingest/sync for each company in the list
# Runs as a Fly scheduled machine (--schedule daily)

API="https://elevate-careers-api.fly.dev"
SECRET="${INGEST_SECRET}"

echo "Starting daily ingestion $(date)"

call() {
  PROVIDER="$1"
  ORG="$2"
  echo "Ingesting $PROVIDER/$ORG..."
  RESP=$(curl -sf -X POST "$API/ingest/sync" \
    -H 'Content-Type: application/json' \
    -d "{\"provider\":\"$PROVIDER\",\"org\":\"$ORG\",\"secret\":\"$SECRET\"}")
  echo "  → $RESP"
  # Stagger requests to avoid hammering the job boards
  sleep 10
}

# Greenhouse
call greenhouse anthropic
call greenhouse stripe
call greenhouse airbnb
call greenhouse notion
call greenhouse figma
call greenhouse twilio
call greenhouse cloudflare
call greenhouse datadog
call greenhouse mongodb
call greenhouse databricks
call greenhouse lyft
call greenhouse coinbase
call greenhouse discord
call greenhouse vercel
call greenhouse dropbox
call greenhouse airtable

# Lever
call lever netflix
call lever uber
call lever slack
call lever spotify

# Ashby
call ashby rippling
call ashby ramp

# SmartRecruiters
call smartrecruiters bosch
call smartrecruiters visa
call smartrecruiters ikea

echo "Ingestion complete $(date)"

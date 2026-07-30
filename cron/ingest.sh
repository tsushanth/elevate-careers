#!/bin/sh
# Daily job ingestion cron
# 1. Try to refresh discovered_company from GitHub ATS datasets
# 2. Ingest jobs — uses discovered_company table, falls back to companies.json if empty

API="https://elevate-careers-api.fly.dev"
SECRET="${INGEST_SECRET}"

echo "Starting daily ingestion $(date)"

echo "Step 1: Refreshing company list from GitHub datasets..."
BOOTSTRAP=$(curl -sf --max-time 30 -X POST "$API/ingest/bootstrap-discovery" \
  -H 'Content-Type: application/json' \
  -d "{\"secret\":\"$SECRET\"}" 2>&1) && echo "Bootstrap: $BOOTSTRAP" || echo "Bootstrap failed, continuing with existing list"

# Give bootstrap time to fetch and upsert before ingesting
sleep 60

echo "Step 2: Ingesting jobs for all discovered companies..."
SYNC=$(curl -sf -X POST "$API/ingest/sync-all" \
  -H 'Content-Type: application/json' \
  -d "{\"secret\":\"$SECRET\"}")
echo "Sync: $SYNC"

echo "Step 3: Scraping jobs via JobSpy (Indeed + LinkedIn + Glassdoor)..."
JOBSPY=$(curl -sf --max-time 120 -X POST "$API/ingest/jobspy" \
  -H 'Content-Type: application/json' \
  -d "{
    \"secret\": \"$SECRET\",
    \"max_results\": 50,
    \"sites\": [\"indeed\", \"linkedin\", \"glassdoor\"],
    \"queries\": [
      {\"keyword\": \"software engineer\",   \"location\": \"United States\"},
      {\"keyword\": \"backend engineer\",     \"location\": \"United States\"},
      {\"keyword\": \"fullstack engineer\",   \"location\": \"United States\"},
      {\"keyword\": \"data engineer\",        \"location\": \"United States\"},
      {\"keyword\": \"devops engineer\",      \"location\": \"United States\"},
      {\"keyword\": \"product manager\",      \"location\": \"United States\"},
      {\"keyword\": \"software engineer\",    \"location\": \"Remote\"},
      {\"keyword\": \"machine learning engineer\", \"location\": \"United States\"}
    ]
  }") && echo "JobSpy: $JOBSPY" || echo "JobSpy ingest failed (non-fatal)"

echo "Daily ingestion triggered $(date)"

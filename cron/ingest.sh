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
# The loop runs HERE, on the cron machine, not as a background task inside the
# API process — that used to mean every unrelated API deploy killed ingestion
# mid-run. This machine is untouched by API deploys, so it survives them.
QUEUE=$(curl -sf --max-time 30 "$API/ingest/queue?secret=$SECRET&limit=6000")
COUNT=$(echo "$QUEUE" | jq -r '.companies | length' 2>/dev/null)
echo "Queue: $COUNT companies to ingest"

echo "$QUEUE" | jq -r '.companies[] | "\(.provider) \(.org)"' 2>/dev/null | while read -r provider org; do
  [ -z "$org" ] && continue
  echo "Ingesting $provider/$org..."
  curl -sf --max-time 20 -X POST "$API/ingest/sync" \
    -H 'Content-Type: application/json' \
    -d "{\"provider\":\"$provider\",\"org\":\"$org\",\"secret\":\"$SECRET\"}" \
    >/dev/null || echo "  → failed, continuing"
  sleep 2
done
echo "Sync loop complete $(date)"

echo "Step 3: Scraping jobs via JobSpy (Indeed + LinkedIn), one query per request..."
# One query per HTTP call, not all 8 batched into a single request — the
# jobspy-service worker OOM'd mid-batch on 2026-08-04 (512mb VM, 8 queries x
# 3 sites in one process before responding), which silently lost the whole
# day's results including LinkedIn's already-successful scrapes since the
# client got nothing back. Splitting means one slow/heavy query can only
# cost that query's results, not the entire run. Glassdoor dropped — its
# location-autocomplete endpoint 403s ("Security | Glassdoor") on every
# request, not a query-format issue, so it was contributing zero jobs while
# adding load to every single request.
JOBSPY_QUERIES='
software engineer|United States
backend engineer|United States
fullstack engineer|United States
data engineer|United States
devops engineer|United States
product manager|United States
software engineer|Remote
machine learning engineer|United States
'

echo "$JOBSPY_QUERIES" | while IFS='|' read -r keyword location; do
  [ -z "$keyword" ] && continue
  echo "JobSpy query: $keyword / $location..."
  RESULT=$(curl -sf --max-time 60 -X POST "$API/ingest/jobspy" \
    -H 'Content-Type: application/json' \
    -d "{
      \"secret\": \"$SECRET\",
      \"max_results\": 50,
      \"sites\": [\"indeed\", \"linkedin\"],
      \"queries\": [{\"keyword\": \"$keyword\", \"location\": \"$location\"}]
    }") && echo "  → $RESULT" || echo "  → failed, continuing"
  sleep 3
done

echo "Step 4: Classifying + backfilling unresolved job locations..."
# Self-healing pass — an unresolved raw location string (no country/region
# geo.js could parse) leaves that job passing the US-only feed filter
# permissively, i.e. it silently shows up until someone notices it in
# production and geo.js gets hand-patched. This closes that gap
# automatically every day instead of waiting on a human to spot the next
# one. Report-only companion (no automatic write): scripts/audit-unmatched-locations.js
CLASSIFY=$(curl -sf --max-time 60 -X POST "$API/ingest/classify-locations" \
  -H 'Content-Type: application/json' \
  -d "{\"secret\":\"$SECRET\",\"limit\":40}") && echo "  → $CLASSIFY" || echo "  → failed, continuing"

echo "Daily ingestion triggered $(date)"

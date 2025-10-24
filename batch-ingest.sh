#!/bin/bash
# Batch ingest from verified Greenhouse companies

API_URL="https://elevate-careers-917362189743.europe-west1.run.app"

echo "🚀 Batch Job Ingestion"
echo "======================"
echo ""

# Verified companies that use Greenhouse
companies=(
  # Tier 1: Large companies with many jobs
  "stripe"
  "airbnb"
  "gitlab"
  "doordash"
  "reddit"
  
  # Tier 2: Medium-sized tech companies
  "figma"
  "notion"
  "plaid"
  "ramp"
  "brex"
  "databricks"
  "canva"
  "grammarly"
  "airtable"
  "gusto"
  
  # Tier 3: Growing companies
  "netlify"
  "segment"
  "lattice"
  "benchling"
  "coursera"
  "duolingo"
  "flexport"
  "clearbit"
  "deel"
  "snyk"
)

echo "📋 Will ingest ${#companies[@]} companies"
echo ""

successful=0
failed=0

for company in "${companies[@]}"; do
  echo "📥 Ingesting: $company"
  
  response=$(curl -s -X POST "$API_URL/ingest/org" \
    -H "Content-Type: application/json" \
    -d "{\"provider\": \"greenhouse\", \"org\": \"$company\"}")
  
  job_id=$(echo "$response" | jq -r '.jobId // empty')
  
  if [ -n "$job_id" ] && [ "$job_id" != "null" ]; then
    echo "   ✅ Queued: $job_id"
    ((successful++))
  else
    echo "   ❌ Failed"
    ((failed++))
  fi
  
  sleep 2  # Rate limit
done

echo ""
echo "📊 Summary"
echo "=========="
echo "✅ Queued: $successful"
echo "❌ Failed: $failed"
echo ""
echo "⏳ Jobs are being processed in the background..."
echo "   Processing ~${#companies[@]} companies takes about 5-10 minutes"
echo ""
echo "🔍 Check progress:"
echo "   curl \"$API_URL/jobs?limit=1\" | jq '.count'"
echo ""
echo "📋 View by company (after processing):"
echo "   curl -s \"$API_URL/jobs?limit=1000\" | jq -r '.jobs | group_by(.company_name) | .[] | \"\(.[0].company_name): \(length) jobs\"'"
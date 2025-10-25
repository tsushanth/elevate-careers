#!/bin/bash
# greenhouse-bulk-ingest.sh
# Bulk ingest jobs from multiple Greenhouse companies

API_URL="https://elevate-careers-917362189743.europe-west1.run.app"

# Top tech companies using Greenhouse
# Add more companies from: https://builtin.com or by checking company careers pages

COMPANIES=(
  "stripe"
  "anthropic"
  "notion"
  "figma"
  "databricks"
  "scale"
  "retool"
  "vercel"
  "linear"
  "lattice"
  "ramp"
  "plaid"
  "benchling"
  "sourcegraph"
  "rippling"
  "gitlab"
  "cockroachlabs"
  "airtable"
  "carta"
  "census"
)

echo "🚀 Starting Greenhouse bulk ingestion..."
echo "Total companies: ${#COMPANIES[@]}"
echo ""

SUCCESS=0
FAILED=0

for company in "${COMPANIES[@]}"; do
  echo "📥 Ingesting: $company"
  
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/ingest/org" \
    -H "Content-Type: application/json" \
    -d "{\"provider\": \"greenhouse\", \"org\": \"$company\"}")
  
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')
  
  if [ "$HTTP_CODE" -eq 200 ]; then
    echo "✅ Success: $company"
    echo "   Response: $BODY"
    ((SUCCESS++))
  else
    echo "❌ Failed: $company (HTTP $HTTP_CODE)"
    echo "   Response: $BODY"
    ((FAILED++))
  fi
  
  echo ""
  sleep 2  # Rate limiting - be nice to the APIs
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Summary:"
echo "   ✅ Success: $SUCCESS"
echo "   ❌ Failed: $FAILED"
echo "   📦 Total: ${#COMPANIES[@]}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check database stats
echo ""
echo "📈 Database stats (connect to see):"
echo "   psql \$DATABASE_URL -c \"SELECT COUNT(*), provider FROM job GROUP BY provider;\""
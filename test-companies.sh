#!/bin/bash
# Test which companies use Greenhouse

API_URL="https://elevate-careers-917362189743.europe-west1.run.app"

echo "🔍 Testing Companies on Greenhouse"
echo "===================================="
echo ""

# List of popular tech companies to test
companies=(
  # Known to work
  "stripe"
  "airbnb"
  "gitlab"
  "reddit"
  "doordash"
  "robinhood"
  "figma"
  "grammarly"
  "airtable"
  "notion"
  "databricks"
  "canva"
  "plaid"
  "coursera"
  "duolingo"
  "flexport"
  "benchling"
  "gusto"
  "lattice"
  "clearbit"
  "cockroach"
  "netlify"
  "segment"
  "mux"
  "deel"
  "snyk"
  "merge"
  "scale"
  "ramp"
  "brex"
  
  # Maybe work
  "coinbase"
  "uber"
  "lyft"
  "square"
  "shopify"
  "twitch"
  "discord"
  "dropbox"
  "github"
  "gitlab"
  "zoom"
  "slack"
  "asana"
  "docker"
  "elastic"
  "hashicorp"
  "mongodb"
  "redis"
  "salesforce"
  "hubspot"
  "atlassian"
  "zendesk"
)

working=()
not_working=()

for company in "${companies[@]}"; do
  echo -n "Testing $company... "
  
  # Test if their Greenhouse board exists
  status_code=$(curl -s -o /dev/null -w "%{http_code}" "https://boards.greenhouse.io/$company")
  
  if [ "$status_code" -eq "200" ]; then
    echo "✅ AVAILABLE"
    working+=("$company")
  else
    echo "❌ Not on Greenhouse (HTTP $status_code)"
    not_working+=("$company")
  fi
  
  sleep 0.5  # Rate limit
done

echo ""
echo "📊 Summary"
echo "=========="
echo ""
echo "✅ Companies using Greenhouse (${#working[@]}):"
for company in "${working[@]}"; do
  echo "   - $company"
done

echo ""
echo "❌ Companies NOT using Greenhouse (${#not_working[@]}):"
for company in "${not_working[@]}"; do
  echo "   - $company"
done

echo ""
echo "💡 To ingest jobs from available companies:"
echo ""
for company in "${working[@]:0:5}"; do
  echo "curl -X POST \"$API_URL/ingest/org\" \\"
  echo "  -H \"Content-Type: application/json\" \\"
  echo "  -d '{\"provider\": \"greenhouse\", \"org\": \"$company\"}'"
  echo ""
done
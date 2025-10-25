# discover-and-ingest.sh
# Script to discover companies and bulk ingest jobs

API_URL="https://elevate-careers-917362189743.europe-west1.run.app"

# Option 1: If you have a list of companies
# Create a companies.json file with your list

cat > companies.json << 'EOF'
{
  "greenhouse": [
    "anthropic",
    "stripe",
    "airbnb",
    "notion",
    "figma"
  ],
  "lever": [
    "netflix",
    "uber",
    "slack",
    "spotify"
  ],
  "ashby": [
    "rippling",
    "ramp"
  ],
  "smartrecruiters": [
    "bosch",
    "visa",
    "ikea"
  ]
}
EOF

# Ingest all companies
echo "Starting bulk ingestion..."

# Greenhouse
for org in $(jq -r '.greenhouse[]' companies.json); do
  echo "Ingesting Greenhouse: $org"
  curl -X POST "$API_URL/ingest/org" \
    -H "Content-Type: application/json" \
    -d "{\"provider\": \"greenhouse\", \"org\": \"$org\"}"
  echo ""
  sleep 2  # Rate limiting
done

# Lever
for org in $(jq -r '.lever[]' companies.json); do
  echo "Ingesting Lever: $org"
  curl -X POST "$API_URL/ingest/org" \
    -H "Content-Type: application/json" \
    -d "{\"provider\": \"lever\", \"org\": \"$org\"}"
  echo ""
  sleep 2
done

# Ashby
for org in $(jq -r '.ashby[]' companies.json); do
  echo "Ingesting Ashby: $org"
  curl -X POST "$API_URL/ingest/org" \
    -H "Content-Type: application/json" \
    -d "{\"provider\": \"ashby\", \"org\": \"$org\"}"
  echo ""
  sleep 2
done

# SmartRecruiters
for org in $(jq -r '.smartrecruiters[]' companies.json); do
  echo "Ingesting SmartRecruiters: $org"
  curl -X POST "$API_URL/ingest/org" \
    -H "Content-Type: application/json" \
    -d "{\"provider\": \"smartrecruiters\", \"org\": \"$org\"}"
  echo ""
  sleep 2
done

echo "Bulk ingestion complete!"
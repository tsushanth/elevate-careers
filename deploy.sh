#!/bin/bash
# Fix ingestion timeout - Quick Deploy

set -e

echo "🔧 Fixing Ingestion Timeout Issue"
echo "================================="
echo ""

PROJECT_ID="summarizerproxy"
REGION="europe-west1"
SERVICE_NAME="elevate-careers"
DATABASE_URL="postgresql://postgres:KashtePhale%219@db.uuntgvccvepqhfaupjqa.supabase.co:5432/postgres"

echo "📦 Building with fixes..."
gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME --project=$PROJECT_ID

echo ""
echo "🚀 Deploying..."
gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --set-env-vars "SERVICE_MODE=api,NODE_ENV=production,DATABASE_URL=$DATABASE_URL" \
  --memory 1Gi \
  --cpu 1 \
  --port 8080

echo ""
echo "✅ Deployed! Testing..."
sleep 5

echo ""
echo "Test 1: Health Check"
curl -s https://elevate-careers-917362189743.europe-west1.run.app/health | jq

echo ""
echo "Test 2: Ingestion (should return graceful message)"
curl -s -X POST https://elevate-careers-917362189743.europe-west1.run.app/ingest/org \
  -H "Content-Type: application/json" \
  -d '{"provider": "greenhouse", "org": "stripe"}' | jq

echo ""
echo "✅ All done!"
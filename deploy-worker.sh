#!/bin/bash
# Deploy worker with health check endpoint

set -e

echo "🔧 Deploying Worker with Health Check Fix"
echo "=========================================="
echo ""

PROJECT_ID="summarizerproxy"
REGION="europe-west1"
SERVICE_NAME="elevate-careers"
DATABASE_URL="${DATABASE_URL:?set DATABASE_URL in your environment}"
REDIS_HOST="outgoing-worm-35597.upstash.io"
REDIS_PORT="6379"
REDIS_PASSWORD="${REDIS_PASSWORD:?set REDIS_PASSWORD in your environment}"

echo "📦 Building container with worker health check..."
gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME --project=$PROJECT_ID

echo ""
echo "🚀 Deploying Worker service..."
gcloud run deploy elevate-careers-worker \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --region $REGION \
  --project $PROJECT_ID \
  --no-allow-unauthenticated \
  --set-env-vars "SERVICE_MODE=worker,NODE_ENV=production,DATABASE_URL=$DATABASE_URL,REDIS_HOST=$REDIS_HOST,REDIS_PORT=$REDIS_PORT,REDIS_PASSWORD=$REDIS_PASSWORD,REDIS_TLS=true,QUEUE_CONCURRENCY=3" \
  --memory 2Gi \
  --cpu 2 \
  --min-instances 1 \
  --max-instances 5 \
  --port 8080

echo ""
echo "✅ Worker deployed!"
echo ""
echo "📋 Check worker logs:"
echo "gcloud run services logs tail elevate-careers-worker --region europe-west1 --project summarizerproxy"
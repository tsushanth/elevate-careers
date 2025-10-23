#!/bin/bash
# Debug Deployment Script

set -e

PROJECT_ID="summarizerproxy"
REGION="europe-west1"
SERVICE_NAME="elevate-careers"

# Your database URL with URL-encoded password
DATABASE_URL="postgresql://postgres:KashtePhale%219@db.uuntgvccvepqhfaupjqa.supabase.co:5432/postgres"

echo "🔍 Debug Deployment with Better Error Logging"
echo "=============================================="
echo ""

echo "📦 Building container..."
gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME --project=$PROJECT_ID

echo ""
echo "🚀 Deploying with improved error logging..."
gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --platform managed \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --set-env-vars "SERVICE_MODE=api,NODE_ENV=production,DATABASE_URL=$DATABASE_URL,REDIS_HOST=localhost" \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --port 8080

echo ""
echo "✅ Deployment complete. Checking logs..."
sleep 5

echo ""
echo "📋 Recent logs:"
gcloud run services logs read $SERVICE_NAME \
  --region $REGION \
  --project $PROJECT_ID \
  --limit 30

echo ""
echo "🧪 Testing health endpoint..."
sleep 3
curl -v https://elevate-careers-917362189743.europe-west1.run.app/health
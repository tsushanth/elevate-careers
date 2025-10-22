#!/bin/bash
# Fixed Deployment Script for Elevate Careers

set -e

PROJECT_ID="summarizerproxy"
REGION="europe-west1"
SERVICE_NAME="elevate-careers"

echo "🚀 Deploying Elevate Careers Job Aggregator"
echo "============================================"
echo ""

# Step 1: Build and push image
echo "📦 Step 1: Building Docker image..."
gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME --project=$PROJECT_ID

# Step 2: Get Supabase credentials
echo ""
echo "📝 Step 2: Enter your Supabase credentials"
echo "Get these from: https://supabase.com/dashboard/project/_/settings/database"
echo ""
read -p "Enter your Supabase DATABASE_URL: " DATABASE_URL

# For now, we'll skip Redis (worker won't work but API will)
REDIS_HOST="localhost"

# Step 3: Deploy API
echo ""
echo "🌐 Step 3: Deploying API service..."
gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --platform managed \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --set-env-vars "SERVICE_MODE=api,NODE_ENV=production,DATABASE_URL=$DATABASE_URL,REDIS_HOST=$REDIS_HOST" \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --port 8080

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Your API is available at:"
gcloud run services describe $SERVICE_NAME --region $REGION --project $PROJECT_ID --format="value(status.url)"
echo ""
echo "🧪 Test it:"
echo "curl \$(gcloud run services describe $SERVICE_NAME --region $REGION --project $PROJECT_ID --format='value(status.url)')/health"
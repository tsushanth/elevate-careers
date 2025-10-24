#!/bin/bash
# Deploy Elevate Careers Frontend to Cloud Run

set -e

echo "🚀 Deploying Frontend to Cloud Run"
echo "===================================="
echo ""

PROJECT_ID="summarizerproxy"
REGION="europe-west1"
SERVICE_NAME="elevate-careers-frontend"

# Check if in correct directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Are you in the frontend directory?"
    exit 1
fi

echo "📦 Building container image..."
gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME --project=$PROJECT_ID

echo ""
echo "🚀 Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --platform managed \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --port 8080

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 Your frontend is live at:"
gcloud run services describe $SERVICE_NAME \
  --region $REGION \
  --project $PROJECT_ID \
  --format="value(status.url)"

echo ""
echo "🧪 Test it:"
URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --project $PROJECT_ID --format="value(status.url)")
echo "curl $URL/health"
echo ""
echo "Open in browser:"
echo "$URL"
#!/bin/bash

# Quick redeploy script for updates
# Use this after initial setup to push code changes

set -e

echo "🚀 Quick Redeploy to Cloud Run"
echo "==============================="
echo ""

# Configuration
PROJECT_ID="summarizerproxy"
REGION="us-central1"
SERVICE_NAME="job-tracker-api"

# Set project
gcloud config set project $PROJECT_ID

# Deploy
echo "Deploying updated code..."
gcloud run deploy $SERVICE_NAME \
    --source . \
    --region $REGION \
    --quiet

# Get URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME \
    --platform managed \
    --region $REGION \
    --format 'value(status.url)')

echo ""
echo "✅ Deployment complete!"
echo "API URL: $SERVICE_URL"
echo ""
echo "Test: curl $SERVICE_URL/health"
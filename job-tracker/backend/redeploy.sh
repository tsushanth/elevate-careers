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

echo ""
echo "📝 Updating environment variables from .env.production..."

# Read environment variables from .env.production
if [ ! -f ".env.production" ]; then
    echo "⚠️  Warning: .env.production not found, skipping env var update"
else
    JWT_SECRET=$(grep "^JWT_SECRET=" .env.production | cut -d'=' -f2-)
    DATABASE_URL=$(grep "^DATABASE_URL=" .env.production | cut -d'=' -f2-)
    SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.production | cut -d'=' -f2-)
    SUPABASE_ANON_KEY=$(grep "^SUPABASE_ANON_KEY=" .env.production | cut -d'=' -f2-)
    SUPABASE_SERVICE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.production | cut -d'=' -f2-)
    NODE_ENV=$(grep "^NODE_ENV=" .env.production | cut -d'=' -f2-)

    # Optional Stripe keys
    STRIPE_SECRET_KEY=$(grep "^STRIPE_SECRET_KEY=" .env.production | cut -d'=' -f2-)
    STRIPE_PUBLISHABLE_KEY=$(grep "^STRIPE_PUBLISHABLE_KEY=" .env.production | cut -d'=' -f2-)
    STRIPE_WEBHOOK_SECRET=$(grep "^STRIPE_WEBHOOK_SECRET=" .env.production | cut -d'=' -f2-)
    STRIPE_PRICE_ID=$(grep "^STRIPE_PRICE_ID=" .env.production | cut -d'=' -f2-)

    # Update required env vars (without PORT)
    echo "Setting required environment variables..."
    gcloud run services update $SERVICE_NAME \
        --region $REGION \
        --update-env-vars "JWT_SECRET=$JWT_SECRET,DATABASE_URL=$DATABASE_URL,SUPABASE_URL=$SUPABASE_URL,SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY,SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY,NODE_ENV=$NODE_ENV" \
        --quiet

    # Update Stripe keys if they exist and are not placeholder values
    if [ ! -z "$STRIPE_SECRET_KEY" ] && [ "$STRIPE_SECRET_KEY" != "sk_test_your_stripe_secret_key" ] && [ "$STRIPE_SECRET_KEY" != "REPLACE_ME_RUN_openssl_rand_hex_32" ]; then
        echo "Setting Stripe environment variables..."
        gcloud run services update $SERVICE_NAME \
            --region $REGION \
            --update-env-vars "STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY,STRIPE_PUBLISHABLE_KEY=$STRIPE_PUBLISHABLE_KEY,STRIPE_WEBHOOK_SECRET=$STRIPE_WEBHOOK_SECRET,STRIPE_PRICE_ID=$STRIPE_PRICE_ID" \
            --quiet
    else
        echo "⚠️  Stripe keys not configured or placeholder values detected, skipping Stripe env vars"
    fi
fi

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
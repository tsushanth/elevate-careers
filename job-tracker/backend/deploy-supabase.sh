#!/bin/bash

# Job Tracker - Supabase + Cloud Run Deployment Script
# Much simpler than Cloud SQL!

set -e

echo "🚀 Job Tracker - Supabase + Cloud Run Deployment"
echo "================================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Configuration
PROJECT_ID=""
REGION="us-central1"
SERVICE_NAME="job-tracker-api"

echo "📋 Checking prerequisites..."

# Check gcloud
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install${NC}"
    exit 1
fi

echo -e "${GREEN}✅ gcloud CLI found${NC}"

# Check .env.production
if [ ! -f ".env.production" ]; then
    echo -e "${RED}❌ .env.production not found!${NC}"
    echo "Please create .env.production with your Supabase credentials"
    exit 1
fi

echo -e "${GREEN}✅ .env.production found${NC}"

# Check JWT_SECRET is set
if grep -q "replace-with-random-secret-key" .env.production; then
    echo -e "${YELLOW}⚠️  JWT_SECRET not configured${NC}"
    echo "Generating JWT secret..."
    JWT_SECRET=$(openssl rand -hex 32)
    
    # Update .env.production
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env.production
    else
        sed -i "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env.production
    fi
    
    echo -e "${GREEN}✅ JWT_SECRET generated and saved${NC}"
fi

echo ""

# Get GCP Project ID
echo "🔧 Setting up GCP project..."
read -p "Enter your GCP Project ID: " INPUT_PROJECT_ID
PROJECT_ID="$INPUT_PROJECT_ID"

gcloud config set project $PROJECT_ID

echo "Enabling Cloud Run API..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com

echo -e "${GREEN}✅ GCP project configured${NC}"
echo ""

# Database setup reminder
echo "💾 Supabase Database Setup"
echo "=========================="
echo ""
echo "Have you created the database tables in Supabase?"
echo ""
echo "If not, do this now:"
echo "  1. Go to https://supabase.com/dashboard"
echo "  2. Select project: uuntgvccvepqhfaupjqa"
echo "  3. Go to SQL Editor"
echo "  4. Paste contents of schema.sql"
echo "  5. Click Run"
echo ""
read -p "Tables created in Supabase? (y/n): " DB_SETUP

if [ "$DB_SETUP" != "y" ]; then
    echo -e "${YELLOW}⚠️  Please set up database tables first${NC}"
    echo ""
    echo "Quick option - run this command:"
    echo 'psql "postgresql://postgres:KashtePhale!9@db.uuntgvccvepqhfaupjqa.supabase.co:5432/postgres" < schema.sql'
    echo ""
    read -p "Press Enter to continue after setting up tables..."
fi

echo -e "${GREEN}✅ Database ready${NC}"
echo ""

# Test database connection
echo "🔍 Testing database connection..."
if command -v psql &> /dev/null; then
    if psql "postgresql://postgres:KashtePhale!9@db.uuntgvccvepqhfaupjqa.supabase.co:5432/postgres" -c "SELECT 1" &> /dev/null; then
        echo -e "${GREEN}✅ Database connection successful${NC}"
    else
        echo -e "${YELLOW}⚠️  Could not connect to database${NC}"
        echo "Continuing anyway - will check during deployment"
    fi
else
    echo -e "${YELLOW}⚠️  psql not found - skipping connection test${NC}"
fi

echo ""

# Deploy to Cloud Run
echo "🚀 Deploying to Cloud Run..."
echo "This will take a few minutes..."
echo ""

# First deploy without env vars file
gcloud run deploy $SERVICE_NAME \
    --source . \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --memory 512Mi \
    --min-instances 0 \
    --max-instances 10 \
    --timeout 300

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Deployment failed!${NC}"
    echo "Check the error messages above"
    exit 1
fi

echo -e "${GREEN}✅ Deployment successful!${NC}"
echo ""

# Update environment variables from .env.production
echo "📝 Setting environment variables..."
echo ""

# Read JWT_SECRET from .env.production
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

# Update required env vars
gcloud run services update $SERVICE_NAME \
    --region $REGION \
    --update-env-vars "JWT_SECRET=$JWT_SECRET,DATABASE_URL=$DATABASE_URL,SUPABASE_URL=$SUPABASE_URL,SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY,SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY,NODE_ENV=$NODE_ENV"

# Update Stripe keys if they exist
if [ ! -z "$STRIPE_SECRET_KEY" ] && [ "$STRIPE_SECRET_KEY" != "sk_test_your_stripe_secret_key" ]; then
    echo "Setting Stripe environment variables..."
    gcloud run services update $SERVICE_NAME \
        --region $REGION \
        --update-env-vars "STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY,STRIPE_PUBLISHABLE_KEY=$STRIPE_PUBLISHABLE_KEY,STRIPE_WEBHOOK_SECRET=$STRIPE_WEBHOOK_SECRET,STRIPE_PRICE_ID=$STRIPE_PRICE_ID"
fi

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Deployment failed!${NC}"
    echo "Check the error messages above"
    exit 1
fi

echo -e "${GREEN}✅ Deployment successful!${NC}"
echo ""

# Get service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME \
    --platform managed \
    --region $REGION \
    --format 'value(status.url)')

echo "================================================"
echo -e "${GREEN}🎉 Deployment Complete!${NC}"
echo "================================================"
echo ""
echo "Your API is now live at:"
echo -e "${YELLOW}$SERVICE_URL${NC}"
echo ""
echo "Test your deployment:"
echo "  curl $SERVICE_URL/health"
echo ""
echo "Register a test user:"
echo "  curl -X POST $SERVICE_URL/api/auth/register \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"email\":\"test@example.com\",\"password\":\"password123\"}'"
echo ""
echo "Update your desktop app:"
echo "  In desktop/.env add:"
echo "  API_URL=$SERVICE_URL/api"
echo ""
echo "View logs:"
echo "  gcloud run services logs tail $SERVICE_NAME --region $REGION"
echo ""
echo "Redeploy after changes:"
echo "  ./redeploy.sh"
echo ""
echo "================================================"
echo ""
echo "Database Dashboard:"
echo "  https://supabase.com/dashboard/project/uuntgvccvepqhfaupjqa"
echo ""
echo "Cloud Run Console:"
echo "  https://console.cloud.google.com/run/detail/$REGION/$SERVICE_NAME"
echo ""
echo "================================================"
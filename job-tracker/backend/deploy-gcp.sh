#!/bin/bash

# Job Tracker - GCP Deployment Script
# This script automates the deployment process to Google Cloud Platform

set -e  # Exit on error

echo "🚀 Job Tracker - GCP Deployment Script"
echo "========================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID="job-tracker-prod"
REGION="us-central1"
SERVICE_NAME="job-tracker-api"
DB_INSTANCE_NAME="job-tracker-db"
DB_NAME="job_tracker"
DB_USER="jobtracker"

# Step 1: Check prerequisites
echo "📋 Checking prerequisites..."

if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ gcloud CLI not found. Please install: https://cloud.google.com/sdk/docs/install${NC}"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker not found. Please install: https://docs.docker.com/get-docker/${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites checked${NC}"
echo ""

# Step 2: Project setup
echo "🔧 Setting up GCP project..."
read -p "Enter your GCP Project ID (or press Enter to use '$PROJECT_ID'): " INPUT_PROJECT_ID
if [ ! -z "$INPUT_PROJECT_ID" ]; then
    PROJECT_ID="$INPUT_PROJECT_ID"
fi

gcloud config set project $PROJECT_ID

echo "Enabling required APIs..."
gcloud services enable run.googleapis.com
gcloud services enable sqladmin.googleapis.com
gcloud services enable secretmanager.googleapis.com
gcloud services enable cloudbuild.googleapis.com

echo -e "${GREEN}✅ Project configured${NC}"
echo ""

# Step 3: Database setup
echo "💾 Setting up Cloud SQL..."
read -p "Do you want to create a new Cloud SQL instance? (y/n): " CREATE_DB

if [ "$CREATE_DB" = "y" ]; then
    read -sp "Enter database root password: " DB_ROOT_PASSWORD
    echo ""
    read -sp "Enter database user password: " DB_PASSWORD
    echo ""
    
    echo "Creating Cloud SQL instance (this may take a few minutes)..."
    gcloud sql instances create $DB_INSTANCE_NAME \
        --database-version=POSTGRES_14 \
        --tier=db-f1-micro \
        --region=$REGION \
        --root-password="$DB_ROOT_PASSWORD" || echo "Instance may already exist"
    
    echo "Creating database..."
    gcloud sql databases create $DB_NAME \
        --instance=$DB_INSTANCE_NAME || echo "Database may already exist"
    
    echo "Creating database user..."
    gcloud sql users create $DB_USER \
        --instance=$DB_INSTANCE_NAME \
        --password="$DB_PASSWORD" || echo "User may already exist"
    
    echo -e "${GREEN}✅ Database created${NC}"
else
    read -sp "Enter existing database password: " DB_PASSWORD
    echo ""
fi

# Get connection name
CONNECTION_NAME=$(gcloud sql instances describe $DB_INSTANCE_NAME --format="value(connectionName)")
echo "Database connection name: $CONNECTION_NAME"
echo ""

# Step 4: Run migrations
echo "📊 Running database migrations..."
read -p "Do you want to run database migrations now? (y/n): " RUN_MIGRATIONS

if [ "$RUN_MIGRATIONS" = "y" ]; then
    echo "Starting Cloud SQL Proxy..."
    # Download Cloud SQL Proxy if not exists
    if [ ! -f "./cloud-sql-proxy" ]; then
        echo "Downloading Cloud SQL Proxy..."
        curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.8.0/cloud-sql-proxy.linux.amd64
        chmod +x cloud-sql-proxy
    fi
    
    # Start proxy in background
    ./cloud-sql-proxy $CONNECTION_NAME &
    PROXY_PID=$!
    sleep 5
    
    # Run migrations
    echo "Running schema.sql..."
    PGPASSWORD="$DB_PASSWORD" psql -h 127.0.0.1 -p 5432 -U $DB_USER -d $DB_NAME -f schema.sql
    
    # Stop proxy
    kill $PROXY_PID
    
    echo -e "${GREEN}✅ Migrations complete${NC}"
fi
echo ""

# Step 5: Setup secrets
echo "🔐 Setting up secrets..."
read -p "Generate new JWT secret? (y/n): " GEN_JWT

if [ "$GEN_JWT" = "y" ]; then
    JWT_SECRET=$(openssl rand -hex 32)
    echo -n "$JWT_SECRET" | gcloud secrets create jwt-secret --data-file=- || \
        echo -n "$JWT_SECRET" | gcloud secrets versions add jwt-secret --data-file=-
    echo -e "${GREEN}✅ JWT secret created${NC}"
fi

# Create database URL secret
DB_URL="postgresql://$DB_USER:$DB_PASSWORD@/job_tracker?host=/cloudsql/$CONNECTION_NAME"
echo -n "$DB_URL" | gcloud secrets create database-url --data-file=- || \
    echo -n "$DB_URL" | gcloud secrets versions add database-url --data-file=-

echo -e "${GREEN}✅ Secrets configured${NC}"

# Grant access to secrets
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
gcloud secrets add-iam-policy-binding jwt-secret \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor" --quiet

gcloud secrets add-iam-policy-binding database-url \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor" --quiet

echo ""

# Step 6: Deploy to Cloud Run
echo "🚀 Deploying to Cloud Run..."

gcloud run deploy $SERVICE_NAME \
    --source . \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --add-cloudsql-instances $CONNECTION_NAME \
    --set-secrets="JWT_SECRET=jwt-secret:latest,DATABASE_URL=database-url:latest" \
    --set-env-vars="NODE_ENV=production" \
    --memory 512Mi \
    --min-instances 0 \
    --max-instances 10

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""

# Step 7: Get service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME \
    --platform managed \
    --region $REGION \
    --format 'value(status.url)')

echo "================================================"
echo -e "${GREEN}🎉 Deployment Successful!${NC}"
echo "================================================"
echo ""
echo "Your API is now live at:"
echo -e "${YELLOW}$SERVICE_URL${NC}"
echo ""
echo "Test your deployment:"
echo "  curl $SERVICE_URL/health"
echo ""
echo "Update your desktop app's .env file:"
echo "  API_URL=$SERVICE_URL/api"
echo ""
echo "View logs:"
echo "  gcloud run services logs tail $SERVICE_NAME --region $REGION"
echo ""
echo "Next steps:"
echo "  1. Test all API endpoints"
echo "  2. Update desktop app configuration"
echo "  3. Set up monitoring alerts"
echo "  4. Configure custom domain (optional)"
echo ""
echo "================================================"
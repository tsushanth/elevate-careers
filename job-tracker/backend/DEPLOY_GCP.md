# Deploy Backend to Google Cloud Platform

This guide will help you deploy the Job Tracker backend to GCP using Cloud Run and Cloud SQL.

## Prerequisites

1. Google Cloud account
2. `gcloud` CLI installed ([Install Guide](https://cloud.google.com/sdk/docs/install))
3. Docker installed locally (for testing)
4. Your backend code

## Architecture

```
Cloud Run (API)
    ↓
Cloud SQL (PostgreSQL)
    ↓
Secret Manager (Environment Variables)
```

## Cost Estimate

- **Cloud Run**: ~$5-10/month (with free tier)
- **Cloud SQL**: ~$10-30/month (db-f1-micro instance)
- **Total**: ~$15-40/month

## Step 1: Setup GCP Project

```bash
# Login to GCP
gcloud auth login

# Create new project (or use existing)
gcloud projects create job-tracker-prod --name="Job Tracker"

# Set as default project
gcloud config set project job-tracker-prod

# Enable required APIs
gcloud services enable run.googleapis.com
gcloud services enable sqladmin.googleapis.com
gcloud services enable secretmanager.googleapis.com
gcloud services enable cloudbuild.googleapis.com
```

## Step 2: Setup Cloud SQL (PostgreSQL)

```bash
# Create PostgreSQL instance
gcloud sql instances create job-tracker-db \
    --database-version=POSTGRES_14 \
    --tier=db-f1-micro \
    --region=us-central1 \
    --root-password=CHOOSE_A_STRONG_PASSWORD

# Create database
gcloud sql databases create job_tracker \
    --instance=job-tracker-db

# Create database user
gcloud sql users create jobtracker \
    --instance=job-tracker-db \
    --password=CHOOSE_A_STRONG_PASSWORD

# Get connection name (save this!)
gcloud sql instances describe job-tracker-db --format="value(connectionName)"
# Output example: job-tracker-prod:us-central1:job-tracker-db
```

## Step 3: Run Database Migrations

### Option A: Using Cloud SQL Proxy (Recommended)

```bash
# Download Cloud SQL Proxy
curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.8.0/cloud-sql-proxy.linux.amd64
chmod +x cloud-sql-proxy

# Start proxy (in separate terminal)
./cloud-sql-proxy job-tracker-prod:us-central1:job-tracker-db

# In another terminal, run migrations
psql "host=127.0.0.1 port=5432 dbname=job_tracker user=jobtracker password=YOUR_PASSWORD" \
    < schema.sql
```

### Option B: Using gcloud sql connect

```bash
# Connect to database
gcloud sql connect job-tracker-db --user=jobtracker --database=job_tracker

# Paste the contents of schema.sql and execute
# Or copy schema.sql to a Cloud Storage bucket and import
```

## Step 4: Setup Secrets

```bash
# Create JWT secret
echo -n "$(openssl rand -hex 32)" | gcloud secrets create jwt-secret --data-file=-

# Create database URL secret
echo -n "postgresql://jobtracker:YOUR_PASSWORD@/job_tracker?host=/cloudsql/job-tracker-prod:us-central1:job-tracker-db" | \
    gcloud secrets create database-url --data-file=-

# Optional: Firebase credentials (if using push notifications)
echo -n "YOUR_FIREBASE_PROJECT_ID" | gcloud secrets create firebase-project-id --data-file=-
echo -n "YOUR_FIREBASE_CLIENT_EMAIL" | gcloud secrets create firebase-client-email --data-file=-
echo -n "YOUR_FIREBASE_PRIVATE_KEY" | gcloud secrets create firebase-private-key --data-file=-

# Grant Cloud Run access to secrets
PROJECT_NUMBER=$(gcloud projects describe job-tracker-prod --format="value(projectNumber)")
gcloud secrets add-iam-policy-binding jwt-secret \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding database-url \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
```

## Step 5: Prepare Backend Code

Update `backend/src/index.js` to support Cloud Run's PORT:

```javascript
// Change this line:
const PORT = process.env.PORT || 3000;

// To:
const PORT = process.env.PORT || 8080;
```

## Step 6: Build and Deploy to Cloud Run

### From your local machine:

```bash
cd backend

# Build and deploy in one command
gcloud run deploy job-tracker-api \
    --source . \
    --platform managed \
    --region us-central1 \
    --allow-unauthenticated \
    --add-cloudsql-instances job-tracker-prod:us-central1:job-tracker-db \
    --set-secrets="JWT_SECRET=jwt-secret:latest,DATABASE_URL=database-url:latest" \
    --set-env-vars="NODE_ENV=production" \
    --memory 512Mi \
    --min-instances 0 \
    --max-instances 10

# This will:
# 1. Build Docker image using Cloud Build
# 2. Push to Container Registry
# 3. Deploy to Cloud Run
# 4. Connect to Cloud SQL
# 5. Inject secrets as environment variables
```

### If you have a container already built:

```bash
# Build Docker image
docker build -t gcr.io/job-tracker-prod/backend:v1 .

# Push to Google Container Registry
docker push gcr.io/job-tracker-prod/backend:v1

# Deploy to Cloud Run
gcloud run deploy job-tracker-api \
    --image gcr.io/job-tracker-prod/backend:v1 \
    --platform managed \
    --region us-central1 \
    --allow-unauthenticated \
    --add-cloudsql-instances job-tracker-prod:us-central1:job-tracker-db \
    --set-secrets="JWT_SECRET=jwt-secret:latest,DATABASE_URL=database-url:latest" \
    --set-env-vars="NODE_ENV=production"
```

## Step 7: Get Your API URL

```bash
# Get the deployed URL
gcloud run services describe job-tracker-api \
    --platform managed \
    --region us-central1 \
    --format 'value(status.url)'

# Example output: https://job-tracker-api-abc123-uc.a.run.app
```

## Step 8: Test Your Deployment

```bash
# Health check
curl https://YOUR-CLOUD-RUN-URL/health

# Register a user
curl -X POST https://YOUR-CLOUD-RUN-URL/api/auth/register \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"password123"}'

# Login
curl -X POST https://YOUR-CLOUD-RUN-URL/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"password123"}'
```

## Step 9: Update Desktop App

Update `desktop/.env` with your Cloud Run URL:

```bash
API_URL=https://YOUR-CLOUD-RUN-URL/api
```

Or create the file if it doesn't exist.

## Step 10: Setup Custom Domain (Optional)

```bash
# Map custom domain
gcloud run domain-mappings create \
    --service job-tracker-api \
    --domain api.yourdomain.com \
    --region us-central1

# Follow instructions to add DNS records
```

## Monitoring & Logs

### View Logs

```bash
# Real-time logs
gcloud run services logs tail job-tracker-api --region us-central1

# Recent logs
gcloud run services logs read job-tracker-api --region us-central1 --limit 50
```

### Cloud Console

1. Go to https://console.cloud.google.com
2. Navigate to Cloud Run
3. Click on `job-tracker-api`
4. View metrics, logs, and revisions

## Environment Variables Reference

Cloud Run will inject these automatically from Secret Manager:

```bash
JWT_SECRET           # From secret: jwt-secret
DATABASE_URL         # From secret: database-url
NODE_ENV=production  # Set directly
PORT                 # Auto-set by Cloud Run (8080)

# Optional (if using Firebase):
FIREBASE_PROJECT_ID      # From secret: firebase-project-id
FIREBASE_CLIENT_EMAIL    # From secret: firebase-client-email
FIREBASE_PRIVATE_KEY     # From secret: firebase-private-key
```

## Updating Your Deployment

```bash
# After making code changes, redeploy:
cd backend
gcloud run deploy job-tracker-api --source .

# Or with specific version tag:
docker build -t gcr.io/job-tracker-prod/backend:v2 .
docker push gcr.io/job-tracker-prod/backend:v2
gcloud run deploy job-tracker-api \
    --image gcr.io/job-tracker-prod/backend:v2
```

## Cost Optimization

### Use Smaller Instance

```bash
# After confirming it works, downgrade to smaller instance:
gcloud sql instances patch job-tracker-db \
    --tier=db-f1-micro
```

### Set Min Instances to 0

```bash
# Cloud Run already set to --min-instances 0
# This means it scales to zero when not in use (saves money!)
```

## Security Hardening

### 1. Restrict Cloud Run Access (if needed)

```bash
# Remove public access
gcloud run services remove-iam-policy-binding job-tracker-api \
    --region us-central1 \
    --member="allUsers" \
    --role="roles/run.invoker"

# Add specific users/services
gcloud run services add-iam-policy-binding job-tracker-api \
    --region us-central1 \
    --member="user:youremail@example.com" \
    --role="roles/run.invoker"
```

### 2. Enable Cloud Armor (DDoS Protection)

```bash
# Setup load balancer and Cloud Armor for production
# Follow: https://cloud.google.com/armor/docs/configure-security-policies
```

### 3. Setup VPC Connector (Optional)

For additional security, connect Cloud Run to VPC.

## Troubleshooting

### Can't connect to database

```bash
# Check Cloud SQL instance status
gcloud sql instances describe job-tracker-db

# Test connection using Cloud SQL Proxy
./cloud-sql-proxy job-tracker-prod:us-central1:job-tracker-db
psql "host=127.0.0.1 port=5432 dbname=job_tracker user=jobtracker"
```

### Secrets not accessible

```bash
# Check secret permissions
gcloud secrets get-iam-policy jwt-secret

# Grant access to Cloud Run service account
PROJECT_NUMBER=$(gcloud projects describe job-tracker-prod --format="value(projectNumber)")
gcloud secrets add-iam-policy-binding jwt-secret \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
```

### Application crashes

```bash
# View detailed logs
gcloud run services logs read job-tracker-api \
    --region us-central1 \
    --limit 100

# Check for errors in Cloud Console
```

## Backup & Recovery

### Database Backups

```bash
# Cloud SQL automatically backs up daily
# Configure backup settings:
gcloud sql instances patch job-tracker-db \
    --backup-start-time=03:00

# Manual backup:
gcloud sql backups create --instance=job-tracker-db

# List backups:
gcloud sql backups list --instance=job-tracker-db

# Restore from backup:
gcloud sql backups restore BACKUP_ID --backup-instance=job-tracker-db
```

## CI/CD with GitHub Actions (Bonus)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Cloud Run

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - uses: google-github-actions/setup-gcloud@v0
        with:
          service_account_key: ${{ secrets.GCP_SA_KEY }}
          project_id: job-tracker-prod
      
      - name: Deploy to Cloud Run
        run: |
          cd backend
          gcloud run deploy job-tracker-api --source .
```

## Summary

You now have:
- ✅ Backend API running on Cloud Run
- ✅ PostgreSQL database on Cloud SQL
- ✅ Secrets managed securely
- ✅ HTTPS enabled automatically
- ✅ Auto-scaling configured
- ✅ Logging and monitoring

Your API is live at: `https://YOUR-CLOUD-RUN-URL`

Update your desktop app's `.env` file with this URL and you're ready to go!

## Next Steps

1. Test all API endpoints
2. Update desktop app configuration
3. Set up monitoring alerts
4. Configure backups
5. Add custom domain (optional)
6. Setup CI/CD (optional)

## Support

- Cloud Run Docs: https://cloud.google.com/run/docs
- Cloud SQL Docs: https://cloud.google.com/sql/docs
- GCP Console: https://console.cloud.google.com
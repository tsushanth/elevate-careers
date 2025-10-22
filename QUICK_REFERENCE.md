# Quick Reference Card - Job Aggregator Platform

## 🚀 One-Line Deploy
```bash
./deploy-all.sh
```

## 📦 Services Overview

| Service | Port | Purpose | Scaling |
|---------|------|---------|---------|
| Ingestion API | 8080 | Trigger job fetches | 0-10 |
| Fetcher Worker | 8080 | Process & store jobs | 0-50 |
| Public API | 8080 | Search & user features | 1-20 |

## 🔗 Key Endpoints

### Ingestion API
```bash
POST /ingest/org          # Fetch single organization
POST /ingest/batch        # Fetch multiple orgs
GET  /ingest/status/{id}  # Check ingestion status
GET  /health              # Health check
```

### Public API
```bash
GET  /jobs                      # Search jobs
GET  /jobs/{id}                 # Get job details
GET  /companies                 # List companies
POST /saved-searches            # Create alert
GET  /saved-searches            # List alerts
POST /applications              # Track application
GET  /applications              # List applications
PATCH /applications/{id}        # Update status
GET  /health                    # Health check
GET  /docs                      # Swagger UI
```

## 💻 Common Commands

### Deploy Services
```bash
cd ingestion-api && ./deploy.sh    # Deploy ingestion
cd fetcher-worker && ./deploy.sh   # Deploy worker
cd public-api && ./deploy.sh       # Deploy API
```

### Database
```bash
cd shared/migrations && ./apply_migrations.sh   # Apply schema
psql -h INSTANCE_IP -U postgres -d jobsdb       # Connect
```

### View Logs
```bash
gcloud run services logs read ingestion-api --region=us-central1
gcloud run services logs read fetcher-worker --region=us-central1
gcloud run services logs read public-api --region=us-central1
```

### Infrastructure
```bash
cd infra/terraform
terraform plan -var="project_id=PROJECT" -var="region=REGION"
terraform apply -var="project_id=PROJECT" -var="region=REGION"
terraform destroy -var="project_id=PROJECT" -var="region=REGION"
```

## 🧪 Test Examples

### Fetch Jobs
```bash
curl -X POST https://YOUR-INGESTION-URL/ingest/org \
  -H "Content-Type: application/json" \
  -d '{"provider":"greenhouse","org":"anthropic"}'
```

### Search Jobs
```bash
# All jobs
curl "https://YOUR-PUBLIC-URL/jobs?page=1&page_size=20"

# By keyword
curl "https://YOUR-PUBLIC-URL/jobs?keyword=python+engineer"

# Remote only
curl "https://YOUR-PUBLIC-URL/jobs?remote=true"

# Location filter
curl "https://YOUR-PUBLIC-URL/jobs?location=San%20Francisco"

# Recent jobs
curl "https://YOUR-PUBLIC-URL/jobs?posted_since_days=7"

# Salary filter
curl "https://YOUR-PUBLIC-URL/jobs?salary_min=100000"
```

### User Features
```bash
USER_ID="550e8400-e29b-41d4-a716-446655440000"

# Create saved search
curl -X POST "https://YOUR-PUBLIC-URL/saved-searches?user_id=$USER_ID" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Alert","query":{"keyword":"python"},"frequency":"daily"}'

# Track application
curl -X POST "https://YOUR-PUBLIC-URL/applications?user_id=$USER_ID" \
  -H "Content-Type: application/json" \
  -d '{"job_id":1,"status":"applied","notes":"Great company!"}'

# List applications
curl "https://YOUR-PUBLIC-URL/applications?user_id=$USER_ID"
```

## 🛠️ Configuration

### Environment Variables
```bash
export PROJECT_ID="your-gcp-project"
export REGION="us-central1"
export DATABASE_URL="postgresql://user:pass@host/db"
```

### Cost Controls
```bash
# Scale down for testing
gcloud run services update public-api --min-instances=0 --max-instances=3

# Upgrade database
terraform apply -var="db_tier=db-custom-4-15360"

# Adjust queue limits
gcloud tasks queues update job-fetcher-queue \
  --max-concurrent-dispatches=50
```

## 📊 Database Quick Queries

```sql
-- Count jobs by provider
SELECT provider, COUNT(*) FROM job WHERE is_active=true GROUP BY provider;

-- Recent jobs
SELECT title, company.name, posted_at 
FROM job JOIN company ON job.company_id=company.id 
WHERE is_active=true ORDER BY posted_at DESC LIMIT 10;

-- Jobs by location
SELECT city, COUNT(*) FROM job_location 
WHERE city IS NOT NULL GROUP BY city ORDER BY count DESC;

-- Ingestion stats
SELECT provider, status, COUNT(*) 
FROM ingest_job GROUP BY provider, status;
```

## 🔧 Troubleshooting

| Issue | Command |
|-------|---------|
| Check service status | `gcloud run services describe SERVICE --region=REGION` |
| View logs | `gcloud run services logs read SERVICE --region=REGION` |
| Test database | `psql -h IP -U postgres -d jobsdb -c "SELECT version();"` |
| List tasks | `gcloud tasks list --queue=job-fetcher-queue --location=REGION` |
| Check IAM | `gcloud projects get-iam-policy PROJECT_ID` |

## 📁 Key Files

| File | Description |
|------|-------------|
| `README.md` | Main documentation |
| `ARCHITECTURE.md` | System design |
| `DEPLOYMENT.md` | Deploy guide |
| `PROJECT_SUMMARY.md` | Quick overview |
| `deploy-all.sh` | One-click deploy |
| `test-api.sh` | API tests |
| `shared/migrations/001_initial_schema.sql` | Database schema |
| `infra/terraform/main.tf` | Infrastructure |

## 🎯 Job Providers

### Currently Supported
- ✅ Greenhouse (API)
- ✅ Lever (API)
- ✅ JSON-LD (Web scraping)

### Easy to Add
- Ashby
- SmartRecruiters
- Workday
- iCIMS
- Custom ATS

### Implementation
Add new file to `fetcher-worker/src/sources/` following the pattern in existing sources.

## 💡 Pro Tips

1. **Use materialized view**: For fast aggregations
   ```sql
   REFRESH MATERIALIZED VIEW CONCURRENTLY job_search_view;
   ```

2. **Monitor costs**: Set budget alerts in GCP Console

3. **Enable caching**: Add Cloud CDN for Public API

4. **Scale database**: Use read replicas for high traffic

5. **Batch operations**: Use `/ingest/batch` for efficiency

## 🔐 Security Checklist

- [ ] Database password in Secret Manager
- [ ] Fetcher Worker requires authentication
- [ ] Service accounts with minimal permissions
- [ ] Cloud SQL authorized networks configured
- [ ] API rate limiting (future)
- [ ] User authentication (future)

## 📈 Monitoring Metrics

Watch these in Cloud Console:
- Request latency (p95 < 500ms)
- Error rate (< 1%)
- Database connections (< 80% of max)
- Cloud Run cold starts
- Task queue depth
- Cost per day

## 🎓 Learning Resources

- [Cloud Run Docs](https://cloud.google.com/run/docs)
- [FastAPI Tutorial](https://fastapi.tiangolo.com/tutorial/)
- [PostgreSQL FTS](https://www.postgresql.org/docs/current/textsearch.html)
- [Terraform GCP](https://registry.terraform.io/providers/hashicorp/google/latest/docs)

---

**Need help?** Check the docs or view logs in Cloud Console! 🚀
# Job Tracker Backend

Node.js backend API for the Job Tracker application.

## Features

- User authentication (JWT)
- Job search management
- Job batch processing from desktop clients
- Plugin distribution system
- Push notifications (Firebase Cloud Messaging)
- PostgreSQL database

## Setup

### Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- Firebase project (for push notifications - optional)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Create PostgreSQL database:
```bash
createdb job_tracker
```

3. Run database migrations:
```bash
psql job_tracker < schema.sql
```

4. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

### Environment Variables

```env
DATABASE_URL=postgresql://user:password@localhost:5432/job_tracker
JWT_SECRET=your-secret-key
PORT=3000
NODE_ENV=development

# Optional: Firebase Cloud Messaging
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-client-email
FIREBASE_PRIVATE_KEY=your-private-key
```

### Running

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## API Endpoints

### Authentication

**Register**
```
POST /api/auth/register
Body: { email, password }
Response: { success, token, user }
```

**Login**
```
POST /api/auth/login
Body: { email, password }
Response: { success, token, user }
```

### Search Queries

**Get all searches**
```
GET /api/searches/mine
Headers: Authorization: Bearer <token>
Response: { success, searches: [...] }
```

**Create search**
```
POST /api/searches
Headers: Authorization: Bearer <token>
Body: { board, queryUrl, interval }
Response: { success, search }
```

**Update search**
```
PATCH /api/searches/:id
Headers: Authorization: Bearer <token>
Body: { queryUrl?, interval?, active? }
Response: { success, search }
```

**Delete search**
```
DELETE /api/searches/:id
Headers: Authorization: Bearer <token>
Response: { success }
```

### Jobs

**Process batch (from desktop)**
```
POST /api/jobs/batch
Headers: Authorization: Bearer <token>
Body: { searchId, board, jobs: [...], scrapedAt }
Response: { success, processed, new, existing, filtered, newJobs: [...] }
```

**Get jobs**
```
GET /api/jobs?status=new&page=1&limit=50
Headers: Authorization: Bearer <token>
Response: { success, jobs: [...], total, page, perPage, totalPages }
```

**Get single job**
```
GET /api/jobs/:id
Headers: Authorization: Bearer <token>
Response: { success, job }
```

**Update job status**
```
PATCH /api/jobs/:id
Headers: Authorization: Bearer <token>
Body: { status }  // "new", "seen", "applied", "rejected"
Response: { success, job }
```

### Plugins

**Get plugin manifest**
```
GET /api/plugins/manifest
Headers: Authorization: Bearer <token>
Response: { success, plugins: { linkedin: { version, name, ... } } }
```

**Download plugin**
```
GET /api/plugins/:name/download
Headers: Authorization: Bearer <token>
Response: <JavaScript code>
```

## Plugin Development

Plugins are stored in `backend/plugins/[name]/`

### Plugin Structure

```
plugins/
└── linkedin/
    ├── manifest.json
    └── scraper.js
```

### manifest.json
```json
{
  "name": "linkedin",
  "version": "1.0.0",
  "description": "LinkedIn job scraper",
  "interval": 30,
  "requiresAuth": true,
  "updated": "2025-10-31T00:00:00Z"
}
```

### scraper.js
```javascript
export async function scrape(page, queryUrl) {
  // Puppeteer page object
  await page.goto(queryUrl);
  
  // Extract jobs
  const jobs = await page.evaluate(() => {
    // DOM parsing logic
    return [...]; // Array of job objects
  });
  
  return jobs;
}
```

### Job Object Format
```javascript
{
  externalId: "123456",      // Required: Job board's ID
  title: "Software Engineer", // Required
  company: "Acme Corp",       // Optional
  location: "Remote",         // Optional
  url: "https://...",         // Required
  postedDate: "2 days ago"    // Optional
}
```

## Database Schema

See `schema.sql` for complete schema.

Key tables:
- `users` - User accounts
- `devices` - Registered devices for push notifications
- `user_searches` - Job search queries
- `jobs` - Scraped jobs
- `user_filters` - User filter preferences

## Deployment

### Docker (recommended)

```bash
docker build -t job-tracker-backend .
docker run -p 3000:3000 --env-file .env job-tracker-backend
```

### Manual

1. Set up PostgreSQL
2. Run migrations
3. Configure environment variables
4. Start with `npm start`

## License

MIT
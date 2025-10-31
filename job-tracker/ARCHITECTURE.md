# Job Tracker - Project Structure

## Overview

```
job-tracker/
├── backend/              # Node.js API server
├── desktop/              # Electron desktop app
├── mobile/               # iOS app (placeholder for future)
├── README.md            # Main documentation
├── QUICKSTART.md        # Quick start guide
└── .gitignore          # Git ignore rules
```

## Backend (`/backend`)

Node.js + Express API server with PostgreSQL database.

```
backend/
├── src/
│   ├── index.js                    # Main server file
│   ├── db/
│   │   └── index.js               # Database connection
│   ├── middleware/
│   │   └── auth.js                # JWT authentication
│   ├── routes/
│   │   ├── auth.js                # Login/register endpoints
│   │   ├── jobs.js                # Job CRUD operations
│   │   ├── searches.js            # Search query management
│   │   └── plugins.js             # Plugin distribution
│   └── services/
│       └── notifications.js       # Firebase Cloud Messaging
├── plugins/                        # Scraper plugins
│   └── linkedin/
│       ├── manifest.json          # Plugin metadata
│       └── scraper.js             # Scraping logic
├── schema.sql                      # Database schema
├── package.json                    # Dependencies
├── .env.example                    # Environment template
└── README.md                       # Backend documentation
```

### Key Files

- **`src/index.js`**: Express server setup, routes, middleware
- **`src/routes/jobs.js`**: Handles job batch processing from desktop clients
- **`src/routes/plugins.js`**: Serves plugins to desktop clients
- **`plugins/linkedin/scraper.js`**: LinkedIn scraping implementation
- **`schema.sql`**: PostgreSQL database schema

## Desktop (`/desktop`)

Electron app with embedded Chromium for scraping.

```
desktop/
├── src/
│   ├── main.js                    # Electron main process
│   ├── services/
│   │   ├── api.js                 # Backend API client
│   │   ├── scraper.js             # Scraping orchestration
│   │   └── pluginManager.js       # Plugin download/loading
│   └── renderer/
│       ├── index.html             # UI markup
│       ├── styles.css             # UI styling
│       └── app.js                 # UI logic & IPC
├── package.json                    # Dependencies
└── README.md                       # Desktop documentation
```

### Key Files

- **`src/main.js`**: Electron app lifecycle, IPC handlers
- **`src/services/scraper.js`**: Browser management, scraping scheduler
- **`src/services/pluginManager.js`**: Downloads and caches plugins
- **`src/renderer/app.js`**: UI interactions, IPC calls to main process

## Data Flow

### Scraping Flow

```
Desktop App
    │
    ├─> PluginManager.checkForUpdates()
    │       └─> GET /api/plugins/manifest
    │       └─> GET /api/plugins/linkedin/download
    │
    ├─> ScraperService.scrapeAll()
    │       ├─> Load plugin (linkedin.js)
    │       ├─> Open browser with user's session
    │       ├─> plugin.scrape(page, queryUrl)
    │       │       └─> Extract jobs from page
    │       │
    │       └─> ApiService.submitJobBatch()
    │               └─> POST /api/jobs/batch
    │                       │
    │                       ├─> Deduplicate by external_id
    │                       ├─> Apply user filters
    │                       ├─> Store in database
    │                       └─> Send FCM notifications
    │
    └─> UI shows new jobs
```

### Authentication Flow

```
Desktop App
    │
    ├─> User registers/logs in
    │       └─> POST /api/auth/register or /api/auth/login
    │               └─> Returns JWT token
    │
    ├─> Token stored in electron-store
    │
    └─> All subsequent API requests include:
            Authorization: Bearer <token>
```

### Job Status Update Flow

```
Desktop/Mobile App
    │
    ├─> User changes job status
    │       └─> PATCH /api/jobs/:id { status: "applied" }
    │               └─> Updates database
    │
    └─> Other devices fetch latest
            └─> GET /api/jobs
                    └─> Returns updated list
```

## Database Schema

### Main Tables

**users**
- Stores user accounts
- Fields: id, email, password_hash, created_at

**devices**
- Registered devices for push notifications
- Fields: id, user_id, device_type, fcm_token, last_seen

**user_searches**
- Job search queries configured by users
- Fields: id, user_id, board_name, query_url, interval_minutes, active

**jobs**
- All scraped jobs
- Fields: id, user_id, search_id, external_id, title, company, location, url, status
- Unique constraint: (user_id, board_name, external_id)

**user_filters**
- User's filtering preferences
- Fields: id, user_id, exclude_keywords, include_keywords, exclude_companies

## API Endpoints

### Authentication
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Login

### Search Queries
- `GET /api/searches/mine` - Get user's searches
- `POST /api/searches` - Create search
- `PATCH /api/searches/:id` - Update search
- `DELETE /api/searches/:id` - Delete search

### Jobs
- `POST /api/jobs/batch` - Submit scraped jobs (from desktop)
- `GET /api/jobs` - Get jobs with filters
- `GET /api/jobs/:id` - Get single job
- `PATCH /api/jobs/:id` - Update job status

### Plugins
- `GET /api/plugins/manifest` - Get available plugins
- `GET /api/plugins/:name/download` - Download plugin code

## Plugin Architecture

### Plugin Structure

```javascript
// manifest.json
{
  "name": "linkedin",
  "version": "1.0.0",
  "interval": 30,
  "requiresAuth": true
}

// scraper.js
export async function scrape(page, queryUrl) {
  // Navigate to URL
  await page.goto(queryUrl);
  
  // Extract jobs
  const jobs = await page.evaluate(() => {
    // DOM parsing logic
    return [{
      externalId: "123",
      title: "Job Title",
      company: "Company",
      location: "Location",
      url: "https://...",
      postedDate: "2 days ago"
    }];
  });
  
  return jobs;
}
```

### Plugin Update Mechanism

1. Backend stores plugin code in `backend/plugins/`
2. Desktop checks for updates on startup and before each scrape
3. Desktop compares local version with server version
4. Downloads and caches if outdated
5. Executes latest version

**Benefits:**
- No desktop app updates needed
- Fix scraping bugs instantly
- Add new job boards without client changes

## Environment Variables

### Backend

```env
DATABASE_URL=postgresql://...      # PostgreSQL connection
JWT_SECRET=random-secret          # JWT signing key
PORT=3000                         # Server port
NODE_ENV=development              # Environment
FIREBASE_PROJECT_ID=...           # Optional: FCM
FIREBASE_CLIENT_EMAIL=...         # Optional: FCM
FIREBASE_PRIVATE_KEY=...          # Optional: FCM
```

### Desktop

```env
API_URL=http://localhost:3000/api # Backend API endpoint
```

## Technology Stack

### Backend
- **Runtime**: Node.js 18+
- **Framework**: Express
- **Database**: PostgreSQL 14+
- **Auth**: JWT (jsonwebtoken)
- **Notifications**: Firebase Cloud Messaging
- **Dependencies**: pg, bcrypt, axios, cors

### Desktop
- **Framework**: Electron 28+
- **Browser**: Puppeteer (Chromium)
- **Storage**: electron-store
- **UI**: Vanilla HTML/CSS/JS
- **Dependencies**: puppeteer-core, axios

### Mobile (Future)
- **iOS**: Swift + SwiftUI
- **Android**: Kotlin + Jetpack Compose

## Security Considerations

### Authentication
- Passwords hashed with bcrypt
- JWT tokens for API access
- Tokens expire after 7 days

### Data Privacy
- No credential storage on backend
- Client-side scraping using user's sessions
- User data isolated per account

### API Security
- All endpoints require authentication (except register/login)
- Input validation on all endpoints
- SQL injection prevention via parameterized queries

## Performance

### Backend
- Database indexes on frequently queried columns
- Connection pooling for PostgreSQL
- Efficient deduplication using UNIQUE constraints

### Desktop
- Browser reuse (one per job board)
- Session persistence (login once)
- Plugin caching (only download when updated)
- Background scraping (every 30+ minutes)

## Deployment

### Backend Options
- Docker container
- Heroku
- DigitalOcean App Platform
- AWS Elastic Beanstalk
- Google Cloud Run

### Desktop Distribution
- Build installers with electron-builder
- Distribute `.dmg` (macOS) and `.exe` (Windows)
- Auto-update possible with electron-updater

## Development Workflow

### Adding a Feature

1. **Backend First**
   - Add database migration if needed
   - Create/update API endpoint
   - Test with curl or Postman

2. **Desktop Integration**
   - Add method to `services/api.js`
   - Add IPC handler in `main.js`
   - Update UI in `renderer/`

3. **Testing**
   - Test backend endpoint independently
   - Test desktop integration
   - Test across Mac/Windows if applicable

### Adding a Job Board Plugin

1. Create `backend/plugins/[board-name]/`
2. Add `manifest.json` and `scraper.js`
3. Test locally with desktop app
4. Deploy backend
5. Desktop apps auto-download new plugin

## Future Enhancements

### Phase 2
- [ ] iOS mobile app
- [ ] Android mobile app
- [ ] More job board plugins
- [ ] Advanced filtering
- [ ] Job analytics dashboard

### Phase 3
- [ ] Browser extension
- [ ] Team/company features
- [ ] Public API
- [ ] Webhook integrations
- [ ] AI-powered job matching

## Contributing

See main README.md for contribution guidelines.

Key areas:
- New job board plugins
- Mobile app development
- UI/UX improvements
- Documentation
- Testing

---

For more details, see:
- [Main README](README.md)
- [Backend README](backend/README.md)
- [Desktop README](desktop/README.md)
- [Quick Start Guide](QUICKSTART.md)
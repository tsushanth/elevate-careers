# Job Tracker

A cross-platform job application tracking system inspired by [first2apply](https://github.com/beastx-ro/first2apply).

## Overview

Job Tracker helps you monitor job boards for new postings and get notified instantly. It consists of:

- **Backend API** - Node.js server managing data, plugins, and notifications
- **Desktop App** - Electron app that scrapes job boards using your logged-in sessions
- **Mobile App** - iOS app for viewing jobs on-the-go (future)

## Key Features

✅ **Automated Job Monitoring**
- Desktop app scrapes job boards every 30+ minutes
- Uses your logged-in sessions (LinkedIn, etc.)
- Configurable search queries

✅ **Plugin Architecture**
- Plugins stored on backend, auto-update on clients
- No client updates needed when sites change
- Easy to add new job boards

✅ **Cross-Platform Sync**
- All data stored in backend database
- Access from desktop and mobile
- Real-time push notifications

✅ **Privacy Focused**
- Client-side scraping using your sessions
- No credential storage on servers
- You control your data

✅ **Smart Filtering**
- Exclude/include keywords
- Company filters
- Salary requirements
- Applied server-side

## Architecture

```
┌─────────────┐
│   Desktop   │────┐
│   (Scraper) │    │
└─────────────┘    │
                   │    ┌──────────────┐      ┌──────────────┐
                   ├───>│   Backend    │─────>│  PostgreSQL  │
                   │    │   (Node.js)  │      │              │
┌─────────────┐    │    └──────────────┘      └──────────────┘
│   Mobile    │────┘            │
│   (Viewer)  │                 │
└─────────────┘                 ▼
                         ┌──────────────┐
                         │   Firebase   │
                         │     (FCM)    │
                         └──────────────┘
```

### Data Flow

1. **Desktop scrapes** → Sends raw jobs to backend
2. **Backend processes** → Deduplicates, filters, stores
3. **Backend notifies** → Push notifications to all devices
4. **Clients display** → Fetch formatted data from backend

### Why This Design?

- **Dumb clients**: All logic on backend, easy to update
- **Flexible scraping**: Uses real user sessions, harder to detect
- **No credential storage**: More secure and private
- **Plugin updates**: Change scraping logic without app updates

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- (Optional) Firebase project for push notifications

### 1. Backend Setup

```bash
cd backend
npm install

# Setup database
createdb job_tracker
psql job_tracker < schema.sql

# Configure
cp .env.example .env
# Edit .env with your settings

# Start
npm run dev
```

Backend runs on `http://localhost:3000`

See [backend/README.md](backend/README.md) for details.

### 2. Desktop Setup

```bash
cd desktop
npm install

# Start
npm run dev
```

See [desktop/README.md](desktop/README.md) for details.

### 3. Usage

1. Launch desktop app
2. Register/login
3. Add a job search:
   - Go to LinkedIn
   - Search for jobs (e.g., "software engineer remote")
   - Copy the URL
   - Paste in desktop app under "Searches"
4. Desktop will scrape every 30 minutes
5. Get notified of new jobs!

## Supported Job Boards

Currently supported:
- ✅ LinkedIn (requires login)

Planned:
- 🔄 Indeed
- 🔄 Remote.co
- 🔄 We Work Remotely
- 🔄 AngelList

Adding new boards is easy - just create a plugin!

## Creating Plugins

Plugins are JavaScript modules that define scraping logic.

### 1. Create Plugin Files

```bash
backend/plugins/jobboard-name/
├── manifest.json
└── scraper.js
```

### 2. Define Manifest

```json
{
  "name": "jobboard-name",
  "version": "1.0.0",
  "description": "JobBoard scraper",
  "interval": 30,
  "requiresAuth": false,
  "updated": "2025-10-31T00:00:00Z"
}
```

### 3. Implement Scraper

```javascript
// scraper.js
async function scrape(page, queryUrl) {
  await page.goto(queryUrl);
  
  const jobs = await page.evaluate(() => {
    const jobElements = document.querySelectorAll('.job-card');
    return Array.from(jobElements).map(el => ({
      externalId: el.dataset.jobId,
      title: el.querySelector('.title').innerText,
      company: el.querySelector('.company').innerText,
      location: el.querySelector('.location').innerText,
      url: el.querySelector('a').href,
      postedDate: el.querySelector('.date').innerText
    }));
  });
  
  return jobs;
}

module.exports = { scrape };
```

### 4. Test & Deploy

```bash
# Test locally
cd backend
npm test

# Deploy backend
git push

# Desktop apps auto-download new plugin
```

That's it! No desktop app updates needed.

## Configuration

### Backend Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/job_tracker

# Security
JWT_SECRET=your-random-secret

# Server
PORT=3000
NODE_ENV=production

# Optional: Push notifications
FIREBASE_PROJECT_ID=your-project
FIREBASE_CLIENT_EMAIL=email@firebase.com
FIREBASE_PRIVATE_KEY=your-key
```

### Desktop Configuration

Desktop app uses backend URL from environment:

```bash
# Optional .env file in desktop/
API_URL=http://localhost:3000/api
```

Default: `http://localhost:3000/api`

## Deployment

### Backend Deployment

**Option 1: Docker**

```bash
cd backend
docker build -t job-tracker-backend .
docker run -p 3000:3000 --env-file .env job-tracker-backend
```

**Option 2: Traditional**

Deploy to any Node.js hosting:
- Heroku
- DigitalOcean App Platform
- AWS Elastic Beanstalk
- Google Cloud Run

Just ensure PostgreSQL is accessible.

### Desktop Distribution

Build installers:

```bash
cd desktop

# macOS
npm run build:mac

# Windows  
npm run build:win
```

Distribute the installers from `desktop/dist/`

## Development Roadmap

### Phase 1: MVP (Current)
- ✅ Backend API with PostgreSQL
- ✅ Desktop Electron app
- ✅ LinkedIn plugin
- ✅ Client-side scraping
- ✅ Job status management
- ✅ Basic filtering

### Phase 2: Polish
- ⬜ iOS mobile app
- ⬜ Push notifications (FCM)
- ⬜ More job board plugins (Indeed, Remote.co)
- ⬜ Advanced filters
- ⬜ Job analytics

### Phase 3: Scale
- ⬜ Android app
- ⬜ Browser extension
- ⬜ Team features
- ⬜ API for integrations

## Contributing

Contributions welcome! Areas needing help:

1. **New Job Board Plugins** - Add scrapers for more sites
2. **Mobile Apps** - iOS and Android development
3. **UI/UX** - Improve desktop and mobile interfaces
4. **Testing** - Write tests for backend and plugins
5. **Documentation** - Improve docs and tutorials

### Adding a Plugin

1. Fork the repo
2. Create plugin in `backend/plugins/[board-name]/`
3. Test locally
4. Submit PR with:
   - Plugin code
   - Tests
   - Documentation

## Comparison with first2apply

This project is inspired by [first2apply](https://github.com/beastx-ro/first2apply) but differs in:

| Feature | first2apply | Job Tracker |
|---------|-------------|-------------|
| Architecture | Standalone CLI | Client-server |
| Scraping | Server-side | Client-side |
| Platforms | CLI only | Desktop + Mobile |
| Plugins | Built-in | Downloadable |
| Updates | App updates | Plugin updates only |
| Credentials | Stored | Not stored |
| Sync | No | Yes |

Job Tracker focuses on:
- Better privacy (client-side scraping)
- Easier maintenance (plugin updates)
- Cross-platform sync
- Mobile-friendly

## License

MIT License - see LICENSE file

## Support

- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Email**: support@example.com

## Credits

Inspired by [first2apply](https://github.com/beastx-ro/first2apply)

Built with:
- [Electron](https://www.electronjs.org/)
- [Express](https://expressjs.com/)
- [PostgreSQL](https://www.postgresql.org/)
- [Puppeteer](https://pptr.dev/)
- [Firebase](https://firebase.google.com/)

---

**Note**: This tool is for personal use. Respect job boards' Terms of Service and use responsibly. Heavy scraping may result in rate limiting or account suspension.
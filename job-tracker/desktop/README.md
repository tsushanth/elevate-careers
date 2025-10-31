# Job Tracker Desktop

Electron-based desktop application for tracking job applications.

## Features

- Automated job scraping using embedded Chromium browser
- Plugin-based architecture (plugins auto-update from backend)
- Uses user's logged-in LinkedIn session
- Desktop notifications for new jobs
- Job status management
- Runs on Windows and macOS

## Installation

### Prerequisites

- Node.js 18+
- Backend API running (see backend/README.md)

### Setup

1. Install dependencies:
```bash
npm install
```

2. Configure API endpoint (optional):
```bash
# Create .env file if you want to change the API URL
echo "API_URL=http://localhost:3000/api" > .env
```

Default API URL is `http://localhost:3000/api`

### Running

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

### Building

Build for current platform:
```bash
npm run build
```

Build for macOS:
```bash
npm run build:mac
```

Build for Windows:
```bash
npm run build:win
```

## How It Works

### Architecture

1. **Main Process** (`src/main.js`)
   - Manages Electron app lifecycle
   - Handles IPC communication with renderer
   - Initializes services

2. **Scraper Service** (`src/services/scraper.js`)
   - Manages Chromium browser instances
   - Executes scraping plugins
   - Runs on 30-minute schedule
   - Sends results to backend

3. **Plugin Manager** (`src/services/pluginManager.js`)
   - Downloads plugins from backend
   - Checks for updates automatically
   - Loads and executes plugins

4. **API Service** (`src/services/api.js`)
   - Communicates with backend API
   - Handles authentication
   - Submits scraped jobs

5. **Renderer** (`src/renderer/`)
   - User interface (HTML/CSS/JS)
   - Displays jobs and searches
   - Manages settings

### Scraping Flow

```
1. User logs into desktop app
2. User adds search query (LinkedIn URL)
3. Desktop opens LinkedIn in embedded browser
4. User logs into LinkedIn once (session persists)
5. Every 30 minutes:
   - Check for plugin updates
   - Open LinkedIn with saved search
   - Run plugin scraper
   - Extract job data
   - Send to backend
6. Backend processes, filters, and stores jobs
7. Backend sends notifications to all devices
8. Desktop shows notification for new jobs
```

### Plugin System

Plugins are JavaScript files that define how to scrape each job board.

Desktop automatically downloads latest plugins from backend on startup and before each scrape.

Example plugin structure:
```javascript
// linkedin.js
async function scrape(page, queryUrl) {
  await page.goto(queryUrl);
  const jobs = await page.evaluate(() => {
    // Extract jobs from page
    return [];
  });
  return jobs;
}

module.exports = { scrape };
```

## Usage

### First Time Setup

1. Launch the app
2. Register or login
3. Click "Searches" tab
4. Click "Add Search"
5. Enter your LinkedIn job search URL
6. Save

### LinkedIn Search URL

1. Go to LinkedIn Jobs
2. Use filters to find jobs you want
3. Copy the URL from browser
4. Paste into desktop app

Example: `https://www.linkedin.com/jobs/search/?keywords=software%20engineer&location=Remote`

### Job Management

- **New**: Job just discovered
- **Seen**: You've viewed it
- **Applied**: You've applied
- **Rejected**: You're not interested

Change status by selecting from dropdown next to each job.

### Running Scraper Manually

Go to Settings tab and click "Run Now" to scrape immediately instead of waiting for scheduled run.

## Data Storage

- User data: Stored in system's app data directory
- Browser sessions: Persisted in `browser-data` folder
- Plugins: Cached in `plugins` folder
- Settings: Stored in `electron-store`

Locations:
- **macOS**: `~/Library/Application Support/job-tracker-desktop`
- **Windows**: `%APPDATA%\job-tracker-desktop`
- **Linux**: `~/.config/job-tracker-desktop`

## Troubleshooting

### Scraper not running

- Check Settings tab for scraper status
- Ensure you're logged into LinkedIn in the embedded browser
- Check backend API is running and accessible

### LinkedIn login required

When scraper opens LinkedIn, you may need to log in the first time. The session will be saved for future scrapes.

### Plugin errors

Plugins auto-update from backend. If you get errors:
1. Check backend is running
2. Go to Settings and click "Run Now" to trigger update check
3. Restart the app

### No jobs appearing

- Verify your search URL is correct
- Check the search is marked as Active in Searches tab
- Manually run scraper from Settings to test
- Check backend logs for errors

## Development

### Project Structure

```
desktop/
├── src/
│   ├── main.js              # Electron main process
│   ├── services/
│   │   ├── api.js           # Backend API client
│   │   ├── pluginManager.js # Plugin management
│   │   └── scraper.js       # Scraping logic
│   └── renderer/
│       ├── index.html       # UI markup
│       ├── styles.css       # UI styles
│       └── app.js           # UI logic
└── package.json
```

### Adding Features

1. Backend changes: Update backend API first
2. API service: Add method in `src/services/api.js`
3. IPC handler: Add handler in `src/main.js`
4. UI: Update `src/renderer/` files

## License

MIT
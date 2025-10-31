# Job Tracker - Quick Start Guide

## Prerequisites

Before you begin, ensure you have:
- Node.js 18 or higher
- PostgreSQL 14 or higher
- A code editor (VS Code, etc.)

## Step 1: Setup Backend

```bash
# Navigate to backend directory
cd job-tracker/backend

# Install dependencies
npm install

# Create PostgreSQL database
createdb job_tracker

# Run database migrations
psql job_tracker < schema.sql

# Configure environment
cp .env.example .env

# Edit .env file with your settings:
# - DATABASE_URL: Your PostgreSQL connection string
# - JWT_SECRET: A random secret key (generate with: openssl rand -hex 32)
# - PORT: 3000 (or your preferred port)

# Start the backend server
npm run dev

# You should see: "Server running on port 3000"
```

Backend is now running at `http://localhost:3000`

## Step 2: Test Backend

Open a new terminal and test the API:

```bash
# Health check
curl http://localhost:3000/health

# Should return: {"status":"ok","timestamp":"..."}
```

## Step 3: Setup Desktop App

```bash
# Open a new terminal
cd job-tracker/desktop

# Install dependencies
npm install

# Start the desktop app
npm run dev
```

The desktop app window should open!

## Step 4: Create an Account

1. In the desktop app, click "Register"
2. Enter an email and password (min 8 characters)
3. Click "Register"

You're now logged in!

## Step 5: Add Your First Job Search

1. Open LinkedIn in your regular browser
2. Go to LinkedIn Jobs: https://www.linkedin.com/jobs/
3. Use filters to search for jobs:
   - Keywords: "software engineer"
   - Location: "Remote"
   - Or whatever you're looking for
4. Copy the URL from your browser address bar
   - It will look like: `https://www.linkedin.com/jobs/search/?keywords=software%20engineer&location=Remote`

5. In the Job Tracker desktop app:
   - Click "Searches" tab
   - Click "Add Search"
   - Board: LinkedIn (default)
   - Paste the URL
   - Interval: 30 minutes (default)
   - Click "Save"

## Step 6: Run Your First Scrape

1. Click "Settings" tab
2. Click "Run Now"
3. A browser window will open showing LinkedIn
4. **Important**: Log into LinkedIn in this window (only needed once!)
5. The scraper will run and extract jobs
6. Go back to "Jobs" tab to see results

## Step 7: Automated Scraping

Now that you're set up:
- Desktop app will automatically scrape every 30 minutes
- You'll get desktop notifications when new jobs are found
- Jobs sync across all your devices

## Managing Jobs

In the "Jobs" tab:
- Click job title to open in browser
- Change status using dropdown:
  - **New**: Just discovered
  - **Seen**: You've viewed it
  - **Applied**: You've applied
  - **Rejected**: Not interested

## Adding More Searches

You can add multiple searches:
1. Different job boards (when available)
2. Different search queries on same board
3. Different locations or keywords

Each search runs independently on its schedule.

## Troubleshooting

### Backend won't start

**Error: Database connection failed**
- Check PostgreSQL is running: `pg_isready`
- Verify DATABASE_URL in .env is correct
- Ensure database exists: `psql -l | grep job_tracker`

**Error: Port 3000 already in use**
- Change PORT in .env to different number (e.g., 3001)
- Update desktop/.env API_URL if needed

### Desktop app issues

**Can't connect to backend**
- Ensure backend is running
- Check API_URL (default: http://localhost:3000/api)
- Look for errors in terminal running backend

**Scraper not finding jobs**
- Make sure you're logged into LinkedIn in the embedded browser
- Check your search URL is valid
- Try visiting the URL in regular browser first

**LinkedIn asking for verification**
- This is normal for automated access
- Complete the verification in the embedded browser
- Session will be saved for future scrapes

### No new jobs appearing

- Wait for scheduled scrape (check Settings tab for "Next Run")
- Or click "Run Now" in Settings
- Verify search is marked as "Active" in Searches tab
- Check backend terminal for error messages

## Next Steps

### Enable Push Notifications (Optional)

1. Create a Firebase project
2. Get Firebase credentials
3. Add to backend/.env:
   ```
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_CLIENT_EMAIL=your-email
   FIREBASE_PRIVATE_KEY=your-private-key
   ```
4. Restart backend

### Add More Job Boards

As new plugins are added to backend, they'll automatically download to your desktop app. No updates needed!

### Deploy to Production

When ready to deploy:

**Backend:**
- Deploy to Heroku, DigitalOcean, AWS, etc.
- Use production PostgreSQL database
- Set NODE_ENV=production

**Desktop:**
```bash
cd desktop
npm run build
# Distribute the installer from dist/
```

## Tips

- Keep desktop app running for automatic scraping
- Log into job boards once in embedded browser
- Add specific searches (narrow > broad)
- Check Settings tab to monitor scraper status
- Use filters to reduce noise

## Getting Help

- Check the full README.md for detailed documentation
- Review backend/README.md and desktop/README.md
- Check GitHub Issues
- Review backend logs for errors

---

Enjoy tracking your job applications! 🎯
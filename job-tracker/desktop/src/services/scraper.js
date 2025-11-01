const puppeteer = require('puppeteer-core');
const path = require('path');
const { app } = require('electron');

class ScraperService {
  constructor(pluginManager, apiService, store) {
    this.pluginManager = pluginManager;
    this.apiService = apiService;
    this.store = store;
    this.isRunning = false;
    this.browser = null;
    this.pages = new Map(); // board -> page
    this.lastRun = null;
    this.nextRun = null;
    this.intervalId = null;
  }

  async initialize() {
    try {
      // Initialize plugin manager
      await this.pluginManager.initialize();
      
      // Check for plugin updates
      await this.pluginManager.checkForUpdates();
      
      console.log('Scraper service initialized');
    } catch (error) {
      console.error('Scraper initialization error:', error);
      throw error;
    }
  }

  async start() {
    if (this.isRunning) {
      console.log('Scraper already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting scraper service');

    // Run immediately on start
    await this.scrapeAll();

    // Schedule periodic scraping (every 30 minutes)
    this.scheduleNext();
  }

  scheduleNext() {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
    }

    const interval = 30 * 60 * 1000; // 30 minutes
    this.nextRun = new Date(Date.now() + interval);

    this.intervalId = setTimeout(async () => {
      if (this.isRunning) {
        await this.scrapeAll();
        this.scheduleNext();
      }
    }, interval);

    console.log(`Next scrape scheduled for: ${this.nextRun.toLocaleString()}`);
  }

  async stop() {
    this.isRunning = false;
    
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }

    await this.closeBrowser();
    console.log('Scraper service stopped');
  }

  async restart() {
    await this.stop();
    await this.start();
  }

  async scrapeAll() {
    try {
      console.log('=== SCRAPE ALL STARTED ===');
      console.log('Time:', new Date().toISOString());
      this.lastRun = new Date();

      // Check for plugin updates before scraping
      console.log('Checking for plugin updates...');
      await this.pluginManager.checkForUpdates();

      // Get user's searches
      console.log('Fetching user searches from API...');
      const searchesResponse = await this.apiService.getSearches();
      
      if (!searchesResponse.success || !searchesResponse.searches) {
        console.error('Failed to get searches:', searchesResponse);
        return;
      }

      const searches = searchesResponse.searches.filter(s => s.active);
      console.log(`Found ${searches.length} active searches (${searchesResponse.searches.length} total)`);
      
      if (searches.length === 0) {
        console.log('No active searches configured');
        return;
      }

      for (const search of searches) {
        console.log(`\n--- Processing search ${search.id} ---`);
        console.log('Board:', search.board);
        console.log('URL:', search.queryUrl);
        
        try {
          await this.scrapeSearch(search);
          console.log(`✓ Completed search ${search.id}`);
        } catch (error) {
          console.error(`✗ Error scraping search ${search.id}:`, error.message);
          console.error('Stack:', error.stack);
        }
      }

      console.log('\n=== SCRAPE CYCLE COMPLETED ===');
    } catch (error) {
      console.error('=== SCRAPE ALL ERROR ===');
      console.error('Error:', error.message);
      console.error('Stack:', error.stack);
    }
  }

  async scrapeSearch(search) {
    const plugin = this.pluginManager.getPlugin(search.board);
    
    if (!plugin) {
      console.error(`Plugin not found for board: ${search.board}`);
      return;
    }

    console.log(`Scraping: ${search.board} - ${search.queryUrl}`);

    try {
      const page = await this.getPage(search.board);
      
      // Longer delay to ensure page is fully initialized
      console.log('Waiting for page to be fully ready...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      console.log('Page ready, running plugin scraper...');
      
      // Run plugin's scrape function
      const jobs = await plugin.scrape(page, search.queryUrl);
      
      console.log(`Found ${jobs.length} jobs for search ${search.id}`);

      // Send to backend
      if (jobs.length > 0) {
        console.log('Sending jobs to backend...');
        const response = await this.apiService.submitJobBatch({
          searchId: search.id,
          board: search.board,
          jobs: jobs,
          scrapedAt: new Date().toISOString()
        });

        if (response.success && response.new > 0) {
          console.log(`${response.new} new jobs added`);
          
          // Show desktop notification
          const { Notification } = require('electron');
          if (Notification.isSupported()) {
            new Notification({
              title: 'New Jobs Found!',
              body: `Found ${response.new} new job${response.new > 1 ? 's' : ''} on ${search.board}`,
              silent: false
            }).show();
          }
        } else {
          console.log('No new jobs found (all already exist)');
        }
      } else {
        console.log('No jobs found in this scrape');
      }
      
      // Keep page open for next scrape
      console.log('Scrape complete, keeping browser open');
      
    } catch (error) {
      console.error(`Scraping error for ${search.board}:`, error);
      console.error('Error stack:', error.stack);
    }
  }

  async getPage(board) {
    console.log(`Getting page for board: ${board}`);
    
    // Check if we have a valid existing page
    if (this.pages.has(board)) {
      const existingPage = this.pages.get(board);
      try {
        // Test if page is still valid
        await existingPage.title();
        console.log('Reusing existing valid page');
        return existingPage;
      } catch (error) {
        console.log('Existing page invalid, creating new one');
        this.pages.delete(board);
      }
    }

    console.log('Creating new page...');
    
    // Initialize browser if needed
    if (!this.browser) {
      console.log('Browser not initialized, initializing now...');
      await this.initBrowser();
    }

    // Create new page
    console.log('Creating new browser page...');
    const page = await this.browser.newPage();
    
    // Set user agent
    const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    console.log('Setting user agent...');
    await page.setUserAgent(userAgent);
    
    // Set viewport
    console.log('Setting viewport...');
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Wait for page to be fully ready
    console.log('Waiting for page to initialize...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Verify page is ready
    try {
      await page.title();
      console.log('Page verified ready');
    } catch (error) {
      console.error('Page verification failed:', error);
      throw new Error('Page not ready');
    }
    
    // Store for reuse
    this.pages.set(board, page);
    
    console.log('Page ready!');
    return page;
  }

  async initBrowser() {
    if (this.browser) {
      console.log('Browser already initialized');
      return;
    }
    
    const userDataDir = path.join(app.getPath('userData'), 'browser-data');
    
    // Detect Chrome/Chromium installation
    let executablePath;
    
    if (process.platform === 'darwin') {
      // macOS
      const possiblePaths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
      ];
      executablePath = possiblePaths.find(p => {
        try {
          require('fs').accessSync(p);
          return true;
        } catch {
          return false;
        }
      });
    } else if (process.platform === 'win32') {
      // Windows
      const possiblePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
      ];
      executablePath = possiblePaths.find(p => {
        try {
          require('fs').accessSync(p);
          return true;
        } catch {
          return false;
        }
      });
    } else {
      // Linux
      executablePath = 'google-chrome';
    }
    
    console.log('Using Chrome at:', executablePath);
    
    try {
      this.browser = await puppeteer.launch({
        headless: false,
        executablePath: executablePath,
        userDataDir: userDataDir,
        defaultViewport: null,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--start-maximized'
        ]
      });

      // Handle browser disconnect
      this.browser.on('disconnected', () => {
        console.log('Browser disconnected');
        this.browser = null;
        this.pages.clear();
      });

      console.log('Browser initialized successfully');
    } catch (error) {
      console.error('Failed to initialize browser:', error);
      throw error;
    }
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.pages.clear();
      console.log('Browser closed');
    }
  }
}

module.exports = ScraperService;
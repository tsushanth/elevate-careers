// Configuration for the desktop app
// Update this file with your backend URL

module.exports = {
    // Backend API URL
    API_URL: process.env.API_URL || 'https://job-tracker-api-3t2vweivqa-uc.a.run.app/api',
    
    // Development mode
    isDevelopment: process.env.NODE_ENV !== 'production',
    
    // Scraper settings
    DEFAULT_SCRAPE_INTERVAL: 30, // minutes
    
    // Browser settings
    BROWSER_HEADLESS: false, // Show browser for LinkedIn login
  };
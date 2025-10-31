// LinkedIn job scraper plugin
// This code will be downloaded and executed by desktop clients

async function scrape(page, queryUrl) {
    try {
      console.log('Navigating to:', queryUrl);
      
      // Navigate to the search URL
      await page.goto(queryUrl, { 
        waitUntil: 'networkidle2',
        timeout: 30000 
      });
  
      // Wait for job results to load
      await page.waitForSelector('.jobs-search__results-list, .jobs-search-no-results-banner', {
        timeout: 15000
      });
  
      // Check if there are no results
      const noResults = await page.$('.jobs-search-no-results-banner');
      if (noResults) {
        console.log('No job results found');
        return [];
      }
  
      // Extract job listings
      const jobs = await page.evaluate(() => {
        const jobCards = document.querySelectorAll('.job-card-container, .jobs-search-results__list-item');
        const results = [];
  
        jobCards.forEach(card => {
          try {
            // Try different selectors based on LinkedIn's varying layouts
            const linkElement = card.querySelector('a.job-card-list__title, a.job-card-container__link');
            const titleElement = card.querySelector('.job-card-list__title, .job-card-container__link');
            const companyElement = card.querySelector('.job-card-container__company-name, .artdeco-entity-lockup__subtitle');
            const locationElement = card.querySelector('.job-card-container__metadata-item, .artdeco-entity-lockup__caption');
            const timeElement = card.querySelector('.job-card-container__listed-time, time');
            
            // Get job ID from data attribute or URL
            let jobId = card.dataset.jobId || card.dataset.entityUrn;
            
            if (!jobId && linkElement) {
              const href = linkElement.href;
              const match = href.match(/\/jobs\/view\/(\d+)/);
              if (match) {
                jobId = match[1];
              }
            }
  
            if (!jobId || !titleElement) {
              return; // Skip if we can't get essential data
            }
  
            const url = linkElement ? linkElement.href : '';
            const title = titleElement ? titleElement.innerText.trim() : '';
            const company = companyElement ? companyElement.innerText.trim() : '';
            const location = locationElement ? locationElement.innerText.trim() : '';
            const postedDate = timeElement ? timeElement.innerText.trim() : '';
  
            if (title && url) {
              results.push({
                externalId: jobId,
                title,
                company,
                location,
                url,
                postedDate
              });
            }
          } catch (error) {
            console.error('Error extracting job card:', error);
          }
        });
  
        return results;
      });
  
      console.log(`Scraped ${jobs.length} jobs from LinkedIn`);
      return jobs;
  
    } catch (error) {
      console.error('LinkedIn scraper error:', error);
      throw new Error(`Failed to scrape LinkedIn: ${error.message}`);
    }
  }
  
  // Export for CommonJS (Node.js require)
  module.exports = { scrape };
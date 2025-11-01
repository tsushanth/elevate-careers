async function scrape(page, queryUrl) {
    try {
      console.log('LinkedIn: Navigating to:', queryUrl);
      
      await page.goto(queryUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      console.log('LinkedIn: Page loaded, checking content...');
      
      // Check if login is required
      const loginForm = await page.$('form.login__form, #session_key');
      if (loginForm) {
        console.log('⚠️  LOGIN REQUIRED! Please log in to LinkedIn in the browser window.');
        return [];
      }
      
      console.log('LinkedIn: Looking for job listings...');
      
      const selectors = [
        '.jobs-search__results-list',
        'ul[class*="jobs-search"]',
        '[data-job-id]',
        '.scaffold-layout__list'
      ];
      
      let found = false;
      for (const sel of selectors) {
        try {
          await page.waitForSelector(sel, { timeout: 5000 });
          found = true;
          console.log('LinkedIn: Found content with:', sel);
          break;
        } catch (e) {}
      }
      
      if (!found) {
        const title = await page.title();
        console.log('LinkedIn: No jobs found. Title:', title);
        return [];
      }
  
      // Debug: Check what's actually on the page
      const debugInfo = await page.evaluate(() => {
        const allJobElements = document.querySelectorAll('[data-job-id], .job-card-container, .jobs-search-results__list-item, li[class*="job"]');
        return {
          totalElements: allJobElements.length,
          dataJobIdCount: document.querySelectorAll('[data-job-id]').length,
          jobCardContainers: document.querySelectorAll('.job-card-container').length,
          searchResultsItems: document.querySelectorAll('.jobs-search-results__list-item').length,
          liElements: document.querySelectorAll('li[class*="job"]').length,
          sampleClasses: Array.from(allJobElements).slice(0, 3).map(el => el.className)
        };
      });
      
      console.log('LinkedIn Debug Info:', JSON.stringify(debugInfo, null, 2));
  
      const jobs = await page.evaluate(() => {
        // Try even more selectors
        const possibleSelectors = [
          '[data-job-id]',
          '.job-card-container',
          '.jobs-search-results__list-item',
          'li[data-occludable-job-id]',
          'div[data-job-id]',
          'li[class*="jobs-search-results__list-item"]'
        ];
        
        let cards = [];
        for (const selector of possibleSelectors) {
          cards = document.querySelectorAll(selector);
          if (cards.length > 0) {
            console.log(`Found ${cards.length} jobs with: ${selector}`);
            break;
          }
        }
        
        console.log('Total cards found:', cards.length);
        const results = [];
  
        cards.forEach((card, index) => {
          try {
            let jobId = card.getAttribute('data-job-id') || card.getAttribute('data-occludable-job-id');
            
            // Try multiple link selectors
            const link = card.querySelector('a[href*="/jobs/view"], a[href*="/jobs/collections"], a.job-card-list__title');
            
            if (!jobId && link) {
              const match = link.href.match(/\/jobs\/(?:view|collections)\/(\d+)/);
              if (match) jobId = match[1];
            }
  
            // Try multiple title selectors
            const titleEl = 
              card.querySelector('.job-card-list__title') ||
              card.querySelector('h3') ||
              card.querySelector('[class*="job-title"]') ||
              card.querySelector('a[href*="/jobs/view"]') ||
              link;
  
            const companyEl = 
              card.querySelector('.job-card-container__primary-description') ||
              card.querySelector('[class*="company"]') ||
              card.querySelector('[class*="subtitle"]');
  
            const locationEl = 
              card.querySelector('.job-card-container__metadata-item') ||
              card.querySelector('[class*="location"]') ||
              card.querySelector('[class*="caption"]');
  
            if (index < 3) {
              console.log(`Card ${index}:`, {
                hasJobId: !!jobId,
                hasTitle: !!titleEl,
                hasLink: !!link,
                titleText: titleEl?.textContent?.trim().substring(0, 50)
              });
            }
  
            if (!jobId || !titleEl) {
              console.log(`Skipping card ${index}: jobId=${!!jobId}, titleEl=${!!titleEl}`);
              return;
            }
  
            const title = titleEl.textContent?.trim() || titleEl.innerText?.trim() || '';
            const company = companyEl?.textContent?.trim() || companyEl?.innerText?.trim() || '';
            const location = locationEl?.textContent?.trim() || locationEl?.innerText?.trim() || '';
            const url = link?.href || card.querySelector('a')?.href || '';
  
            if (title && url) {
              results.push({ 
                externalId: jobId, 
                title: title.substring(0, 200), // Limit length
                company: company.substring(0, 100), 
                location: location.substring(0, 100), 
                url, 
                postedDate: '' 
              });
            } else {
              console.log(`Skipping card ${index}: missing title or url`);
            }
          } catch (e) {
            console.error(`Error processing card ${index}:`, e.message);
          }
        });
  
        return results;
      });
  
      console.log(`LinkedIn: Scraped ${jobs.length} jobs`);
      if (jobs.length > 0) {
        console.log('First job:', jobs[0]);
      }
      return jobs;
  
    } catch (error) {
      console.error('LinkedIn error:', error.message);
      throw new Error(`Failed: ${error.message}`);
    }
  }
  
  module.exports = { scrape };
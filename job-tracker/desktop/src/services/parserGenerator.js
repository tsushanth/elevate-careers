const Anthropic = require('@anthropic-ai/sdk');

class ParserGenerator {
  constructor(apiKey) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY
    });
    this.maxRetries = 3;
  }

  /**
   * Generate a parser for a new job board URL
   * @param {Object} page - Puppeteer page object
   * @param {string} url - The job board URL
   * @param {string} boardName - Name identifier for the board
   * @returns {Object} Generated parser function and metadata
   */
  async generateParser(page, url, boardName) {
    console.log(`\n=== GENERATING PARSER FOR ${boardName} ===`);
    console.log(`URL: ${url}`);

    // Extract page structure
    const pageData = await this.extractPageStructure(page, url);

    // Generate initial parser using Claude
    let parserCode = await this.requestParserFromLLM(pageData, boardName, url);
    
    // Test and refine parser iteratively
    const refinedParser = await this.testAndRefineParser(page, url, parserCode, pageData, boardName);

    return {
      boardName,
      url,
      parserCode: refinedParser,
      version: '1.0.0',
      generated: new Date().toISOString()
    };
  }

  /**
   * Extract page structure and content for LLM analysis
   */
  async extractPageStructure(page, url) {
    try {
      console.log('Extracting page structure...');
      
      // Navigate to the page
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      
      // Wait for dynamic content
      await page.waitForTimeout(5000);

      // Extract HTML structure and visible text
      const pageData = await page.evaluate(() => {
        // Helper to get visible text
        function getVisibleText(element) {
          const style = window.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return '';
          }
          return element.innerText || element.textContent || '';
        }

        // Find potential job containers
        const allElements = Array.from(document.querySelectorAll('*'));
        const jobContainers = [];
        
        // Look for repeating patterns (job cards, list items)
        const potentialSelectors = [
          'article',
          '[class*="job"]',
          '[class*="card"]',
          '[class*="result"]',
          '[class*="listing"]',
          '[data-job-id]',
          '[data-entity-urn]',
          'li[class*="job"]',
          'div[class*="job"]'
        ];

        potentialSelectors.forEach(selector => {
          const elements = Array.from(document.querySelectorAll(selector));
          if (elements.length >= 2) { // At least 2 similar elements
            jobContainers.push({
              selector: selector,
              count: elements.length,
              sample: elements.slice(0, 3).map(el => ({
                html: el.outerHTML.substring(0, 2000), // First 2000 chars
                text: getVisibleText(el).substring(0, 500),
                classes: Array.from(el.classList),
                attributes: Array.from(el.attributes).map(attr => ({
                  name: attr.name,
                  value: attr.value
                }))
              }))
            });
          }
        });

        // Get page title and meta info
        const pageTitle = document.title;
        const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
        
        // Get URL structure
        const urlObj = new URL(window.location.href);

        return {
          pageTitle,
          metaDescription,
          url: window.location.href,
          urlParams: Object.fromEntries(urlObj.searchParams),
          jobContainers: jobContainers.sort((a, b) => b.count - a.count).slice(0, 5), // Top 5 candidates
          bodyStructure: {
            classes: Array.from(document.body.classList),
            childCount: document.body.children.length
          }
        };
      });

      console.log(`Found ${pageData.jobContainers.length} potential job container patterns`);
      pageData.jobContainers.forEach((container, i) => {
        console.log(`  ${i + 1}. ${container.selector}: ${container.count} items`);
      });

      return pageData;
    } catch (error) {
      console.error('Error extracting page structure:', error);
      throw error;
    }
  }

  /**
   * Request parser code from Claude
   */
  async requestParserFromLLM(pageData, boardName, url) {
    console.log('Requesting parser from Claude...');

    const prompt = `You are a web scraping expert. I need you to generate a JavaScript scraper function for a job board.

**Job Board Information:**
- Name: ${boardName}
- URL: ${url}
- Page Title: ${pageData.pageTitle}
- Description: ${pageData.metaDescription}

**Page Structure Analysis:**
I've found these potential job listing containers on the page:
${pageData.jobContainers.map((container, i) => `
${i + 1}. Selector: ${container.selector}
   Count: ${container.count} elements
   Sample HTML snippet:
   ${container.sample[0]?.html.substring(0, 500)}
   
   Sample visible text:
   ${container.sample[0]?.text.substring(0, 200)}
   
   Classes: ${container.sample[0]?.classes.join(', ')}
`).join('\n')}

**Requirements:**
Generate a complete scraper module that:
1. Exports a scrape function: \`async function scrape(page, url)\`
2. The function takes a Puppeteer page object and search URL
3. Navigates to the URL if needed (page.goto)
4. Waits for job listings to load
5. Extracts job data from each listing
6. Returns an array of job objects with this structure:
   {
     externalId: string (unique identifier from the site),
     title: string (job title),
     company: string (company name, or null),
     location: string (location, or null),
     url: string (link to full job posting),
     postedDate: string (when posted, or null)
   }

**Important:**
- Use \`await page.waitForSelector()\` to ensure elements are loaded
- Use \`page.evaluate()\` to extract data from the DOM
- Handle pagination if multiple pages exist, or just get the first page
- Be robust - handle missing elements gracefully
- Make sure externalId is unique for each job
- Add console.log statements for debugging

Generate ONLY the JavaScript code as a CommonJS module, no explanations. Start with:
\`\`\`javascript`;

    try {
      const message = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const response = message.content[0].text;
      
      // Extract code from markdown code blocks if present
      let code = response;
      const codeBlockMatch = response.match(/```(?:javascript)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        code = codeBlockMatch[1];
      }

      console.log('Received parser code from Claude');
      console.log('Parser preview:', code.substring(0, 300) + '...');

      return code.trim();
    } catch (error) {
      console.error('Error requesting parser from LLM:', error);
      throw error;
    }
  }

  /**
   * Test parser and refine if needed
   */
  async testAndRefineParser(page, url, parserCode, pageData, boardName) {
    console.log('\n=== TESTING GENERATED PARSER ===');

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      console.log(`\nAttempt ${attempt}/${this.maxRetries}`);

      try {
        // Save parser to temporary file
        const fs = require('fs').promises;
        const path = require('path');
        const tempParserPath = path.join(require('os').tmpdir(), `parser-${boardName}-${Date.now()}.js`);
        
        await fs.writeFile(tempParserPath, parserCode, 'utf-8');
        console.log(`Saved temp parser to: ${tempParserPath}`);

        // Load and test the parser
        delete require.cache[require.resolve(tempParserPath)];
        const parser = require(tempParserPath);

        if (typeof parser.scrape !== 'function') {
          throw new Error('Parser does not export a scrape function');
        }

        // Test the parser
        console.log('Running parser test...');
        const jobs = await parser.scrape(page, url);

        console.log(`Parser returned ${jobs ? jobs.length : 0} jobs`);

        // Validate results
        if (!Array.isArray(jobs)) {
          throw new Error('Parser did not return an array');
        }

        if (jobs.length === 0) {
          throw new Error('Parser returned 0 jobs');
        }

        // Check job structure
        const sampleJob = jobs[0];
        const requiredFields = ['externalId', 'title', 'url'];
        const missingFields = requiredFields.filter(field => !sampleJob[field]);

        if (missingFields.length > 0) {
          throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
        }

        // Success!
        console.log('✓ Parser test successful!');
        console.log('Sample job:', JSON.stringify(sampleJob, null, 2));

        // Clean up temp file
        await fs.unlink(tempParserPath);

        return parserCode;

      } catch (error) {
        console.error(`✗ Test failed: ${error.message}`);

        if (attempt < this.maxRetries) {
          console.log('Requesting refinement from Claude...');
          parserCode = await this.refineParserWithLLM(parserCode, error.message, pageData, boardName, url);
        } else {
          console.error('Max retries reached. Parser generation failed.');
          throw new Error(`Failed to generate working parser after ${this.maxRetries} attempts: ${error.message}`);
        }
      }
    }

    return parserCode;
  }

  /**
   * Ask Claude to fix the parser based on error
   */
  async refineParserWithLLM(originalCode, errorMessage, pageData, boardName, url) {
    console.log('Asking Claude to fix the parser...');

    const prompt = `The parser you generated has an error. Please fix it.

**Original Parser Code:**
\`\`\`javascript
${originalCode}
\`\`\`

**Error:**
${errorMessage}

**Page Data (for reference):**
- Board: ${boardName}
- URL: ${url}
- Page Title: ${pageData.pageTitle}
- Available containers: ${pageData.jobContainers.map(c => `${c.selector} (${c.count} items)`).join(', ')}

Please generate a corrected version of the scraper. Make sure to:
1. Fix the specific error mentioned
2. Add more robust error handling
3. Add debugging console.log statements
4. Ensure all required fields (externalId, title, url) are extracted
5. Handle cases where elements might not exist

Generate ONLY the corrected JavaScript code, no explanations:`;

    try {
      const message = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const response = message.content[0].text;
      
      // Extract code
      let code = response;
      const codeBlockMatch = response.match(/```(?:javascript)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        code = codeBlockMatch[1];
      }

      console.log('Received refined parser from Claude');
      return code.trim();
    } catch (error) {
      console.error('Error refining parser:', error);
      throw error;
    }
  }

  /**
   * Save parser to plugin directory
   */
  async saveParser(parserInfo, pluginDirectory) {
    const fs = require('fs').promises;
    const path = require('path');

    const pluginDir = path.join(pluginDirectory, parserInfo.boardName);
    
    // Create directory
    await fs.mkdir(pluginDir, { recursive: true });

    // Save scraper code
    const scraperPath = path.join(pluginDir, 'scraper.js');
    await fs.writeFile(scraperPath, parserInfo.parserCode, 'utf-8');

    // Save manifest
    const manifest = {
      name: parserInfo.boardName,
      version: parserInfo.version,
      interval: 30,
      requiresAuth: false,
      updated: parserInfo.generated,
      url: parserInfo.url,
      generatedByAI: true
    };

    const manifestPath = path.join(pluginDir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    console.log(`✓ Parser saved to: ${pluginDir}`);
    console.log(`  - scraper.js`);
    console.log(`  - manifest.json`);

    return pluginDir;
  }
}

module.exports = ParserGenerator;
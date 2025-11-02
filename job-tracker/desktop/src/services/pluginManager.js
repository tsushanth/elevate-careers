const fs = require('fs').promises;
const path = require('path');
const ParserGenerator = require('./parserGenerator'); // NEW: Import parser generator

class PluginManager {
  constructor(userDataPath, apiService) {
    this.pluginDir = path.join(userDataPath, 'plugins');
    this.apiService = apiService;
    this.plugins = new Map();
    // NEW: Initialize parser generator for self-healing
    this.parserGenerator = new ParserGenerator(process.env.ANTHROPIC_API_KEY);
  }

  async initialize() {
    // Ensure plugins directory exists
    try {
      const fs = require('fs');
      if (!fs.existsSync(this.pluginDir)) {
        console.log(`Creating plugins directory: ${this.pluginDir}`);
        fs.mkdirSync(this.pluginDir, { recursive: true });
      }
      console.log(`Plugin directory ready: ${this.pluginDir}`);
    } catch (error) {
      console.error('Failed to create plugins directory:', error);
    }
  }

  async checkForUpdates() {
    try {
      const manifest = await this.apiService.getPluginManifest();
      
      if (!manifest.success) {
        console.error('Failed to get plugin manifest');
        return;
      }

      for (const [name, info] of Object.entries(manifest.plugins)) {
        const localPlugin = await this.getLocalPluginInfo(name);
        
        if (!localPlugin || localPlugin.version !== info.version) {
          console.log(`Updating plugin ${name}: ${localPlugin?.version || 'none'} → ${info.version}`);
          await this.downloadPlugin(name);
        }
      }
    } catch (error) {
      console.error('Error checking for plugin updates:', error);
    }
  }

  async downloadPlugin(pluginName) {
    try {
      console.log(`Downloading plugin: ${pluginName}`);
      
      // Ensure plugins directory exists
      const fs = require('fs');
      if (!fs.existsSync(this.pluginDir)) {
        console.log(`Creating plugins directory: ${this.pluginDir}`);
        fs.mkdirSync(this.pluginDir, { recursive: true });
      }
      
      const pluginCode = await this.apiService.downloadPlugin(pluginName);
      const pluginPath = path.join(this.pluginDir, `${pluginName}.js`);
      
      await fs.promises.writeFile(pluginPath, pluginCode, 'utf-8');
      console.log(`Downloaded plugin: ${pluginName} to ${pluginPath}`);
      
      // Load the plugin
      await this.loadPlugin(pluginName);
    } catch (error) {
      console.error(`Failed to download plugin ${pluginName}:`, error);
      throw error;
    }
  }

  async loadPlugin(pluginName) {
    try {
      const pluginPath = path.join(this.pluginDir, `${pluginName}.js`);
      
      // Clear require cache
      delete require.cache[require.resolve(pluginPath)];
      
      // Load plugin
      const plugin = require(pluginPath);
      this.plugins.set(pluginName, plugin);
      
      console.log(`Loaded plugin: ${pluginName}`);
    } catch (error) {
      console.error(`Failed to load plugin ${pluginName}:`, error);
      throw error;
    }
  }

  /**
   * NEW: Generate a parser for an unknown board using LLM
   * This is the self-healing mechanism
   */
  async generateParserForUnknownBoard(page, url, boardName) {
    console.log(`\n╔════════════════════════════════════════╗`);
    console.log(`║  SELF-HEALING PARSER GENERATION       ║`);
    console.log(`╚════════════════════════════════════════╝`);
    console.log(`Board: ${boardName}`);
    console.log(`URL: ${url}`);
    
    try {
      // Use LLM to generate parser
      const parserInfo = await this.parserGenerator.generateParser(page, url, boardName);
      
      // Save the generated parser
      const pluginDir = await this.parserGenerator.saveParser(parserInfo, this.pluginDir);
      
      // Load the newly generated plugin
      const scraperPath = path.join(pluginDir, 'scraper.js');
      delete require.cache[require.resolve(scraperPath)];
      const plugin = require(scraperPath);
      this.plugins.set(boardName, plugin);
      
      console.log(`✓ Self-healing parser generated and loaded successfully!`);
      console.log(`  Plugin: ${boardName}`);
      console.log(`  Location: ${pluginDir}`);
      
      return plugin;
    } catch (error) {
      console.error(`✗ Failed to generate self-healing parser:`, error);
      throw error;
    }
  }

  /**
   * NEW: Get or create plugin - tries to load existing, generates if not found
   */
  async getOrCreatePlugin(boardName, url, page) {
    // Try to get existing plugin
    if (this.plugins.has(boardName)) {
      return this.plugins.get(boardName);
    }

    // Try to load from disk
    try {
      await this.loadPlugin(boardName);
      return this.plugins.get(boardName);
    } catch (error) {
      console.log(`Plugin ${boardName} not found locally, will generate...`);
    }

    // Generate new parser using self-healing
    console.log(`🔧 Initiating self-healing parser generation for ${boardName}...`);
    return await this.generateParserForUnknownBoard(page, url, boardName);
  }

  async getLocalPluginInfo(pluginName) {
    try {
      const pluginPath = path.join(this.pluginDir, `${pluginName}.js`);
      const stats = await fs.stat(pluginPath);
      
      // Try to extract version from plugin code
      const code = await fs.readFile(pluginPath, 'utf-8');
      const versionMatch = code.match(/version:\s*['"]([^'"]+)['"]/);
      
      return {
        exists: true,
        version: versionMatch ? versionMatch[1] : 'unknown',
        lastModified: stats.mtime
      };
    } catch (error) {
      return null;
    }
  }

  getPlugin(pluginName) {
    return this.plugins.get(pluginName);
  }

  hasPlugin(pluginName) {
    return this.plugins.has(pluginName);
  }

  getAllPlugins() {
    return Array.from(this.plugins.keys());
  }

  /**
   * NEW: Test a plugin and regenerate if it fails
   */
  async testAndRepairPlugin(pluginName, page, url) {
    console.log(`Testing plugin: ${pluginName}`);
    
    const plugin = this.getPlugin(pluginName);
    if (!plugin) {
      console.log(`Plugin ${pluginName} not found, generating...`);
      return await this.generateParserForUnknownBoard(page, url, pluginName);
    }

    try {
      // Test the plugin
      const jobs = await plugin.scrape(page, url);
      
      if (!Array.isArray(jobs) || jobs.length === 0) {
        throw new Error('Plugin returned invalid or empty results');
      }

      console.log(`✓ Plugin test successful: ${jobs.length} jobs found`);
      return plugin;
    } catch (error) {
      console.error(`✗ Plugin test failed: ${error.message}`);
      console.log(`Regenerating plugin with self-healing...`);
      
      // Remove broken plugin
      this.plugins.delete(pluginName);
      
      // Generate new one
      return await this.generateParserForUnknownBoard(page, url, pluginName);
    }
  }
}

module.exports = PluginManager;
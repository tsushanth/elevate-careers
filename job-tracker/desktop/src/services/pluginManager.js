const fs = require('fs').promises;
const path = require('path');

class PluginManager {
  constructor(userDataPath, apiService) {
    this.pluginDir = path.join(userDataPath, 'plugins');
    this.apiService = apiService;
    this.plugins = new Map();
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
}

module.exports = PluginManager;
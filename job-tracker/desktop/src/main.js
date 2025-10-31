const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const Store = require('electron-store');
const ScraperService = require('./services/scraper');
const ApiService = require('./services/api');
const PluginManager = require('./services/pluginManager');

const store = new Store();

let mainWindow;
let scraperService;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true
    },
    icon: path.join(__dirname, 'assets/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(async () => {
  createWindow();

  // Initialize services
  const apiService = new ApiService(store);
  const pluginManager = new PluginManager(app.getPath('userData'), apiService);
  scraperService = new ScraperService(pluginManager, apiService, store);

  // Check if user is logged in
  const token = store.get('authToken');
  if (token) {
    // Start scraper service
    await scraperService.initialize();
    scraperService.start();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (scraperService) {
    scraperService.stop();
  }
});

// IPC Handlers

// Auth
ipcMain.handle('auth:login', async (event, credentials) => {
  try {
    const apiService = new ApiService(store);
    const response = await apiService.login(credentials);
    
    if (response.success) {
      store.set('authToken', response.token);
      store.set('user', response.user);
      
      // Initialize scraper after login
      const pluginManager = new PluginManager(app.getPath('userData'), apiService);
      scraperService = new ScraperService(pluginManager, apiService, store);
      await scraperService.initialize();
      scraperService.start();
    }
    
    return response;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:register', async (event, credentials) => {
  try {
    const apiService = new ApiService(store);
    const response = await apiService.register(credentials);
    
    if (response.success) {
      store.set('authToken', response.token);
      store.set('user', response.user);
      
      // Initialize scraper after registration
      const pluginManager = new PluginManager(app.getPath('userData'), apiService);
      scraperService = new ScraperService(pluginManager, apiService, store);
      await scraperService.initialize();
      scraperService.start();
    }
    
    return response;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:logout', async () => {
  store.delete('authToken');
  store.delete('user');
  
  if (scraperService) {
    scraperService.stop();
  }
  
  return { success: true };
});

ipcMain.handle('auth:getUser', async () => {
  const user = store.get('user');
  const token = store.get('authToken');
  return { user, isAuthenticated: !!token };
});

// Searches
ipcMain.handle('searches:getAll', async () => {
  try {
    const apiService = new ApiService(store);
    return await apiService.getSearches();
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('searches:create', async (event, searchData) => {
  try {
    const apiService = new ApiService(store);
    const response = await apiService.createSearch(searchData);
    
    // Restart scraper to include new search
    if (response.success && scraperService) {
      scraperService.restart();
    }
    
    return response;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('searches:update', async (event, { id, data }) => {
  try {
    const apiService = new ApiService(store);
    return await apiService.updateSearch(id, data);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('searches:delete', async (event, id) => {
  try {
    const apiService = new ApiService(store);
    const response = await apiService.deleteSearch(id);
    
    // Restart scraper to remove search
    if (response.success && scraperService) {
      scraperService.restart();
    }
    
    return response;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Jobs
ipcMain.handle('jobs:getAll', async (event, params) => {
  try {
    const apiService = new ApiService(store);
    return await apiService.getJobs(params);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('jobs:updateStatus', async (event, { id, status }) => {
  try {
    const apiService = new ApiService(store);
    return await apiService.updateJobStatus(id, status);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Scraper control
ipcMain.handle('scraper:getStatus', async () => {
  if (!scraperService) {
    return { isRunning: false };
  }
  return {
    isRunning: scraperService.isRunning,
    lastRun: scraperService.lastRun,
    nextRun: scraperService.nextRun
  };
});

ipcMain.handle('scraper:runNow', async () => {
  console.log('=== SCRAPER:RUNNOW CALLED ===');
  
  if (!scraperService) {
    console.error('Scraper service not initialized!');
    return { success: false, error: 'Scraper not initialized' };
  }
  
  try {
    console.log('Running scraper manually...');
    await scraperService.scrapeAll();
    console.log('Manual scrape completed successfully');
    return { success: true };
  } catch (error) {
    console.error('Manual scrape error:', error);
    console.error('Error stack:', error.stack);
    return { success: false, error: error.message };
  }
});

// Show notification
ipcMain.on('notification:show', (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

console.log('Job Tracker Desktop initialized');
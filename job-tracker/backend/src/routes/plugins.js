import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticateToken } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get manifest of available plugins
router.get('/manifest', async (req, res) => {
  try {
    const pluginsDir = path.join(__dirname, '../../plugins');
    const pluginFolders = await fs.readdir(pluginsDir);

    const manifest = {};

    for (const folder of pluginFolders) {
      const manifestPath = path.join(pluginsDir, folder, 'manifest.json');

      try {
        const manifestContent = await fs.readFile(manifestPath, 'utf-8');
        const pluginManifest = JSON.parse(manifestContent);

        manifest[folder] = {
          version: pluginManifest.version,
          name: pluginManifest.name,
          interval: pluginManifest.interval || 30,
          requiresAuth: pluginManifest.requiresAuth || false,
          updated: pluginManifest.updated || new Date().toISOString()
        };
      } catch (error) {
        console.error(`Error reading manifest for ${folder}:`, error);
      }
    }

    res.json({
      success: true,
      plugins: manifest
    });
  } catch (error) {
    console.error('Get manifest error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Download specific plugin
router.get('/:name/download', async (req, res) => {
  try {
    const { name } = req.params;

    // Validate plugin name (prevent directory traversal)
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return res.status(400).json({ error: 'Invalid plugin name' });
    }

    const pluginPath = path.join(__dirname, '../../plugins', name, 'scraper.js');

    try {
      const pluginCode = await fs.readFile(pluginPath, 'utf-8');

      res.set('Content-Type', 'application/javascript');
      res.send(pluginCode);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: 'Plugin not found' });
      }
      throw error;
    }
  } catch (error) {
    console.error('Download plugin error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
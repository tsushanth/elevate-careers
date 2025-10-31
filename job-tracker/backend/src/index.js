import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import searchesRoutes from './routes/searches.js';
import jobsRoutes from './routes/jobs.js';
import pluginsRoutes from './routes/plugins.js';
import { initializeFirebase } from './services/notifications.js';
import db from './db/index.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/searches', searchesRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/plugins', pluginsRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Initialize services
async function initialize() {
  try {
    // Test database connection
    await db.query('SELECT NOW()');
    console.log('Database connection successful');

    // Initialize Firebase for push notifications
    initializeFirebase();

    // Start server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`API endpoints:`);
      console.log(`  POST   /api/auth/register`);
      console.log(`  POST   /api/auth/login`);
      console.log(`  GET    /api/searches/mine`);
      console.log(`  POST   /api/searches`);
      console.log(`  GET    /api/jobs`);
      console.log(`  POST   /api/jobs/batch`);
      console.log(`  GET    /api/plugins/manifest`);
    });
  } catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  }
}

initialize();

export default app;
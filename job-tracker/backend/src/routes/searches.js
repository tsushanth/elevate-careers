import express from 'express';
import db from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get all searches for current user
router.get('/mine', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, board_name, query_url, interval_minutes, active, last_scraped_at, created_at, updated_at
       FROM user_searches 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [req.user.userId]
    );

    res.json({
      success: true,
      searches: result.rows.map(row => ({
        id: row.id,
        board: row.board_name,
        queryUrl: row.query_url,
        interval: row.interval_minutes,
        active: row.active,
        lastScrapedAt: row.last_scraped_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  } catch (error) {
    console.error('Get searches error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new search
router.post('/', async (req, res) => {
  try {
    const { board, queryUrl, interval = 30 } = req.body;

    if (!board || !queryUrl) {
      return res.status(400).json({ error: 'Board and queryUrl are required' });
    }

    if (interval < 30) {
      return res.status(400).json({ error: 'Interval must be at least 30 minutes' });
    }

    const result = await db.query(
      `INSERT INTO user_searches (user_id, board_name, query_url, interval_minutes)
       VALUES ($1, $2, $3, $4)
       RETURNING id, board_name, query_url, interval_minutes, active, created_at`,
      [req.user.userId, board, queryUrl, interval]
    );

    const search = result.rows[0];

    res.status(201).json({
      success: true,
      search: {
        id: search.id,
        board: search.board_name,
        queryUrl: search.query_url,
        interval: search.interval_minutes,
        active: search.active,
        createdAt: search.created_at
      }
    });
  } catch (error) {
    console.error('Create search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update search
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { queryUrl, interval, active } = req.body;

    const updates = [];
    const values = [req.user.userId, id];
    let paramCount = 2;

    if (queryUrl !== undefined) {
      paramCount++;
      updates.push(`query_url = $${paramCount}`);
      values.push(queryUrl);
    }

    if (interval !== undefined) {
      if (interval < 30) {
        return res.status(400).json({ error: 'Interval must be at least 30 minutes' });
      }
      paramCount++;
      updates.push(`interval_minutes = $${paramCount}`);
      values.push(interval);
    }

    if (active !== undefined) {
      paramCount++;
      updates.push(`active = $${paramCount}`);
      values.push(active);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    const result = await db.query(
      `UPDATE user_searches 
       SET ${updates.join(', ')}
       WHERE user_id = $1 AND id = $2
       RETURNING id, board_name, query_url, interval_minutes, active, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Search not found' });
    }

    const search = result.rows[0];

    res.json({
      success: true,
      search: {
        id: search.id,
        board: search.board_name,
        queryUrl: search.query_url,
        interval: search.interval_minutes,
        active: search.active,
        updatedAt: search.updated_at
      }
    });
  } catch (error) {
    console.error('Update search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete search
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      'DELETE FROM user_searches WHERE user_id = $1 AND id = $2 RETURNING id',
      [req.user.userId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Search not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
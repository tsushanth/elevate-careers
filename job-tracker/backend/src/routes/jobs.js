import express from 'express';
import db from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';
import { sendNotificationToUser } from '../services/notifications.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Process batch of scraped jobs from desktop client
router.post('/batch', async (req, res) => {
  try {
    const { searchId, board, jobs, scrapedAt } = req.body;

    if (!searchId || !board || !Array.isArray(jobs)) {
      return res.status(400).json({ error: 'searchId, board, and jobs array are required' });
    }

    // Verify search belongs to user
    const searchResult = await db.query(
      'SELECT id FROM user_searches WHERE id = $1 AND user_id = $2',
      [searchId, req.user.userId]
    );

    if (searchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Search not found' });
    }

    const newJobs = [];
    const existingJobs = [];
    let filteredCount = 0;

    // Get user filters
    const filtersResult = await db.query(
      'SELECT exclude_keywords, include_keywords, exclude_companies, min_salary FROM user_filters WHERE user_id = $1',
      [req.user.userId]
    );

    const filters = filtersResult.rows[0] || {};

    // Process each job
    for (const job of jobs) {
      if (!job.externalId || !job.title || !job.url) {
        continue; // Skip invalid jobs
      }

      // Check if job already exists
      const existingResult = await db.query(
        'SELECT id, status FROM jobs WHERE user_id = $1 AND board_name = $2 AND external_id = $3',
        [req.user.userId, board, job.externalId]
      );

      if (existingResult.rows.length > 0) {
        // Update last_seen_at
        await db.query(
          'UPDATE jobs SET last_seen_at = CURRENT_TIMESTAMP WHERE id = $1',
          [existingResult.rows[0].id]
        );
        existingJobs.push(existingResult.rows[0].id);
        continue;
      }

      // Apply filters
      if (!matchesFilters(job, filters)) {
        filteredCount++;
        continue;
      }

      // Insert new job
      const insertResult = await db.query(
        `INSERT INTO jobs (user_id, search_id, external_id, board_name, title, company, location, url, posted_date, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new')
         RETURNING id, external_id, board_name, title, company, location, url, posted_date, status, first_seen_at`,
        [
          req.user.userId,
          searchId,
          job.externalId,
          board,
          job.title,
          job.company || null,
          job.location || null,
          job.url,
          job.postedDate || null
        ]
      );

      const newJob = insertResult.rows[0];
      newJobs.push({
        id: newJob.id,
        externalId: newJob.external_id,
        board: newJob.board_name,
        title: newJob.title,
        company: newJob.company,
        location: newJob.location,
        url: newJob.url,
        postedDate: newJob.posted_date,
        status: newJob.status,
        firstSeenAt: newJob.first_seen_at
      });
    }

    // Update last_scraped_at for the search
    await db.query(
      'UPDATE user_searches SET last_scraped_at = CURRENT_TIMESTAMP WHERE id = $1',
      [searchId]
    );

    // Send notifications if there are new jobs
    if (newJobs.length > 0) {
      await sendNotificationToUser(req.user.userId, {
        title: `${newJobs.length} new job${newJobs.length > 1 ? 's' : ''} found!`,
        body: newJobs[0].title + (newJobs.length > 1 ? ` and ${newJobs.length - 1} more` : ''),
        data: {
          type: 'new_jobs',
          count: newJobs.length.toString()
        }
      });
    }

    res.json({
      success: true,
      processed: jobs.length,
      new: newJobs.length,
      existing: existingJobs.length,
      filtered: filteredCount,
      newJobs
    });
  } catch (error) {
    console.error('Batch process error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get jobs with filtering and pagination
router.get('/', async (req, res) => {
  try {
    const { status, page = 1, limit = 50, search, searchId } = req.query;

    const offset = (page - 1) * limit;
    const conditions = ['user_id = $1'];
    const values = [req.user.userId];
    let paramCount = 1;

    if (status) {
      paramCount++;
      conditions.push(`status = $${paramCount}`);
      values.push(status);
    }

    // NEW: Filter by specific search
    if (searchId) {
      paramCount++;
      conditions.push(`search_id = $${paramCount}`);
      values.push(searchId);
    }

    if (search) {
      paramCount++;
      conditions.push(`(title ILIKE $${paramCount} OR company ILIKE $${paramCount})`);
      values.push(`%${search}%`);
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) FROM jobs WHERE ${whereClause}`,
      values
    );

    const total = parseInt(countResult.rows[0].count);

    // Get jobs - NEW: Include search_id in results
    const jobsResult = await db.query(
      `SELECT id, external_id, board_name, title, company, location, url, posted_date, status, first_seen_at, last_seen_at, search_id
       FROM jobs 
       WHERE ${whereClause}
       ORDER BY first_seen_at DESC
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...values, limit, offset]
    );

    const jobs = jobsResult.rows.map(row => ({
      id: row.id,
      externalId: row.external_id,
      board: row.board_name,
      title: row.title,
      company: row.company,
      location: row.location,
      url: row.url,
      postedDate: row.posted_date,
      status: row.status,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      searchId: row.search_id // NEW: Include search ID
    }));

    res.json({
      success: true,
      jobs,
      total,
      page: parseInt(page),
      perPage: parseInt(limit),
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Get jobs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single job
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT id, external_id, board_name, title, company, location, url, posted_date, status, first_seen_at, last_seen_at
       FROM jobs 
       WHERE id = $1 AND user_id = $2`,
      [id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = result.rows[0];

    res.json({
      success: true,
      job: {
        id: job.id,
        externalId: job.external_id,
        board: job.board_name,
        title: job.title,
        company: job.company,
        location: job.location,
        url: job.url,
        postedDate: job.posted_date,
        status: job.status,
        firstSeenAt: job.first_seen_at,
        lastSeenAt: job.last_seen_at
      }
    });
  } catch (error) {
    console.error('Get job error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update job status
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['new', 'seen', 'applied', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Valid status is required (new, seen, applied, rejected)' });
    }

    const result = await db.query(
      `UPDATE jobs 
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3
       RETURNING id, status, updated_at`,
      [status, id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      success: true,
      job: {
        id: result.rows[0].id,
        status: result.rows[0].status,
        updatedAt: result.rows[0].updated_at
      }
    });
  } catch (error) {
    console.error('Update job error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to match jobs against filters
function matchesFilters(job, filters) {
  const title = job.title.toLowerCase();
  const company = (job.company || '').toLowerCase();

  // Check exclude keywords
  if (filters.exclude_keywords && filters.exclude_keywords.length > 0) {
    for (const keyword of filters.exclude_keywords) {
      if (title.includes(keyword.toLowerCase())) {
        return false;
      }
    }
  }

  // Check include keywords (if set, at least one must match)
  if (filters.include_keywords && filters.include_keywords.length > 0) {
    const hasMatch = filters.include_keywords.some(keyword =>
      title.includes(keyword.toLowerCase())
    );
    if (!hasMatch) {
      return false;
    }
  }

  // Check exclude companies
  if (filters.exclude_companies && filters.exclude_companies.length > 0) {
    for (const excludedCompany of filters.exclude_companies) {
      if (company.includes(excludedCompany.toLowerCase())) {
        return false;
      }
    }
  }

  return true;
}

export default router;
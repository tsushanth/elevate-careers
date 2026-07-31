// src/routes/profile.js
// Resume parsing from Supabase Storage and profile management

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { parseResume } from '../services/resumeParser.js';
import { extractSkills } from '../services/skillExtractor.js';
import { generateEmbeddings } from '../services/embeddingService.js';
import { calculateJobMatches } from '../services/matchingService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false }, realtime: { enabled: false } }
);

// Middleware to verify auth token
const verifyAuth = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  req.user = user;
  next();
};

// POST /api/profile/resume/parse - Parse resume from Supabase Storage
router.post('/resume/parse', verifyAuth, async (req, res) => {
  try {
    const { user } = req;
    const { storage_path, file_name, file_size } = req.body;
    
    logger.info({ userId: user.id, storagePath: storage_path }, 'Parsing resume from storage');
    
    // 1. Download resume from Supabase Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('resumes')
      .download(storage_path);
    
    if (downloadError) {
      logger.error({ error: downloadError }, 'Failed to download resume from storage');
      return res.status(500).json({ error: 'Failed to download resume' });
    }
    
    // Convert Blob to Buffer
    const buffer = Buffer.from(await fileData.arrayBuffer());
    
    // 2. Determine file type
    const fileType = file_name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 
                     'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    
    // 3. Parse resume content
    const parsedData = await parseResume(buffer, fileType);
    
    // 4. Extract skills
    const skills = extractSkills(parsedData.text);
    
    // 5. Create resume record in database
    const { data: resume, error: resumeError } = await supabase
      .from('resume')
      .insert({
        user_id: user.id,
        file_name,
        file_path: storage_path,
        file_size,
        file_type: fileType.includes('pdf') ? 'pdf' : 'docx',
        raw_text: parsedData.text,
        parsed_data: parsedData.structured,
        parsing_status: 'completed',
        parsed_at: new Date().toISOString(),
        is_primary: true
      })
      .select()
      .single();
    
    if (resumeError) {
      logger.error({ error: resumeError }, 'Failed to create resume record');
      return res.status(500).json({ error: 'Failed to save resume data' });
    }
    
    // 6. Update or create user profile
    await updateProfileFromResume(user.id, parsedData, skills);
    
    // 7. Generate embeddings for semantic matching
    try {
      const embeddings = await generateEmbeddings(parsedData.text);
      await supabase
        .from('user_profile')
        .update({ skill_embeddings: embeddings })
        .eq('user_id', user.id);
    } catch (embeddingError) {
      logger.warn({ error: embeddingError }, 'Failed to generate embeddings');
    }
    
    // 8. Calculate job matches asynchronously
    calculateJobMatches(user.id).catch(err => 
      logger.error({ error: err }, 'Failed to calculate job matches')
    );
    
    logger.info({ userId: user.id, resumeId: resume.id }, 'Resume parsed successfully');
    
    res.json({
      success: true,
      skills_count: skills.length,
      experience_count: parsedData.structured.experience?.length || 0,
      education_count: parsedData.structured.education?.length || 0
    });
    
  } catch (error) {
    logger.error({ error }, 'Resume parsing error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/profile - Get user profile
router.get('/', verifyAuth, async (req, res) => {
  try {
    const { user } = req;
    
    const { data: profile, error } = await supabase
      .from('user_profile')
      .select(`
        *,
        work_experience (*),
        education (*),
        resume (*)
      `)
      .eq('user_id', user.id)
      .single();
    
    if (error && error.code !== 'PGRST116') { // Not found is ok
      throw error;
    }
    
    res.json({ profile: profile || null });
    
  } catch (error) {
    logger.error({ error }, 'Get profile error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/profile - Update user profile
router.put('/', verifyAuth, async (req, res) => {
  try {
    const { user } = req;
    const profileData = req.body;
    
    // Validate and sanitize input
    const allowedFields = [
      'full_name', 'email', 'phone', 'location_city', 'location_country',
      'linkedin_url', 'portfolio_url', 'github_url', 'headline', 'summary',
      'years_of_experience', 'desired_roles', 'desired_locations',
      'remote_preference', 'desired_employment_types',
      'desired_salary_min', 'desired_salary_max', 'desired_salary_currency',
      'skills', 'work_authorization', 'requires_sponsorship'
    ];
    
    const updates = {};
    for (const field of allowedFields) {
      if (field in profileData) {
        updates[field] = profileData[field];
      }
    }
    
    updates.updated_at = new Date().toISOString();
    
    // Upsert profile
    const { data: profile, error } = await supabase
      .from('user_profile')
      .upsert({ 
        user_id: user.id,
        ...updates
      })
      .select()
      .single();
    
    if (error) {
      throw error;
    }
    
    // Recalculate matches if preferences changed
    if (profileData.desired_roles || profileData.skills) {
      calculateJobMatches(user.id).catch(err =>
        logger.error({ error: err }, 'Failed to recalculate matches')
      );
    }
    
    res.json({ success: true, profile });
    
  } catch (error) {
    logger.error({ error }, 'Update profile error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/profile/resume/:resumeId - Delete resume
router.delete('/resume/:resumeId', verifyAuth, async (req, res) => {
  try {
    const { user } = req;
    const { resumeId } = req.params;
    
    // Get resume record
    const { data: resume, error: fetchError } = await supabase
      .from('resume')
      .select('file_path')
      .eq('id', resumeId)
      .eq('user_id', user.id)
      .single();
    
    if (fetchError) {
      return res.status(404).json({ error: 'Resume not found' });
    }
    
    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from('resumes')
      .remove([resume.file_path]);
    
    if (storageError) {
      logger.error({ error: storageError }, 'Failed to delete from storage');
    }
    
    // Delete from database
    const { error: dbError } = await supabase
      .from('resume')
      .delete()
      .eq('id', resumeId)
      .eq('user_id', user.id);
    
    if (dbError) {
      throw dbError;
    }
    
    res.json({ success: true });
    
  } catch (error) {
    logger.error({ error }, 'Delete resume error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/profile/linkedin - Import from LinkedIn
router.post('/linkedin', verifyAuth, async (req, res) => {
  try {
    const { user } = req;
    const { linkedinData } = req.body;
    
    // Parse LinkedIn data
    const profileData = parseLinkedInData(linkedinData);
    
    // Update profile
    const { data: profile, error } = await supabase
      .from('user_profile')
      .upsert({
        user_id: user.id,
        ...profileData,
        profile_source: 'linkedin',
        updated_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      throw error;
    }
    
    res.json({ success: true, profile });
    
  } catch (error) {
    logger.error({ error }, 'LinkedIn import error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/profile/matches - Get job matches for user
router.get('/matches', verifyAuth, async (req, res) => {
  try {
    const { user } = req;
    const { limit = 50, minScore = 60 } = req.query;
    
    const { data: matches, error } = await supabase
      .from('job_match_score')
      .select(`
        *,
        job:job_id (
          id, title, company_name, location_city, employment_type,
          remote, salary_min, salary_max, posted_at, apply_url
        )
      `)
      .eq('user_id', user.id)
      .gte('overall_score', minScore)
      .order('overall_score', { ascending: false })
      .limit(limit);
    
    if (error) {
      throw error;
    }
    
    res.json({ matches });
    
  } catch (error) {
    logger.error({ error }, 'Get matches error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/profile/autofill - Get autofill data
router.get('/autofill', verifyAuth, async (req, res) => {
  try {
    const { user } = req;
    
    const { data: profile, error: profileError } = await supabase
      .from('user_profile')
      .select('autofill_data, *')
      .eq('user_id', user.id)
      .single();
    
    const { data: templates, error: templateError } = await supabase
      .from('autofill_template')
      .select('*')
      .eq('user_id', user.id);
    
    if (profileError && profileError.code !== 'PGRST116') {
      throw profileError;
    }
    
    res.json({
      autofillData: profile?.autofill_data || {},
      templates: templates || [],
      profile: profile || null
    });
    
  } catch (error) {
    logger.error({ error }, 'Get autofill error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/profile/work-experience - Add work experience
router.post('/work-experience', verifyAuth, async (req, res) => {
  try {
    const { user } = req;
    const experience = req.body;
    
    const { data, error } = await supabase
      .from('work_experience')
      .insert({
        user_id: user.id,
        ...experience
      })
      .select()
      .single();
    
    if (error) {
      throw error;
    }
    
    res.json({ success: true, experience: data });
    
  } catch (error) {
    logger.error({ error }, 'Add work experience error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper functions

async function updateProfileFromResume(userId, parsedData, skills) {
  const structured = parsedData.structured;
  
  const profileUpdate = {
    user_id: userId,
    skills: skills,
    profile_source: 'resume'
  };
  
  if (structured.name) profileUpdate.full_name = structured.name;
  if (structured.email) profileUpdate.email = structured.email;
  if (structured.phone) profileUpdate.phone = structured.phone;
  if (structured.summary) profileUpdate.summary = structured.summary;
  
  // Calculate years of experience
  if (structured.experience?.length > 0) {
    const totalMonths = structured.experience.reduce((sum, exp) => {
      const start = new Date(exp.startDate);
      const end = exp.endDate ? new Date(exp.endDate) : new Date();
      const months = (end.getFullYear() - start.getFullYear()) * 12 + 
                     (end.getMonth() - start.getMonth());
      return sum + Math.max(0, months);
    }, 0);
    
    profileUpdate.years_of_experience = Math.floor(totalMonths / 12);
  }
  
  // Upsert profile
  await supabase
    .from('user_profile')
    .upsert(profileUpdate)
    .eq('user_id', userId);
  
  // Insert work experience
  if (structured.experience?.length > 0) {
    const workExperiences = structured.experience.map(exp => ({
      user_id: userId,
      company_name: exp.company,
      job_title: exp.title,
      location: exp.location,
      start_date: exp.startDate,
      end_date: exp.endDate,
      is_current: !exp.endDate,
      description: exp.description,
      skills_used: exp.skills || []
    }));
    
    await supabase
      .from('work_experience')
      .upsert(workExperiences);
  }
  
  // Insert education
  if (structured.education?.length > 0) {
    const educationRecords = structured.education.map(edu => ({
      user_id: userId,
      institution: edu.school,
      degree: edu.degree,
      field_of_study: edu.major,
      start_date: edu.startDate,
      end_date: edu.endDate,
      gpa: edu.gpa
    }));
    
    await supabase
      .from('education')
      .upsert(educationRecords);
  }
}

function parseLinkedInData(linkedinData) {
  return {
    full_name: linkedinData.firstName + ' ' + linkedinData.lastName,
    headline: linkedinData.headline,
    summary: linkedinData.summary,
    linkedin_url: linkedinData.publicProfileUrl,
  };
}

export default router;
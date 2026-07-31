// src/services/matchingService.js
// Calculate job match scores based on user profile

import { createClient } from '@supabase/supabase-js';
import { cosineSimilarity } from '../utils/mathUtils.js';
import { logger } from '../utils/logger.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false }, realtime: { enabled: false } }
);

export async function calculateJobMatches(userId) {
  try {
    logger.info({ userId }, 'Calculating job matches');
    
    // 1. Get user profile
    const { data: profile } = await supabase
      .from('user_profile')
      .select('*, work_experience(*)')
      .eq('user_id', userId)
      .single();
    
    if (!profile) {
      logger.warn({ userId }, 'No profile found for user');
      return;
    }
    
    // 2. Get all active jobs
    const { data: jobs } = await supabase
      .from('job')
      .select('*')
      .gte('posted_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()); // Last 90 days
    
    logger.info({ jobCount: jobs.length }, 'Fetched jobs for matching');
    
    // 3. Calculate scores for each job
    const matches = [];
    
    for (const job of jobs) {
      const scores = calculateMatchScores(profile, job);
      
      if (scores.overall_score >= 40) { // Only store matches above 40%
        matches.push({
          user_id: userId,
          job_id: job.id,
          overall_score: scores.overall_score,
          skills_score: scores.skills_score,
          experience_score: scores.experience_score,
          location_score: scores.location_score,
          salary_score: scores.salary_score,
          matching_skills: scores.matching_skills,
          missing_skills: scores.missing_skills,
          match_reasons: scores.reasons
        });
      }
    }
    
    // 4. Batch upsert matches
    if (matches.length > 0) {
      const { error } = await supabase
        .from('job_match_score')
        .upsert(matches, { onConflict: 'user_id,job_id' });
      
      if (error) {
        logger.error({ error }, 'Failed to save job matches');
      } else {
        logger.info({ matchCount: matches.length }, 'Job matches saved');
      }
    }
    
    return matches;
    
  } catch (error) {
    logger.error({ error, userId }, 'Calculate job matches failed');
    throw error;
  }
}

function calculateMatchScores(profile, job) {
  const scores = {
    skills_score: 0,
    experience_score: 0,
    location_score: 0,
    salary_score: 0,
    overall_score: 0,
    matching_skills: [],
    missing_skills: [],
    reasons: {}
  };
  
  // 1. Skills Match (40% weight)
  if (profile.skills && profile.skills.length > 0) {
    const jobDescription = (job.description_excerpt || '').toLowerCase();
    const matchingSkills = profile.skills.filter(skill => 
      jobDescription.includes(skill.toLowerCase())
    );
    
    scores.matching_skills = matchingSkills;
    scores.skills_score = (matchingSkills.length / Math.max(profile.skills.length, 1)) * 100;
    
    if (matchingSkills.length > 0) {
      scores.reasons.skills = `${matchingSkills.length} matching skills found`;
    }
  }
  
  // 2. Experience Match (30% weight)
  const jobExperienceKeywords = extractExperienceLevel(job.description_excerpt || job.title);
  const userExperience = profile.years_of_experience || 0;
  
  if (jobExperienceKeywords.min !== null && jobExperienceKeywords.max !== null) {
    if (userExperience >= jobExperienceKeywords.min && userExperience <= jobExperienceKeywords.max) {
      scores.experience_score = 100;
      scores.reasons.experience = 'Experience level matches';
    } else if (userExperience < jobExperienceKeywords.min) {
      const diff = jobExperienceKeywords.min - userExperience;
      scores.experience_score = Math.max(0, 100 - (diff * 20));
      scores.reasons.experience = `${diff} years below required`;
    } else {
      scores.experience_score = 90; // Overqualified but still good
      scores.reasons.experience = 'Overqualified';
    }
  } else {
    scores.experience_score = 70; // Neutral if can't determine
  }
  
  // 3. Location Match (15% weight)
  if (profile.remote_preference === 'remote_only') {
    scores.location_score = job.remote ? 100 : 20;
    scores.reasons.location = job.remote ? 'Remote job' : 'Not remote';
  } else if (profile.desired_locations && profile.desired_locations.length > 0) {
    const jobLocation = (job.location_city || '').toLowerCase();
    const locationMatch = profile.desired_locations.some(loc => 
      jobLocation.includes(loc.toLowerCase())
    );
    
    scores.location_score = locationMatch ? 100 : (job.remote ? 80 : 40);
    scores.reasons.location = locationMatch ? 'Preferred location' : (job.remote ? 'Remote option' : 'Different location');
  } else {
    scores.location_score = 70; // Neutral if no preference
  }
  
  // 4. Salary Match (15% weight)
  if (profile.desired_salary_min && job.salary_min && job.salary_max) {
    const midSalary = (job.salary_min + job.salary_max) / 2;
    
    if (midSalary >= profile.desired_salary_min) {
      scores.salary_score = 100;
      scores.reasons.salary = 'Meets salary expectations';
    } else {
      const percentDiff = ((profile.desired_salary_min - midSalary) / profile.desired_salary_min) * 100;
      scores.salary_score = Math.max(0, 100 - percentDiff);
      scores.reasons.salary = `${Math.round(percentDiff)}% below expectations`;
    }
  } else {
    scores.salary_score = 50; // Neutral if salary not specified
  }
  
  // 5. Employment Type Match (bonus)
  if (profile.desired_employment_types && profile.desired_employment_types.length > 0) {
    if (profile.desired_employment_types.includes(job.employment_type)) {
      scores.overall_score += 5; // Bonus
      scores.reasons.employment_type = 'Matches preference';
    }
  }
  
  // Calculate weighted overall score
  scores.overall_score = Math.round(
    scores.skills_score * 0.40 +
    scores.experience_score * 0.30 +
    scores.location_score * 0.15 +
    scores.salary_score * 0.15 +
    (scores.overall_score || 0) // Include any bonuses
  );
  
  return scores;
}

function extractExperienceLevel(text) {
  const lowerText = text.toLowerCase();
  
  // Look for explicit years mentioned
  const yearMatches = lowerText.match(/(\d+)\+?\s*years?/g);
  if (yearMatches) {
    const years = yearMatches.map(m => parseInt(m.match(/\d+/)[0]));
    return { min: Math.min(...years), max: Math.max(...years) + 2 };
  }
  
  // Look for experience level keywords
  if (lowerText.includes('entry') || lowerText.includes('junior') || lowerText.includes('graduate')) {
    return { min: 0, max: 2 };
  }
  if (lowerText.includes('mid') || lowerText.includes('intermediate')) {
    return { min: 2, max: 5 };
  }
  if (lowerText.includes('senior') || lowerText.includes('lead')) {
    return { min: 5, max: 10 };
  }
  if (lowerText.includes('principal') || lowerText.includes('staff')) {
    return { min: 8, max: 15 };
  }
  
  return { min: null, max: null };
}

// Skill extraction from text
export function extractSkills(text) {
  const commonSkills = [
    // Programming languages
    'javascript', 'python', 'java', 'c++', 'c#', 'ruby', 'go', 'rust', 'swift', 'kotlin',
    'typescript', 'php', 'scala', 'r', 'matlab', 'sql',
    
    // Frameworks & Libraries
    'react', 'angular', 'vue', 'node.js', 'express', 'django', 'flask', 'spring',
    'laravel', '.net', 'rails', 'nextjs', 'gatsby', 'svelte',
    
    // Mobile
    'ios', 'android', 'react native', 'flutter', 'swiftui', 'jetpack compose',
    
    // Data & ML
    'pandas', 'numpy', 'tensorflow', 'pytorch', 'scikit-learn', 'keras',
    'machine learning', 'deep learning', 'nlp', 'computer vision', 'data science',
    
    // Cloud & DevOps
    'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'jenkins',
    'ci/cd', 'devops', 'git', 'github', 'gitlab',
    
    // Databases
    'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'dynamodb',
    'supabase', 'firebase',
    
    // Other
    'api', 'rest', 'graphql', 'microservices', 'agile', 'scrum', 'jira',
    'figma', 'sketch', 'ux', 'ui', 'design'
  ];
  
  const lowerText = text.toLowerCase();
  const foundSkills = [];
  
  for (const skill of commonSkills) {
    if (lowerText.includes(skill)) {
      foundSkills.push(skill);
    }
  }
  
  return [...new Set(foundSkills)]; // Remove duplicates
}
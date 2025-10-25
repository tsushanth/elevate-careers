// src/services/resumeParser.js
// Parse resumes using AI (Claude, GPT, or open-source models)

import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export async function parseResume(buffer, mimeType) {
  try {
    // 1. Extract text from file
    let text = '';
    
    if (mimeType === 'application/pdf') {
      const pdfData = await pdf(buffer);
      text = pdfData.text;
    } else if (mimeType.includes('word')) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    }
    
    logger.info({ textLength: text.length }, 'Extracted text from resume');
    
    // 2. Parse using AI
    const structured = await parseWithAI(text);
    
    return {
      text,
      structured
    };
    
  } catch (error) {
    logger.error({ error }, 'Resume parsing failed');
    throw error;
  }
}

async function parseWithAI(resumeText) {
  const prompt = `You are a resume parsing expert. Extract structured information from this resume.

Resume:
${resumeText}

Extract the following information in JSON format:
{
  "name": "Full name",
  "email": "Email address",
  "phone": "Phone number",
  "location": "City, State/Country",
  "summary": "Professional summary or objective",
  "skills": ["skill1", "skill2", ...],
  "experience": [
    {
      "company": "Company name",
      "title": "Job title",
      "location": "Location",
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD or null if current",
      "description": "Job description",
      "achievements": ["achievement1", ...],
      "skills": ["skills used", ...]
    }
  ],
  "education": [
    {
      "school": "Institution name",
      "degree": "Degree type",
      "major": "Field of study",
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD",
      "gpa": 3.5
    }
  ],
  "certifications": ["cert1", "cert2", ...],
  "languages": ["English (Native)", "Spanish (Professional)", ...],
  "linkedin": "LinkedIn URL if present",
  "github": "GitHub URL if present",
  "portfolio": "Portfolio URL if present"
}

Important:
- Extract dates in YYYY-MM-DD format. If only year is given, use YYYY-01-01
- For current positions, use null for endDate
- Be thorough in extracting skills from both the skills section and work experience
- Include technical skills, soft skills, tools, and technologies
- Extract achievements and quantifiable results where mentioned`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });
    
    const responseText = message.content[0].text;
    
    // Extract JSON from response (in case there's explanation text)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to extract JSON from AI response');
    }
    
    const structured = JSON.parse(jsonMatch[0]);
    
    logger.info({ fields: Object.keys(structured) }, 'Resume parsed successfully');
    
    return structured;
    
  } catch (error) {
    logger.error({ error }, 'AI parsing failed');
    
    // Fallback to rule-based parsing
    return parseWithRules(resumeText);
  }
}

function parseWithRules(text) {
  // Basic rule-based parsing as fallback
  const structured = {
    name: null,
    email: null,
    phone: null,
    skills: [],
    experience: [],
    education: []
  };
  
  // Extract email
  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) structured.email = emailMatch[0];
  
  // Extract phone
  const phoneMatch = text.match(/(\+\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}/);
  if (phoneMatch) structured.phone = phoneMatch[0];
  
  // Extract skills (look for common skill section headers)
  const skillsSection = text.match(/skills:?(.*?)(?=\n\n|experience|education|$)/is);
  if (skillsSection) {
    structured.skills = skillsSection[1]
      .split(/[,\n•·]/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && s.length < 50);
  }
  
  return structured;
}

export { parseWithAI, parseWithRules };
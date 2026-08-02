// routes/ai-resume.js - ES Module version for existing project
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { recomputeSignals } from '../services/signals.js';
import { resolveJobIdForUrl } from '../services/jobIdentity.js';
import { nonUsTextRegexJs } from '../services/geo.js';

const router = express.Router();

// Auth middleware — validates Supabase JWT
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    const sb = getSupabase();
    const { data: { user }, error } = await sb.auth.getUser(token);
    if (error || !user) {
      console.error('[auth] getUser failed:', error?.message, error?.status, error?.code);
      return res.status(401).json({ error: 'Invalid session — sign in again' });
    }
    req.user = user;
    next();
  } catch (e) {
    console.error('[auth] exception:', e?.message);
    return res.status(401).json({ error: 'Auth check failed' });
  }
}

// Lazy-initialized clients
let _anthropic = null;
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// Increment ai_calls counter for a user (fire-and-forget)
async function incrementAiUsage(userId) {
  try {
    const sb = getSupabase();
    await sb.rpc('increment_ai_calls', { uid: userId });
  } catch (_) {}
}

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)
      throw new Error('Supabase not configured');
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { enabled: false },
    });
  }
  return _supabase;
}

// In-memory conversation storage (use Redis in production)
const conversations = new Map();

// System prompt
const SYSTEM_PROMPT = `You are a professional resume building assistant and career coach. Your role is to help users create a complete, polished, professional resume through conversation.

RULES:
1. Ask ONE clear, specific question at a time
2. Keep responses short (2-3 sentences maximum)
3. Be encouraging and friendly
4. Ask follow-up questions for clarity and detail
5. Extract structured information as you go
6. Guide users through these sections in order:
   - Personal info (name, email, phone, location)
   - Education (school, degree, field, graduation year)
   - Work experience (company, position, duration, key responsibilities)
   - Skills (technical skills, tools, languages)

IMPORTANT - CONTENT ENHANCEMENT:
- When user provides vague descriptions, ask for specific details and impact
- Suggest professional phrasing and action verbs
- For experience: Ask about achievements, metrics, and team size
- For skills: Ask about proficiency level and years of experience
- Offer to expand brief descriptions into professional bullet points
- Examples:
  * User: "I worked on websites" → Ask: "What technologies? How many projects? Any measurable results?"
  * User: "Python" → Ask: "How long have you used Python? Any frameworks like Django or Flask?"
  * User: "Managed a team" → Ask: "How large was the team? What were key achievements?"

IMPORTANT - MULTIPLE ENTRIES:
- After collecting ONE education entry, ALWAYS ask: "Would you like to add another education entry?"
- After collecting ONE work experience entry, ALWAYS ask: "Would you like to add another work experience?"
- After collecting initial skills, ALWAYS ask: "Any additional skills you'd like to add?"
- Only move to completion when user says "no" or indicates they're done adding entries

IMPORTANT - SUGGESTIONS:
- When user seems uncertain or provides minimal detail, offer suggestions:
  * "For a software engineer role, typical responsibilities include: developing features, code reviews, mentoring. Does any of this apply?"
  * "Common skills for your field include: [list]. Do you have experience with any of these?"
- Help users quantify their impact: "Did you increase efficiency? Save time? Improve metrics?"

CONVERSATION FLOW:
- Start with: "Hi! I'm your AI resume assistant. Let's build your professional resume together. What's your full name?"
- After each answer, acknowledge briefly and ask the next question
- If answer is unclear or too brief, ask follow-up questions for more detail
- Offer to help expand vague descriptions into professional language
- After EACH section (education, experience, skills), ask if they want to add more
- Only mark as complete when user confirms they're done with all sections

Current conversation stage: [Will be injected dynamically]`;

/**
 * POST /api/ai-resume/start
 */
router.post('/start', requireAuth, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const conversation = {
      id: conversationId,
      userId,
      messages: [],
      resumeData: {
        personalInfo: {},
        education: [],
        experience: [],
        skills: []
      },
      stage: 'personal_info',
      startedAt: new Date().toISOString()
    };

    conversations.set(conversationId, conversation);

    const welcomeMessage = "Hi! I'm your AI resume assistant. Let's build your professional resume together. What's your full name?";

    conversation.messages.push({
      role: 'assistant',
      content: welcomeMessage,
      timestamp: new Date().toISOString()
    });

    res.json({
      conversationId,
      message: welcomeMessage,
      resumeData: conversation.resumeData,
      progress: 0.0,
      isComplete: false
    });

  } catch (error) {
    console.error('Error starting conversation:', error);
    res.status(500).json({ error: 'Failed to start conversation' });
  }
});

/**
 * POST /api/ai-resume/chat
 */
router.post('/chat', requireAuth, async (req, res) => {
  try {
    const { conversationId, message, userId } = req.body;

    if (!conversationId || !message || !userId) {
      return res.status(400).json({ error: 'conversationId, message, and userId are required' });
    }

    const conversation = conversations.get(conversationId);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (conversation.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    conversation.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    });

    const chatMessages = conversation.messages.map(m => ({
      role: m.role,
      content: m.content
    }));

    const completion = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: SYSTEM_PROMPT + `\nCurrent stage: ${conversation.stage}\nCurrent data collected: ${JSON.stringify(conversation.resumeData)}`,
      messages: chatMessages,
    });

    let aiResponse = completion.content[0].text;

    conversation.messages.push({
      role: 'assistant',
      content: aiResponse,
      timestamp: new Date().toISOString()
    });

    const extractedData = await extractResumeData(conversation.messages);
    conversation.resumeData = mergeResumeData(conversation.resumeData, extractedData);
    conversation.stage = determineStage(conversation.resumeData, conversation.messages);

    let progress = calculateProgress(conversation.resumeData, conversation.stage);
    let isComplete = progress >= 1.0 || conversation.stage === 'complete';

    // ✅ IMPROVED: Force progress to 100% when complete
    if (isComplete) {
      progress = 1.0;
    }

    // ✅ IMPROVED: Add completion message when resume is first completed
    if (isComplete && !conversation.completionMessageSent) {
      const completionMessage = "🎉 Fantastic! Your resume is now complete! I'm generating your professional PDF right now. This will just take a moment...";
      
      conversation.messages.push({
        role: 'assistant',
        content: completionMessage,
        timestamp: new Date().toISOString()
      });
      
      conversation.completionMessageSent = true;
      aiResponse = completionMessage; // Use this as the response
    }

    // ✅ IMPROVED: Better completion handling with immediate PDF generation
    let resumeId = null;
    let pdfUrl = null;
    let fileName = null;
    
    if (isComplete && !conversation.savedToDb) {
      try {
        console.log('📄 Starting PDF generation and database save...');
        const result = await saveResumeToSupabase(userId, conversation.resumeData);
        resumeId = result.resumeId;
        pdfUrl = result.pdfUrl;
        fileName = result.fileName;
        
        conversation.savedToDb = true;
        conversation.resumeId = resumeId;
        conversation.pdfUrl = pdfUrl;
        conversation.fileName = fileName;
        
        console.log('✅ Resume completed and saved:', { resumeId, pdfUrl, fileName });
      } catch (saveError) {
        console.error('❌ Error saving resume:', saveError);
        // Continue anyway - user still gets the response
      }
    }

    // ✅ Return saved resume data if already generated
    if (conversation.savedToDb && !resumeId) {
      resumeId = conversation.resumeId;
      pdfUrl = conversation.pdfUrl;
      fileName = conversation.fileName;
    }

    conversations.set(conversationId, conversation);

    res.json({
      message: aiResponse,
      resumeData: conversation.resumeData,
      progress,
      isComplete,
      resumeId,
      pdfUrl,
      fileName,
      stage: conversation.stage
    });

  } catch (error) {
    console.error('Error in chat:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

/**
 * Extract structured resume data
 */
async function extractResumeData(messages) {
  try {
    const conversationText = messages
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const extraction = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: `Extract resume information and return ONLY valid JSON with this structure:
{"personalInfo":{"name":"","email":"","phone":"","location":""},"education":[{"school":"","degree":"","field":"","graduationYear":""}],"experience":[{"company":"","position":"","duration":"","responsibilities":[]}],"skills":[]}
Only include fields that were mentioned. Return valid JSON only, no markdown.

If the user pasted a full resume or a long block of work history, parse it
into ONE SEPARATE experience entry per job (own company/position/duration),
each with its own list of concise responsibility bullets. Never collapse
multiple jobs into a single entry, never use a placeholder like "See resume"
as a position/company, and never dump raw pasted text verbatim into a single
responsibility — always break it into short, individual bullet points.`,
      messages: [{ role: 'user', content: `Extract resume data:\n\n${conversationText}` }],
    });

    const jsonString = extraction.content[0].text.trim();
    const cleanJson = jsonString.replace(/```json\n?|\n?```/g, '');
    return JSON.parse(cleanJson);

  } catch (error) {
    console.error('Error extracting data:', error);
    return {
      personalInfo: {},
      education: [],
      experience: [],
      skills: []
    };
  }
}

function mergeResumeData(existing, extracted) {
  return {
    personalInfo: { ...existing.personalInfo, ...extracted.personalInfo },
    education: extracted.education.length > 0 ? extracted.education : existing.education,
    experience: extracted.experience.length > 0 ? extracted.experience : existing.experience,
    skills: extracted.skills.length > 0 ? extracted.skills : existing.skills
  };
}

function determineStage(resumeData, recentMessages = []) {
  const hasPersonalInfo = resumeData.personalInfo.name && resumeData.personalInfo.email;
  const hasEducation = resumeData.education.length > 0;
  const hasExperience = resumeData.experience.length > 0;
  const hasSkills = resumeData.skills.length > 0;

  if (!hasPersonalInfo) return 'personal_info';
  if (!hasEducation) return 'education';
  if (!hasExperience) return 'experience';
  if (!hasSkills) return 'skills';
  
  // Check if user has confirmed they're done (said "no" to adding more)
  // Look at last few user messages for confirmation
  const lastUserMessages = recentMessages
    .filter(m => m.role === 'user')
    .slice(-3)
    .map(m => m.content.toLowerCase());
  
  const confirmationPhrases = [
    'no', 'nope', 'no more', 'that\'s all', 'that\'s it', 
    'done', 'finished', 'complete', 'nothing else', 'no thanks',
    'i\'m good', 'all set', 'that\'s everything'
  ];
  
  const hasConfirmedDone = lastUserMessages.some(msg => 
    confirmationPhrases.some(phrase => msg.includes(phrase))
  );
  
  // Only complete if we have all data AND user confirmed they're done
  if (hasPersonalInfo && hasEducation && hasExperience && hasSkills && hasConfirmedDone) {
    return 'complete';
  }
  
  // If all data exists but no confirmation yet, stay in "reviewing" stage
  return 'reviewing';
}

// ✅ IMPROVED: Progress calculation - caps at 95% until user confirms done
function calculateProgress(resumeData, stage = null) {
  let progress = 0;

  // Personal info (25%) - Required fields
  if (resumeData.personalInfo.name) progress += 0.15; // Name is critical
  if (resumeData.personalInfo.email) progress += 0.10; // Email is critical

  // Education (25%) - At least one entry
  if (resumeData.education.length > 0) {
    const edu = resumeData.education[0];
    if (edu.school) progress += 0.10;
    if (edu.degree) progress += 0.10;
    if (edu.field) progress += 0.05;
  }

  // Experience (35%) - At least one entry
  if (resumeData.experience.length > 0) {
    const exp = resumeData.experience[0];
    if (exp.company) progress += 0.15;
    if (exp.position) progress += 0.15;
    if (exp.responsibilities && exp.responsibilities.length > 0) progress += 0.05;
  }

  // Skills (15%) - At least a few skills
  if (resumeData.skills.length >= 1) progress += 0.05;
  if (resumeData.skills.length >= 3) progress += 0.10;

  // Cap at 95% until user confirms they're done (stage = 'complete')
  // This shows progress but indicates there's one more step
  if (stage !== 'complete' && progress >= 0.95) {
    return 0.95;
  }

  return Math.min(progress, 1.0);
}

/**
 * Enhance resume data with AI to make it more professional
 */
async function enhanceResumeWithAI(resumeData) {
  try {
    console.log('✨ Enhancing resume with AI...');

    const enhancementPrompt = `You are a professional resume writer. Enhance the following resume data to make it more professional and impactful while keeping it truthful. 

RULES:
1. Use strong action verbs (Developed, Implemented, Led, Optimized, etc.)
2. Add quantifiable metrics where possible (use placeholders like "multiple", "various", "several" if specific numbers not given)
3. Make descriptions more specific and impressive
4. Keep the same core information - don't add fake details
5. Format responsibilities as clear, concise bullet points
6. Expand abbreviated or vague descriptions
7. Keep EVERY experience entry from the original data — never drop, merge, or
   summarize multiple jobs into one. Each company/role stays its own entry.
8. Return ONLY valid JSON with the same structure

Original Resume Data:
${JSON.stringify(resumeData, null, 2)}

Return enhanced JSON in this exact structure:
{
  "personalInfo": {"name": "", "email": "", "phone": "", "location": ""},
  "education": [{"school": "", "degree": "", "field": "", "graduationYear": ""}],
  "experience": [{"company": "", "position": "", "duration": "", "responsibilities": []}],
  "skills": []
}`;

    const enhancement = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: 'You are a professional resume writer. Enhance resume content to be more professional and impactful. Return only valid JSON, no markdown.',
      messages: [{ role: 'user', content: enhancementPrompt }],
    });

    const enhancedJson = enhancement.content[0].text.trim();
    const cleanJson = enhancedJson.replace(/```json\n?|\n?```/g, '');
    const enhancedData = JSON.parse(cleanJson);

    console.log('✅ Resume enhanced successfully');
    return enhancedData;

  } catch (error) {
    console.error('⚠️ Error enhancing resume, using original:', error.message);
    // Return original data if enhancement fails
    return resumeData;
  }
}

/**
 * Save resume to Supabase
 */
async function saveResumeToSupabase(userId, resumeData) {
  try {
    // ✨ Enhance resume with AI before saving
    const enhancedResumeData = await enhanceResumeWithAI(resumeData);

    const parsedData = {
      personalInfo: enhancedResumeData.personalInfo,
      education: enhancedResumeData.education,
      experience: enhancedResumeData.experience,
      skills: enhancedResumeData.skills,
      source: 'ai_assistant',
      generatedAt: new Date().toISOString()
    };

    const timestamp = Date.now();
    const sanitizedName = (resumeData.personalInfo.name || 'user')
      .replace(/[^a-zA-Z0-9]/g, '-')
      .toLowerCase();

    // Generate PDF with enhanced data
    const { generateResumePDF } = await import('../utils/pdf-generator.js');
    const pdfBuffer = await generateResumePDF(enhancedResumeData);

    // Upload PDF
    const pdfFileName = `${sanitizedName}-${timestamp}.pdf`;
    const pdfPath = `resumes/${userId}/${pdfFileName}`;

    const { data: uploadData, error: uploadError } = await getSupabase().storage
      .from('resumes')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('PDF upload error:', uploadError);
      throw uploadError;
    }

    const { data: { publicUrl } } = getSupabase().storage
      .from('resumes')
      .getPublicUrl(pdfPath);

    console.log('PDF uploaded successfully:', publicUrl);

    // Insert resume record
    const { data, error } = await supabase
      .from('resume')
      .insert({
        user_id: userId,
        file_name: pdfFileName,
        file_path: pdfPath,
        file_size: pdfBuffer.length,
        file_type: 'application/pdf',
        raw_text: generateResumeText(enhancedResumeData),
        parsed_data: parsedData,
        version: 1,
        is_primary: true,
        parsing_status: 'completed',
        parsed_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      await getSupabase().storage.from('resumes').remove([pdfPath]);
      throw error;
    }

    console.log('Resume saved to database:', data.id);

    return {
      resumeId: data.id,
      pdfUrl: publicUrl,
      fileName: pdfFileName
    };

  } catch (error) {
    console.error('Error saving resume:', error);
    throw error;
  }
}

function generateResumeText(resumeData) {
  let text = '';

  if (resumeData.personalInfo.name) text += `${resumeData.personalInfo.name}\n`;
  if (resumeData.personalInfo.email) text += `${resumeData.personalInfo.email}\n`;
  if (resumeData.personalInfo.phone) text += `${resumeData.personalInfo.phone}\n`;
  if (resumeData.personalInfo.location) text += `${resumeData.personalInfo.location}\n`;
  text += '\n';

  if (resumeData.education.length > 0) {
    text += 'EDUCATION\n---------\n';
    resumeData.education.forEach(edu => {
      text += `${edu.degree} in ${edu.field}\n${edu.school}`;
      if (edu.graduationYear) text += ` - ${edu.graduationYear}`;
      text += '\n\n';
    });
  }

  if (resumeData.experience.length > 0) {
    text += 'EXPERIENCE\n----------\n';
    resumeData.experience.forEach(exp => {
      text += `${exp.position} at ${exp.company}\n`;
      if (exp.duration) text += `${exp.duration}\n`;
      if (exp.responsibilities && exp.responsibilities.length > 0) {
        exp.responsibilities.forEach(resp => text += `• ${resp}\n`);
      }
      text += '\n';
    });
  }

  if (resumeData.skills.length > 0) {
    text += 'SKILLS\n------\n';
    text += resumeData.skills.join(', ') + '\n';
  }

  return text;
}

// ── Autofill API endpoints (called by Chrome extension) ──────────────────────

// POST /api/ai-resume/copilot/answer
// Answers an open-ended job application question using the user's profile
router.post('/copilot/answer', requireAuth, async (req, res) => {
  try {
    const { question, jobDescription, profile, learnedAnswers } = req.body;
    if (!question) return res.status(400).json({ error: 'question required' });

    const learnedCtx = learnedAnswers && Object.keys(learnedAnswers).length > 0
      ? `\n\nUser's previously entered answers on job applications (treat as the user's known preferences):\n${
          Object.entries(learnedAnswers).map(([q, a]) => `- ${q}: ${a}`).join('\n')
        }`
      : '';

    const completion = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: `You are a professional job application assistant. Answer the given job application question concisely and professionally in first person, using the candidate's profile. Write 2-4 sentences max. Do not include any preamble like "Here is my answer:" — just the answer itself.`,
      messages: [{
        role: 'user',
        content: `Candidate profile:\n${JSON.stringify(profile || {})}\n\nJob description context:\n${(jobDescription || '').slice(0, 800)}${learnedCtx}\n\nQuestion: ${question}`,
      }],
    });
    incrementAiUsage(req.user.id);
    res.json({ answer: completion.content[0].text.trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ai-resume/copilot/pick-option
// Closed-set classification: given a field label and its exact option list,
// return only the index of the best match (or -1). Used as a fallback when
// the extension's local heuristic matching (substring/prefix) can't confidently
// pick an option for a dropdown/combobox — replaces the old approach of asking
// for free text and fuzzy-matching it back onto an option string.
router.post('/copilot/pick-option', requireAuth, async (req, res) => {
  try {
    const { label, options, profile, jobDescription } = req.body;
    if (!label) return res.status(400).json({ error: 'label required' });
    if (!Array.isArray(options) || options.length === 0) return res.status(400).json({ error: 'options required' });

    const numbered = options.map((o, i) => `${i}: ${o}`).join('\n');
    const completion = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      system: `You are matching a job application form field to one of a fixed list of dropdown options. Given the field's label and the candidate's profile, respond with ONLY the number of the single best-matching option, and nothing else — no words, no punctuation. If none of the options are a reasonable match, respond with -1.`,
      messages: [{
        role: 'user',
        content: `Candidate profile:\n${JSON.stringify(profile || {})}\n\nJob description context:\n${(jobDescription || '').slice(0, 500)}\n\nField label: ${label}\n\nOptions:\n${numbered}\n\nRespond with only the index number.`,
      }],
    });
    incrementAiUsage(req.user.id);

    const raw = completion.content[0].text.trim();
    const index = parseInt(raw.match(/-?\d+/)?.[0], 10);
    if (Number.isNaN(index) || index < -1 || index >= options.length) {
      return res.status(422).json({ error: `model returned unusable index: "${raw}"` });
    }
    res.json({ index });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ai-resume/resume/tailor
// Returns a base64-encoded tailored PDF resume for a specific job
router.post('/resume/tailor', requireAuth, async (req, res) => {
  try {
    const { jobDescription, jobTitle, profile } = req.body;
    if (!profile) return res.status(400).json({ error: 'profile required' });
    if (!profile.resume) {
      return res.status(400).json({ error: 'no_resume', message: 'Add your resume text in the extension settings before tailoring.' });
    }

    const { generateResumePDF } = await import('../utils/pdf-generator.js');

    const basePersonalInfo = {
      name: `${profile.firstName || ''} ${profile.lastName || ''}`.trim(),
      email: profile.email || '',
      phone: profile.phone || '',
      location: [profile.city, profile.state].filter(Boolean).join(', '),
    };
    const baseEducation = (profile.schoolName || profile.educationLevel) ? [{
      school: profile.schoolName,
      degree: profile.educationLevel,
      field: profile.fieldOfStudy,
      graduationYear: profile.graduationYear,
    }] : [];

    const tailorPrompt = `You are a professional resume writer. Parse the candidate's raw resume text below into fully structured JSON, then lightly tailor the emphasis (which bullets/skills are surfaced first, wording of bullets) toward the target job — without inventing any experience, employer, title, or skill that isn't already present in the raw text.

RULES:
1. Parse EVERY job/employer in the raw resume into its own separate entry in "experience" — never collapse multiple jobs into one entry, never use a placeholder like "See resume" as a position or company.
2. Break each job's content into several short, concrete bullet points — never paste a large block of raw text as a single bullet.
3. Keep all factual details (companies, titles, dates, technologies) truthful and unchanged — only rewrite wording/order for clarity and relevance to the target job.
4. Surface skills and bullets most relevant to the target job first, but still include the candidate's other real experience — don't drop employers just because they're less relevant.
5. Return ONLY valid JSON, no markdown, in exactly this structure:
{"personalInfo":{"name":"","email":"","phone":"","location":""},"education":[{"school":"","degree":"","field":"","graduationYear":""}],"experience":[{"company":"","position":"","duration":"","responsibilities":[]}],"skills":[]}

Candidate's known contact/education info (use this, don't re-derive from the resume text unless it's missing here):
${JSON.stringify({ personalInfo: basePersonalInfo, education: baseEducation })}

Target job title: ${jobTitle || '(not specified)'}
Target job description:
${(jobDescription || '').slice(0, 3000)}

Candidate's raw resume text:
${profile.resume.slice(0, 8000)}`;

    const tailored = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: 'You are a professional resume writer. Return only valid JSON, no markdown, no commentary.',
      messages: [{ role: 'user', content: tailorPrompt }],
    });

    const rawJson = tailored.content[0].text.trim().replace(/```json\n?|\n?```/g, '');
    const resumeData = JSON.parse(rawJson);
    resumeData.personalInfo = { ...basePersonalInfo, ...resumeData.personalInfo };
    if (!resumeData.education?.length) resumeData.education = baseEducation;

    const pdfBuffer = await generateResumePDF(resumeData);
    const pdf = pdfBuffer.toString('base64');
    const safeTitle = (jobTitle || 'resume').replace(/[^a-z0-9]/gi, '_').slice(0, 40);
    const filename = `${(profile.firstName || 'Resume')}_${safeTitle}.pdf`;

    incrementAiUsage(req.user.id);
    res.json({ pdf, filename });
  } catch (e) {
    console.error('[resume/tailor]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Job fit check ─────────────────────────────────────────────────────────────
// Deterministic hard-blocker phrases in a job posting, only surfaced when the
// candidate's own profile says they need sponsorship — these almost always
// mean "US citizens/permanent residents only" in practice, regardless of how
// good a skills match the role is.
const CITIZENSHIP_RE = /\b(u\.?s\.?\s*citizen(ship)?|united states citizen(ship)?)\b/i;
const CLEARANCE_RE = /\b(security clearance|ts\/sci|top secret clearance|active clearance|polygraph)\b/i;
const NO_SPONSOR_RE = /\b(no(t)?\s+(currently\s+)?(provide|offer)\s+visa sponsorship|unable to sponsor|not able to sponsor|without sponsorship|does not sponsor|do not sponsor|not sponsoring)\b/i;

// Degree requirement vs. the candidate's own highest degree (see the
// educationLevel <select> in options.html for the exact values this
// compares against). Rank is by typical hiring-bar strictness, not
// prestige — an MBA doesn't "beat" a PhD requirement, for example, so
// each requirement phrase is matched against its own specific rank only.
const DEGREE_RANK = {
  "high school diploma": 1, "associate's degree": 2, "bachelor's degree": 3,
  "master's degree": 4, mba: 4, doctorate: 5,
};
const DEGREE_REQUIREMENT_RE = /\b(bachelor'?s?|master'?s?|phd|doctorate|mba)\s+degree\s+(is\s+)?required\b|\brequires?\s+(a\s+)?(bachelor'?s?|master'?s?|phd|doctorate|mba)\s+degree\b|\bmust have\s+(a\s+)?(bachelor'?s?|master'?s?|phd|doctorate|mba)\s+degree\b/i;
const DEGREE_WORD_RANK = { "bachelor's": 3, bachelors: 3, bachelor: 3, "master's": 4, masters: 4, master: 4, phd: 5, doctorate: 5, mba: 4 };

// A rough "$120,000 - $150,000" / "$120k-$150k" style range in the posting.
const SALARY_RANGE_RE = /\$\s?([\d,]+)(k)?\s*(?:-|–|to)\s*\$?\s?([\d,]+)(k)?/i;
function normalizeSalaryAmount(numStr, kFlag) {
  const n = parseInt(numStr.replace(/,/g, ''), 10);
  return kFlag ? n * 1000 : n;
}

router.post('/job-fit', requireAuth, async (req, res) => {
  try {
    const { jobDescription, jobTitle, profile } = req.body;
    if (!jobDescription) return res.status(400).json({ error: 'jobDescription required' });

    const needsSponsorship = (profile?.sponsorship || '').trim().toLowerCase() === 'yes';
    const blockers = [];
    if (needsSponsorship) {
      if (CITIZENSHIP_RE.test(jobDescription)) blockers.push('Requires US citizenship');
      if (CLEARANCE_RE.test(jobDescription)) blockers.push('Requires a security clearance');
      if (NO_SPONSOR_RE.test(jobDescription)) blockers.push("Employer states they don't sponsor visas");
    }

    // Location mismatch: a clear non-US place name in the JD, with no
    // remote/hybrid/relocation language nearby, while the candidate's own
    // profile location resolves to the US (or is unset — most postings a
    // US-based user encounters are US roles, so silence isn't a signal).
    //
    // US federal/defense-contractor postings almost universally include an
    // EEO clause citing VEVRAA ("Vietnam Era Veterans' Readjustment
    // Assistance Act") or similar "protected veteran"/"Vietnam era veteran"
    // legal boilerplate — that's a false-positive "Vietnam" match with
    // nothing to do with job location, so skip any match sitting near the
    // word "veteran".
    const profileCountry = (profile?.country || '').trim().toLowerCase();
    const candidateIsUS = !profileCountry || ['us', 'usa', 'united states', 'u.s.', 'u.s.a.'].includes(profileCountry);
    if (candidateIsUS) {
      const nonUsMatch = jobDescription.match(nonUsTextRegexJs());
      const mentionsRemoteOrRelocation = /\b(remote|hybrid|relocat|work from anywhere|anywhere in the (us|u\.s\.))\b/i.test(jobDescription);
      const nearVeteranBoilerplate = nonUsMatch &&
        /veteran/i.test(jobDescription.slice(Math.max(0, nonUsMatch.index - 40), nonUsMatch.index + nonUsMatch[0].length + 40));
      if (nonUsMatch && !mentionsRemoteOrRelocation && !nearVeteranBoilerplate) {
        blockers.push(`Location appears to be ${nonUsMatch[1]}, not remote/US-relocatable`);
      }
    }

    // Degree requirement vs. candidate's highest degree on file.
    const candidateDegree = (profile?.educationLevel || '').trim().toLowerCase();
    const candidateRank = DEGREE_RANK[candidateDegree] ?? null;
    const degreeMatch = jobDescription.match(DEGREE_REQUIREMENT_RE);
    if (candidateRank !== null && degreeMatch) {
      // Group indices: alt1 captures the degree word in group 1; alt2 and
      // alt3 each have a leading optional "(a )?" group before their degree
      // word, in groups 4 and 6 respectively.
      const word = (degreeMatch[1] || degreeMatch[4] || degreeMatch[6] || '').toLowerCase().replace(/'?s$/, "'s");
      const requiredRank = DEGREE_WORD_RANK[word] ?? DEGREE_WORD_RANK[word.replace(/'s$/, '')];
      if (requiredRank && requiredRank > candidateRank) {
        blockers.push(`Requires a ${word} degree`);
      }
    }

    // Salary floor: posting's upper bound below the candidate's stated minimum.
    const candidateMin = parseInt((profile?.salary || '').replace(/[^0-9]/g, ''), 10);
    const salaryMatch = jobDescription.match(SALARY_RANGE_RE);
    if (Number.isFinite(candidateMin) && candidateMin > 0 && salaryMatch) {
      const upper = normalizeSalaryAmount(salaryMatch[3], salaryMatch[4]);
      if (upper > 0 && upper < candidateMin) {
        blockers.push(`Posted salary range tops out below your $${candidateMin.toLocaleString()} minimum`);
      }
    }

    let fitScore = null;
    let fitSummary = '';
    try {
      const completion = await getAnthropic().messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: 'You are scoring how well a candidate\'s background fits a job posting. Return ONLY valid JSON, no markdown: {"fitScore": <integer 0-100>, "summary": "<one short sentence on the biggest gap or strength>"}. Be realistic — a generic/unrelated background should score low, don\'t default to a generous middle score.',
        messages: [{
          role: 'user',
          content: `Job title: ${jobTitle || '(unknown)'}\nJob description:\n${jobDescription.slice(0, 3000)}\n\nCandidate background:\n${(profile?.background || '').slice(0, 1000)}\n\nCandidate resume:\n${(profile?.resume || '').slice(0, 3000)}`,
        }],
      });
      const raw = completion.content[0].text.trim().replace(/```json\n?|\n?```/g, '');
      const parsed = JSON.parse(raw);
      if (Number.isFinite(parsed.fitScore)) fitScore = Math.max(0, Math.min(100, Math.round(parsed.fitScore)));
      fitSummary = parsed.summary || '';
    } catch (e) {
      console.error('[job-fit] scoring failed:', e.message);
    }

    incrementAiUsage(req.user.id);
    res.json({ fitScore, fitSummary, blockers });
  } catch (e) {
    console.error('[job-fit]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Profile sync from extension ──────────────────────────────────────────────
// Fetch saved profile for the signed-in user
router.get('/profile/sync', requireAuth, async (req, res) => {
  try {
    const sb = getSupabase();
    const { data } = await sb.from('user_profile')
      .select('autofill_data')
      .eq('user_id', req.user.id)
      .single();
    res.json({ profile: data?.autofill_data || null });
  } catch (e) {
    res.json({ profile: null });
  }
});

// Called when user saves their profile in the extension options page
router.post('/profile/sync', requireAuth, async (req, res) => {
  try {
    const { profile } = req.body;
    if (!profile) return res.status(400).json({ error: 'profile required' });
    const sb = getSupabase();
    await sb.from('user_profile').upsert({
      user_id: req.user.id,
      autofill_data: profile,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    // Recompute signals with fresh profile data
    recomputeSignals(req.user.id).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Job application tracker ───────────────────────────────────────────────────
router.post('/applications/track', requireAuth, async (req, res) => {
  try {
    const { jobUrl, jobTitle, company, fieldCount, aiUsed, filled, skipped, errors } = req.body;
    if (!jobUrl) return res.status(400).json({ error: 'jobUrl required' });

    const sb = getSupabase();
    const jobId = await resolveJobIdForUrl(jobUrl);
    const { data, error } = await sb.from('job_applications').insert({
      user_id:        req.user.id,
      job_url:        jobUrl,
      job_title:      jobTitle || null,
      company:        company  || null,
      job_id:         jobId,
      field_count:    fieldCount || 0,
      ai_used:        !!aiUsed,
      fields_filled:  filled  || 0,
      fields_skipped: skipped || 0,
      fields_errored: errors  || 0,
    }).select('id').single();

    if (error) throw error;
    // Recompute signals async — don't block the response
    recomputeSignals(req.user.id).catch(() => {});
    res.json({ ok: true, id: data.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List applications for the signed-in user
router.get('/applications', requireAuth, async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('job_applications')
      .select('id, job_url, job_title, company, fields_filled, fields_skipped, fields_errored, ai_used, submitted, submitted_at, filled_at')
      .eq('user_id', req.user.id)
      .order('filled_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    res.json({ applications: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Self-report: did the application actually submit?
router.patch('/applications/:id/report', requireAuth, async (req, res) => {
  try {
    const { submitted } = req.body;
    if (typeof submitted !== 'boolean') return res.status(400).json({ error: 'submitted must be boolean' });

    const sb = getSupabase();
    const { error } = await sb.from('job_applications')
      .update({ submitted, submitted_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cleanup old conversations (every hour)
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  for (const [id, conversation] of conversations.entries()) {
    const age = now - new Date(conversation.startedAt).getTime();
    if (age > maxAge) {
      conversations.delete(id);
      console.log(`Cleaned up old conversation: ${id}`);
    }
  }
}, 60 * 60 * 1000); // Run every hour

// GET /api/ai-resume/usage — returns ai_calls count and free tier limit
const FREE_AI_LIMIT = 25;
router.get('/usage', requireAuth, async (req, res) => {
  try {
    const sb = getSupabase();
    const { data } = await sb.from('user_usage').select('ai_calls, last_ai_call').eq('user_id', req.user.id).single();
    const used = data?.ai_calls || 0;
    res.json({
      ai_calls_used: used,
      ai_calls_limit: FREE_AI_LIMIT,
      ai_calls_remaining: Math.max(0, FREE_AI_LIMIT - used),
      is_over_limit: used >= FREE_AI_LIMIT,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Extension heartbeat — called once per day from mount.js to track active installs
router.post('/ping', requireAuth, async (req, res) => {
  try {
    const { db } = await import('../db/index.js');
    await db.query(
      `INSERT INTO user_usage (user_id, extension_seen_at, extension_first_seen)
       VALUES ($1, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         extension_seen_at = NOW(),
         extension_first_seen = COALESCE(user_usage.extension_first_seen, NOW())`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
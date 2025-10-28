// routes/ai-resume.js - ES Module version for existing project
import express from 'express';
import { OpenAI } from 'openai';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// In-memory conversation storage (use Redis in production)
const conversations = new Map();

// System prompt
const SYSTEM_PROMPT = `You are a professional resume building assistant. Your role is to help users create a complete professional resume through conversation.

RULES:
1. Ask ONE clear, specific question at a time
2. Keep responses short (2-3 sentences maximum)
3. Be encouraging and friendly
4. Ask follow-up questions for clarity
5. Extract structured information as you go
6. Guide users through these sections in order:
   - Personal info (name, email, phone, location)
   - Education (school, degree, field, graduation year)
   - Work experience (company, position, duration, key responsibilities)
   - Skills (technical skills, tools, languages)

CONVERSATION FLOW:
- Start with: "Hi! I'm your AI resume assistant. Let's build your professional resume together. What's your full name?"
- After each answer, acknowledge briefly and ask the next question
- If answer is unclear, ask for clarification
- When a section is complete, move to the next

Current conversation stage: [Will be injected dynamically]`;

/**
 * POST /api/ai-resume/start
 */
router.post('/start', async (req, res) => {
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
router.post('/chat', async (req, res) => {
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

    const messages = [
      {
        role: 'system',
        content: SYSTEM_PROMPT + `\nCurrent stage: ${conversation.stage}\nCurrent data collected: ${JSON.stringify(conversation.resumeData)}`
      },
      ...conversation.messages.map(m => ({
        role: m.role,
        content: m.content
      }))
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      temperature: 0.7,
      max_tokens: 200,
      presence_penalty: 0.6,
      frequency_penalty: 0.3
    });

    let aiResponse = completion.choices[0].message.content;

    conversation.messages.push({
      role: 'assistant',
      content: aiResponse,
      timestamp: new Date().toISOString()
    });

    const extractedData = await extractResumeData(conversation.messages);
    conversation.resumeData = mergeResumeData(conversation.resumeData, extractedData);
    conversation.stage = determineStage(conversation.resumeData);

    let progress = calculateProgress(conversation.resumeData);
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

    const extraction = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Extract resume information and return ONLY valid JSON with this structure:
{
  "personalInfo": {"name": "", "email": "", "phone": "", "location": ""},
  "education": [{"school": "", "degree": "", "field": "", "graduationYear": ""}],
  "experience": [{"company": "", "position": "", "duration": "", "responsibilities": []}],
  "skills": []
}
Only include fields that were mentioned. Return valid JSON only.`
        },
        {
          role: 'user',
          content: `Extract resume data:\n\n${conversationText}`
        }
      ],
      temperature: 0.2,
      max_tokens: 500
    });

    const jsonString = extraction.choices[0].message.content.trim();
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

function determineStage(resumeData) {
  const hasPersonalInfo = resumeData.personalInfo.name && resumeData.personalInfo.email;
  const hasEducation = resumeData.education.length > 0;
  const hasExperience = resumeData.experience.length > 0;
  const hasSkills = resumeData.skills.length > 0;

  if (!hasPersonalInfo) return 'personal_info';
  if (!hasEducation) return 'education';
  if (!hasExperience) return 'experience';
  if (!hasSkills) return 'skills';
  return 'complete';
}

// ⭐ FIXED: Progress calculation now reaches 100%
function calculateProgress(resumeData) {
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

  return Math.min(progress, 1.0);
}

/**
 * Save resume to Supabase
 */
async function saveResumeToSupabase(userId, resumeData) {
  try {
    const parsedData = {
      personalInfo: resumeData.personalInfo,
      education: resumeData.education,
      experience: resumeData.experience,
      skills: resumeData.skills,
      source: 'ai_assistant',
      generatedAt: new Date().toISOString()
    };

    const timestamp = Date.now();
    const sanitizedName = (resumeData.personalInfo.name || 'user')
      .replace(/[^a-zA-Z0-9]/g, '-')
      .toLowerCase();

    // Generate PDF
    const { generateResumePDF } = await import('../utils/pdf-generator.js');
    const pdfBuffer = await generateResumePDF(resumeData);

    // Upload PDF
    const pdfFileName = `${sanitizedName}-${timestamp}.pdf`;
    const pdfPath = `resumes/${userId}/${pdfFileName}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
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

    const { data: { publicUrl } } = supabase.storage
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
        raw_text: generateResumeText(resumeData),
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
      await supabase.storage.from('resumes').remove([pdfPath]);
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

export default router;
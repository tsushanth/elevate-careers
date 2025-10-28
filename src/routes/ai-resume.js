// routes/ai-resume.js
const express = require('express');
const router = express.Router();
const { OpenAI } = require('openai');
const { createClient } = require('@supabase/supabase-js');

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // Use service key for admin operations
);

// In-memory conversation storage (use Redis in production)
const conversations = new Map();

// System prompt that guides the AI
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
- Provide suggestions when appropriate (e.g., "Many candidates highlight their leadership experience here")
- When a section is complete, move to the next: "Great! Now let's talk about your education..."

IMPORTANT:
- Be conversational, not robotic
- Celebrate progress: "Awesome! We're making great progress."
- If user says "skip" or "none", move to next question
- Keep track of what information you still need

Current conversation stage: [Will be injected dynamically]`;

/**
 * POST /api/ai-resume/start
 * Start a new AI resume building conversation
 */
router.post('/start', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Generate conversation ID
    const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Initialize conversation
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
      stage: 'personal_info', // personal_info, education, experience, skills, complete
      startedAt: new Date().toISOString()
    };

    // Store conversation
    conversations.set(conversationId, conversation);

    // Get first message from AI
    const welcomeMessage = "Hi! I'm your AI resume assistant. Let's build your professional resume together. What's your full name?";

    // Add to conversation history
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
 * Continue the conversation
 */
router.post('/chat', async (req, res) => {
  try {
    const { conversationId, message, userId } = req.body;

    if (!conversationId || !message || !userId) {
      return res.status(400).json({ error: 'conversationId, message, and userId are required' });
    }

    // Get conversation
    const conversation = conversations.get(conversationId);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Verify user owns this conversation
    if (conversation.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Add user message to history
    conversation.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date().toISOString()
    });

    // Prepare messages for ChatGPT
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

    // Call ChatGPT
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // More cost-effective than gpt-4
      messages: messages,
      temperature: 0.7,
      max_tokens: 200, // Keep responses short
      presence_penalty: 0.6,
      frequency_penalty: 0.3
    });

    const aiResponse = completion.choices[0].message.content;

    // Add AI response to history
    conversation.messages.push({
      role: 'assistant',
      content: aiResponse,
      timestamp: new Date().toISOString()
    });

    // Extract structured data from conversation
    const extractedData = await extractResumeData(conversation.messages);

    // Merge extracted data with existing data
    conversation.resumeData = mergeResumeData(conversation.resumeData, extractedData);

    // Update conversation stage
    conversation.stage = determineStage(conversation.resumeData);

    // Calculate progress
    const progress = calculateProgress(conversation.resumeData);
    const isComplete = progress >= 1.0 || conversation.stage === 'complete';

    // If complete, save to Supabase and send final message
    let resumeId = null;
    let pdfUrl = null;
    let fileName = null;
    
    if (isComplete && !conversation.savedToDb) {
      try {
        const result = await saveResumeToSupabase(userId, conversation.resumeData);
        resumeId = result.resumeId;
        pdfUrl = result.pdfUrl;
        fileName = result.fileName;
        
        conversation.savedToDb = true;
        conversation.resumeId = resumeId;
        conversation.pdfUrl = pdfUrl;
        
        console.log('✅ Resume completed and saved:', { resumeId, pdfUrl, fileName });
      } catch (saveError) {
        console.error('Error saving resume:', saveError);
        // Continue anyway, just log the error
      }
    }

    // Update conversation in storage
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
 * Extract structured resume data from conversation using ChatGPT
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
          content: `Extract resume information from the conversation and return ONLY valid JSON with this exact structure:
{
  "personalInfo": {
    "name": "",
    "email": "",
    "phone": "",
    "location": ""
  },
  "education": [
    {
      "school": "",
      "degree": "",
      "field": "",
      "graduationYear": ""
    }
  ],
  "experience": [
    {
      "company": "",
      "position": "",
      "duration": "",
      "responsibilities": []
    }
  ],
  "skills": []
}

Rules:
- Only include fields that were explicitly mentioned
- Leave empty strings for missing data
- Return valid JSON only, no additional text
- If a field wasn't discussed, use empty string or empty array
- For skills, extract individual skills as separate items`
        },
        {
          role: 'user',
          content: `Extract resume data from this conversation:\n\n${conversationText}`
        }
      ],
      temperature: 0.2, // Low temperature for consistent extraction
      max_tokens: 500
    });

    const jsonString = extraction.choices[0].message.content.trim();
    // Remove markdown code blocks if present
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

/**
 * Merge extracted data with existing data
 */
function mergeResumeData(existing, extracted) {
  return {
    personalInfo: {
      ...existing.personalInfo,
      ...extracted.personalInfo
    },
    education: extracted.education.length > 0 ? extracted.education : existing.education,
    experience: extracted.experience.length > 0 ? extracted.experience : existing.experience,
    skills: extracted.skills.length > 0 ? extracted.skills : existing.skills
  };
}

/**
 * Determine current stage based on collected data
 */
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

/**
 * Calculate completion progress (0.0 to 1.0)
 */
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
 * Save resume to Supabase using existing resume table
 * Generates PDF and uploads to Supabase Storage
 */
async function saveResumeToSupabase(userId, resumeData) {
  try {
    // Format the parsed_data JSONB field
    const parsedData = {
      personalInfo: resumeData.personalInfo,
      education: resumeData.education,
      experience: resumeData.experience,
      skills: resumeData.skills,
      source: 'ai_assistant',
      generatedAt: new Date().toISOString()
    };

    // Generate timestamp for file naming
    const timestamp = Date.now();
    const sanitizedName = (resumeData.personalInfo.name || 'user')
      .replace(/[^a-zA-Z0-9]/g, '-')
      .toLowerCase();

    // Generate PDF
    const { generateResumePDF } = require('../utils/pdf-generator');
    const pdfBuffer = await generateResumePDF(resumeData);

    // Upload PDF to Supabase Storage
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

    // Get public URL for the PDF
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
      // Try to delete uploaded PDF if insert fails
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

/**
 * Generate plain text version of resume for raw_text field
 */
function generateResumeText(resumeData) {
  let text = '';

  // Personal Info
  if (resumeData.personalInfo.name) {
    text += `${resumeData.personalInfo.name}\n`;
  }
  if (resumeData.personalInfo.email) {
    text += `${resumeData.personalInfo.email}\n`;
  }
  if (resumeData.personalInfo.phone) {
    text += `${resumeData.personalInfo.phone}\n`;
  }
  if (resumeData.personalInfo.location) {
    text += `${resumeData.personalInfo.location}\n`;
  }
  text += '\n';

  // Education
  if (resumeData.education.length > 0) {
    text += 'EDUCATION\n';
    text += '---------\n';
    resumeData.education.forEach(edu => {
      text += `${edu.degree} in ${edu.field}\n`;
      text += `${edu.school}`;
      if (edu.graduationYear) {
        text += ` - ${edu.graduationYear}`;
      }
      text += '\n\n';
    });
  }

  // Experience
  if (resumeData.experience.length > 0) {
    text += 'EXPERIENCE\n';
    text += '----------\n';
    resumeData.experience.forEach(exp => {
      text += `${exp.position} at ${exp.company}\n`;
      if (exp.duration) {
        text += `${exp.duration}\n`;
      }
      if (exp.responsibilities && exp.responsibilities.length > 0) {
        exp.responsibilities.forEach(resp => {
          text += `• ${resp}\n`;
        });
      }
      text += '\n';
    });
  }

  // Skills
  if (resumeData.skills.length > 0) {
    text += 'SKILLS\n';
    text += '------\n';
    text += resumeData.skills.join(', ');
    text += '\n';
  }

  return text;
}

/**
 * GET /api/ai-resume/conversation/:conversationId
 * Get conversation details
 */
router.get('/conversation/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { userId } = req.query;

    const conversation = conversations.get(conversationId);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (conversation.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    res.json({
      conversationId: conversation.id,
      messages: conversation.messages,
      resumeData: conversation.resumeData,
      progress: calculateProgress(conversation.resumeData),
      isComplete: conversation.stage === 'complete',
      resumeId: conversation.resumeId
    });

  } catch (error) {
    console.error('Error getting conversation:', error);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
});

/**
 * DELETE /api/ai-resume/conversation/:conversationId
 * Delete conversation (cleanup)
 */
router.delete('/conversation/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { userId } = req.query;

    const conversation = conversations.get(conversationId);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (conversation.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    conversations.delete(conversationId);

    res.json({ success: true });

  } catch (error) {
    console.error('Error deleting conversation:', error);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// Cleanup old conversations (run periodically)
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  for (const [id, conversation] of conversations.entries()) {
    const age = now - new Date(conversation.startedAt).getTime();
    if (age > maxAge) {
      conversations.delete(id);
      console.log(`Cleaned up conversation: ${id}`);
    }
  }
}, 60 * 60 * 1000); // Run every hour

module.exports = router;
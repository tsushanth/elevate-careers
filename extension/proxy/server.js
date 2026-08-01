#!/usr/bin/env node
// Local proxy — keeps the Anthropic API key off the extension
// Run: ANTHROPIC_API_KEY=sk-... node server.js
// Extension calls http://localhost:7821/answer

import http from 'http';

const PORT = 7821;
const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }

const SYSTEM = `You are filling in a job application on behalf of the applicant.
Answer the specific question asked using the applicant's background and the job description.
Be concise, genuine, and specific — 2-4 sentences for short answers, up to 200 words for essays.
Write in first person naturally, as the applicant.
Do not invent facts not in the background. Do not mention visa or immigration.`;

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST' || req.url !== '/answer') {
    res.writeHead(404); res.end('not found'); return;
  }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      const { question, jobDescription, profile } = JSON.parse(body);
      const userMsg = `Job description:\n${jobDescription}\n\nApplicant background:\n${profile.background}\n\nResume:\n${profile.resume}\n\nQuestion to answer:\n${question}`;

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          system: SYSTEM,
          messages: [{ role: 'user', content: userMsg }],
        }),
      });

      const data = await r.json();
      const answer = data.content?.[0]?.text ?? '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ answer }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Autofill proxy running on http://localhost:${PORT}`));

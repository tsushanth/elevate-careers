import { serve } from '@hono/node-server';
import Anthropic from '@anthropic-ai/sdk';
import { createApp } from './app.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app = createApp({ legacyToken: process.env.AUTH_TOKEN, claudeClient: client });

const PORT = parseInt(process.env.PORT || '8080');
serve({ fetch: app.fetch, port: PORT });
console.log(`autofill-api running on :${PORT}`);

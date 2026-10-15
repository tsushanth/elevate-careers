import { serve } from '@hono/node-server';
import { trackedAnthropic, installShutdownFlush } from './llm.js';
import { createApp } from './app.js';

const client = trackedAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
installShutdownFlush();
const app = createApp({ legacyToken: process.env.AUTH_TOKEN, claudeClient: client });

const PORT = parseInt(process.env.PORT || '8080');
serve({ fetch: app.fetch, port: PORT });
console.log(`autofill-api running on :${PORT}`);

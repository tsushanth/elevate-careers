import { GreenhouseAdapter } from './greenhouse.js';
import { LeverAdapter } from './lever.js';
import { JSONLDAdapter } from './jsonld.js';
import { AshbyAdapter } from './ashby.js';
import { SmartRecruitersAdapter } from './smartrecruiters.js';
import { logger } from '../utils/logger.js';

const adapters = {
  greenhouse: new GreenhouseAdapter(),
  lever: new LeverAdapter(),
  jsonld: new JSONLDAdapter(),
  ashby: new AshbyAdapter(),
  smartrecruiters: new SmartRecruitersAdapter(),
};

export function getAdapter(provider) {
  const adapter = adapters[provider.toLowerCase()];
  if (!adapter) {
    logger.error({ provider }, 'Unknown provider');
    throw new Error(`Unknown provider: ${provider}`);
  }
  return adapter;
}

export default getAdapter;
import { GreenhouseAdapter } from './greenhouse.js';
import { LeverAdapter } from './lever.js';
import { JSONLDAdapter } from './jsonld.js';
import { logger } from '../utils/logger.js';

const adapters = {
  greenhouse: new GreenhouseAdapter(),
  lever: new LeverAdapter(),
  jsonld: new JSONLDAdapter(),
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
import { GreenhouseAdapter } from './greenhouse.js';
import { LeverAdapter } from './lever.js';
import { JSONLDAdapter } from './jsonld.js';
import { AshbyAdapter } from './ashby.js';
import { SmartRecruitersAdapter } from './smartrecruiters.js';
import { WorkableAdapter } from './workable.js';
import { BambooHRAdapter } from './bamboohr.js';
import { RecruiteeAdapter } from './recruitee.js';
import { logger } from '../utils/logger.js';

const adapters = {
  greenhouse: new GreenhouseAdapter(),
  lever: new LeverAdapter(),
  jsonld: new JSONLDAdapter(),
  ashby: new AshbyAdapter(),
  smartrecruiters: new SmartRecruitersAdapter(),
  workable: new WorkableAdapter(),
  bamboohr: new BambooHRAdapter(),
  recruitee: new RecruiteeAdapter(),
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
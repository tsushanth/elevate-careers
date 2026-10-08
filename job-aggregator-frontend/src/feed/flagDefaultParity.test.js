import fs from 'fs';
import path from 'path';
import { FEED_V2_DEFAULT } from './flag';

const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');

test('index.html default agrees with FEED_V2_DEFAULT in flag.js', () => {
  const hasTrue = /window\.__FEED_V2_DEFAULT\s*=\s*true/.test(html);
  const hasAny = /window\.__FEED_V2_DEFAULT\s*=/.test(html);
  if (FEED_V2_DEFAULT === true) {
    expect(hasTrue).toBe(true);
  } else {
    expect(hasAny).toBe(false);
  }
});

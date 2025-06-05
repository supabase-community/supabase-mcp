import { statSync } from 'fs';
import { config } from 'dotenv';
import './test/extensions.js';

if (!process.env.CI) {
  const envPath = '.env.local';
  statSync(envPath);
  config({ path: envPath });
}

import { config } from 'dotenv';
import { existsSync } from 'fs';
import './test/extensions.js';

if (!process.env.CI) {
  const envPath = '.env.local';
  if (existsSync(envPath)) {
    config({ path: envPath });
  }
}

import { config } from 'dotenv';
import { statSync } from 'fs';

if (!process.env.CI) {
  const envPath = '.env.local';
  statSync(envPath);
  config({ path: envPath });
}

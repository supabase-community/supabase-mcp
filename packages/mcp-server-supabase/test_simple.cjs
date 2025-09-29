const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('=== Testing ~/.supabase Token Detection ===');

// Check ~/.supabase directory
const supabaseDir = path.join(os.homedir(), '.supabase');
console.log('\nChecking: ' + supabaseDir);

if (fs.existsSync(supabaseDir)) {
  console.log('✅ ~/.supabase directory exists');
  
  const files = fs.readdirSync(supabaseDir);
  console.log('Files found:', files);
  
  // Check for access-token file (highest priority)
  const accessTokenPath = path.join(supabaseDir, 'access-token');
  if (fs.existsSync(accessTokenPath)) {
    console.log('✅ access-token file found');
    try {
      const token = fs.readFileSync(accessTokenPath, 'utf-8').trim();
      console.log('Token (first 10 chars): ' + token.substring(0, 10) + '...');
      console.log('Token starts with sbp_: ' + token.startsWith('sbp_'));
    } catch (error) {
      console.log('❌ Error reading access-token:', error.message);
    }
  } else {
    console.log('❌ access-token file not found');
  }
} else {
  console.log('❌ ~/.supabase directory not found');
}

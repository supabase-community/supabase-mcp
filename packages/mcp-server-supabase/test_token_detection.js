import { resolveTokenFromConfig } from './dist/chunk-AH3TU75O.js';

async function testTokenDetection() {
  console.log('Testing ~/.supabase token detection...');
  
  const result = await resolveTokenFromConfig({ isClaudeCLI: true });
  
  console.log('Config result:', result.configResult);
  console.log('Tokens found:', result.tokens ? result.tokens.length : 0);
  console.log('Claude CLI guidance:', result.claudeCLIGuidance);
}

testTokenDetection().catch(console.error);

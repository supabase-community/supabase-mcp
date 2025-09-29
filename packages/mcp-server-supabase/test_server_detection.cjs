#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('=== Testing MCP Server Project Detection ===');

// Read access token
const token = fs.readFileSync(path.join(require('os').homedir(), '.supabase', 'access-token'), 'utf-8').trim();

// Test in different directories
const testDirs = [
  { name: 'Next.js App', path: 'test_projects/nextjs_app', expectedProject: 'testproject123' },
  { name: 'React App', path: 'test_projects/react_app', expectedProject: 'reactproject456' },
  { name: 'Supabase CLI Project', path: 'test_projects/supabase_cli_project', expectedProject: 'cliproject789' },
];

async function testDirectory(testDir) {
  return new Promise((resolve) => {
    console.log(`\n--- Testing: ${testDir.name} ---`);
    console.log(`Directory: ${testDir.path}`);

    const serverPath = path.resolve('dist/transports/stdio.js');
    const child = spawn('node', [serverPath, '--version'], {
      cwd: testDir.path,
      env: {
        ...process.env,
        SUPABASE_ACCESS_TOKEN: token,
        // Clear any other Supabase env vars to test project detection
        SUPABASE_URL: undefined,
        SUPABASE_ANON_KEY: undefined,
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      console.log(`Exit code: ${code}`);
      if (stdout) {
        console.log('STDOUT:', stdout.trim());
      }
      if (stderr) {
        console.log('STDERR:', stderr.trim());

        // Check if project was detected
        if (stderr.includes('Auto-detected project ID')) {
          const match = stderr.match(/Auto-detected project ID: (\w+)/);
          if (match && match[1] === testDir.expectedProject) {
            console.log(`✅ Project correctly detected: ${match[1]}`);
          } else {
            console.log(`❌ Expected ${testDir.expectedProject}, got ${match ? match[1] : 'none'}`);
          }
        }

        if (stderr.includes('Detected Supabase project')) {
          console.log('✅ Project context detected');
        }
      }
      resolve();
    });

    // Kill after 3 seconds
    setTimeout(() => {
      child.kill();
    }, 3000);
  });
}

async function runTests() {
  for (const testDir of testDirs) {
    await testDirectory(testDir);
  }
  console.log('\n=== MCP Server Detection Tests Complete ===');
}

runTests().catch(console.error);
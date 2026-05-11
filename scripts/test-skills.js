#!/usr/bin/env node
// @ts-check
/**
 * Test script for Skills
 */

const { spawn } = require('child_process');
const path = require('path');

async function testSkill(skillPath, skillName) {
  return new Promise((resolve, reject) => {
    console.log(`\n📦 Testing ${skillName}...`);
    
    const server = spawn('node', [skillPath]);
    let buffer = '';
    
    server.stderr.on('data', (data) => {
      console.log(`  ✅ ${data.toString().trim()}`);
    });
    
    // Send tools/list request
    const request = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    }) + '\n';
    
    server.stdin.write(request);
    
    server.stdout.on('data', (data) => {
      buffer += data.toString();
      try {
        const response = JSON.parse(buffer);
        if (response.result && response.result.tools) {
          console.log(`  ✅ Tools available:`);
          response.result.tools.forEach(tool => {
            console.log(`     - ${tool.name}`);
          });
          server.kill();
          resolve(true);
        }
      } catch (e) {
        // Continue collecting data
      }
    });
    
    server.on('error', (err) => {
      console.log(`  ❌ Error: ${err.message}`);
      reject(err);
    });
    
    setTimeout(() => {
      server.kill();
      reject(new Error('Timeout'));
    }, 5000);
  });
}

async function testGitHubFetch() {
  return new Promise((resolve, reject) => {
    console.log(`\n🔍 Testing GitHub Issue Fetch (Issue #30340)...`);
    
    const skillPath = path.join(__dirname, 'skills', 'github-issue-fetcher', 'index.js');
    const server = spawn('node', [skillPath]);
    let buffer = '';
    let initialized = false;
    
    server.stderr.on('data', () => {});
    
    server.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          
          if (response.id === 0) {
            // Initialize response received, send tool call
            initialized = true;
            const toolRequest = JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: {
                name: 'get_issue_context',
                arguments: {
                  repo: 'hashicorp/terraform-provider-azurerm',
                  number: 30340
                }
              }
            }) + '\n';
            server.stdin.write(toolRequest);
          } else if (response.id === 1) {
            // Tool response
            if (response.result && response.result.content) {
              const issueData = JSON.parse(response.result.content[0].text);
              console.log(`  ✅ Issue Title: ${issueData.title}`);
              console.log(`  ✅ State: ${issueData.state}`);
              console.log(`  ✅ Labels: ${issueData.labels.join(', ')}`);
              server.kill();
              resolve(true);
            } else if (response.error) {
              console.log(`  ⚠️  API Error: ${response.error.message || 'Unknown error'}`);
              console.log(`     (This is expected if no GITHUB_TOKEN is set)`);
              server.kill();
              resolve(false);
            }
          }
        } catch (e) {
          // JSON parse error, continue
        }
      }
    });
    
    // Send initialize request
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' }
      }
    }) + '\n';
    server.stdin.write(initRequest);
    
    setTimeout(() => {
      server.kill();
      if (!initialized) {
        console.log(`  ⚠️  Timeout (initialization failed)`);
      } else {
        console.log(`  ⚠️  Timeout waiting for API response`);
      }
      resolve(false);
    }, 15000);
  });
}

async function main() {
  console.log('🧪 AI Issue CLI - Skills Test\n');
  console.log('================================');
  
  const skillsDir = path.join(__dirname, 'skills');
  
  // Test 1: Check skills can start
  try {
    await testSkill(
      path.join(skillsDir, 'github-issue-fetcher', 'index.js'),
      'GitHub Issue Fetcher'
    );
  } catch (err) {
    console.log(`  ❌ Failed: ${err.message}`);
  }
  
  try {
    await testSkill(
      path.join(skillsDir, 'code-similarity-finder', 'index.js'),
      'Code Similarity Finder'
    );
  } catch (err) {
    console.log(`  ❌ Failed: ${err.message}`);
  }
  
  // Test 2: Actually fetch an issue
  await testGitHubFetch();
  
  console.log('\n================================');
  console.log('✅ Skills test completed!\n');
}

main();

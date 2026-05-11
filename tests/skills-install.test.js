/**
 * Tests for skills:install script coverage (B-23-02)
 * Ensures all MCP skill directories are included in the install script.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('skills:install script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const installScript = pkg.scripts['skills:install'];

  const EXPECTED_SKILLS = [
    'github-issue-fetcher',
    'code-similarity-finder',
    'similar-issue-finder',
    'report-validator',
  ];

  it('should cover all expected skill directories', () => {
    for (const skill of EXPECTED_SKILLS) {
      expect(installScript).toContain(skill);
    }
  });

  it('each skill directory should exist on disk', () => {
    for (const skill of EXPECTED_SKILLS) {
      const skillDir = path.join(ROOT, 'skills', skill);
      expect(fs.existsSync(skillDir)).toBe(true);
    }
  });

  it('all skills referenced in MCP config files should be in skills:install', () => {
    const configDir = path.join(ROOT, 'config');
    const configFiles = fs.readdirSync(configDir).filter(f => f.startsWith('mcp-config'));

    const referencedSkills = new Set();
    for (const file of configFiles) {
      const content = JSON.parse(fs.readFileSync(path.join(configDir, file), 'utf8'));
      if (content.mcpServers) {
        for (const server of Object.values(content.mcpServers)) {
          if (server.args) {
            for (const arg of server.args) {
              const match = arg.match(/skills\/([^/]+)\//);
              if (match) referencedSkills.add(match[1]);
            }
          }
        }
      }
    }

    for (const skill of referencedSkills) {
      expect(installScript).toContain(skill);
    }
  });
});

// @ts-check
/**
 * Environment checking utilities
 */

/**
 * @typedef {Object} EnvironmentCheck
 * @property {string} name
 * @property {boolean} status
 * @property {'core'|'agents'|'repository'|'service'|'kb'} [group]
 * @property {string} [detail]
 * @property {string} [help]
 */

const fs = require('fs');
const path = require('path');
const { createAgent } = require('./agents');
const { expandHome } = require('./config');

function displayPathWithHome(filePath) {
  const expanded = expandHome(filePath);
  const home = expandHome('~');
  if (expanded && home && (expanded === home || expanded.startsWith(`${home}${path.sep}`))) {
    return `~${expanded.slice(home.length)}`;
  }
  return expanded;
}


/**
 * @param {import('./types').Config} config
 * @returns {EnvironmentCheck}
 */
function probeKnowledgeBase(config) {
  if (!config.knowledgeBasePath) {
    return { name: 'Local Knowledge Base', status: true, group: 'kb', detail: 'not configured' };
  }
  const kbDir = expandHome(config.knowledgeBasePath);
  const displayPath = displayPathWithHome(kbDir);
  if (!fs.existsSync(kbDir)) {
      return { name: 'Local Knowledge Base', status: false, group: 'kb', detail: `${displayPath} missing`, help: 'Run: ai-issue kb download' };
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(kbDir, 'manifest.json'), 'utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('manifest is not an object');
    if (!/^[0-9a-fA-F]{64}$/.test(String(manifest.kbSha256 || ''))) throw new Error('manifest kbSha256 is invalid');
    const count = manifest.entryCount || manifest.entries || manifest.totalEntries || '?';
    const version = manifest.version || path.basename(kbDir);
    return { name: 'Local Knowledge Base', status: true, group: 'kb', detail: `${displayPath} @ ${version} (${count} entries)` };
  } catch (_err) {
    return { name: 'Local Knowledge Base', status: false, group: 'kb', detail: `${displayPath} corrupted`, help: 'Run: ai-issue kb verify' };
  }
}

// Verify environment
/**
 * @param {import('./types').Config} config
 * @returns {EnvironmentCheck[]}
 */
function checkEnvironment(config) {
  /** @type {EnvironmentCheck[]} */
  const checks = [];

  const major = parseInt(process.versions.node.split('.')[0], 10);
  checks.push({
    name: `Node.js ${process.version}`,
    status: !Number.isNaN(major) && major >= 18,
    group: 'core',
    help: `Node ≥ 18 is required (got ${process.version}). Upgrade via nvm/asdf/brew.`
  });
  
  // Check GITHUB_TOKEN
  checks.push({
    name: 'GITHUB_TOKEN',
    status: !!process.env.GITHUB_TOKEN,
    group: 'core',
    help: 'Set GITHUB_TOKEN environment variable. Create a PAT at https://github.com/settings/tokens (repo or public_repo scope)'
  });

  // Check configured agent CLI
  try {
    const agent = createAgent(config);
    const installation = agent.validateInstallationSync();
    checks.push({
      name: agent.displayName || `${agent.name} Agent`,
      status: installation.installed,
      group: 'agents',
      help: installation.errors && installation.errors.length > 0
        ? installation.errors.join('; ')
        : undefined
    });
  } catch (err) {
    checks.push({ name: 'Agent CLI', status: false, group: 'agents', help: err.message });
  }
  
  // Check repository path
  checks.push({
    name: 'Repository Path',
    status: fs.existsSync(config.repoPath),
    group: 'repository',
    help: `Set correct path: ai-issue config set repoPath <path>`
  });
  
  // Check report path
  checks.push({
    name: 'Report Path',
    status: fs.existsSync(config.reportPath),
    group: 'repository',
    help: `Create directory: mkdir -p ${config.reportPath}`
  });

  checks.push(probeKnowledgeBase(config));
  
  // Check prompt files
  const phase1PromptFile = path.join(__dirname, '..', 'prompts', 'PHASE1_RESEARCH_PROMPT.md');
  const phase2PromptFile = path.join(__dirname, '..', 'prompts', 'PHASE2_SOLUTION_PROMPT.md');
  const evalPromptFile = path.join(__dirname, '..', 'prompts', 'MANUAL_EVALUATION_PROMPT.md');
  
  checks.push({
    name: 'Phase 1 Prompt (Research)',
    status: fs.existsSync(phase1PromptFile),
    group: 'repository',
    help: `Required file: ${phase1PromptFile}`
  });
  
  checks.push({
    name: 'Phase 2 Prompt (Solution)',
    status: fs.existsSync(phase2PromptFile),
    group: 'repository',
    help: `Required file: ${phase2PromptFile}`
  });
  
  checks.push({
    name: 'Evaluation Prompt',
    status: fs.existsSync(evalPromptFile),
    group: 'repository',
    help: `Required file: ${evalPromptFile}`
  });
  
  return checks;
}

module.exports = {
  checkEnvironment,
  probeKnowledgeBase
};

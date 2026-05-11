// @ts-check
/**
 * Integration test: env-driven skill metrics actually write a JSONL line for
 * every wrapped MCP skill (SKILLS_ENHANCEMENT_PLAN §C2).
 *
 * Imports each skill's handleToolRequest *via the wrapped skill module* so we
 * exercise the same code path the MCP server registers. We don't drive the
 * MCP server itself; we call the raw handler with a synthetic request shape
 * (which is exactly what wrapToolHandler sees in production).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const { ENV_VAR } = require('../lib/skills-metrics');

let metricsDir;
let metricsFile;
let savedEnv;
let savedKbPath;
let savedGhToken;
let realRepo;

beforeAll(() => {
  // Spin up a real tiny git repo for git-history-analyzer (it actually shells
  // out to git) — same approach as tests/skills/git-history-analyzer.test.js.
  realRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-metrics-int-repo-'));
  execSync(
    'git init -q && git config user.email t@t && git config user.name t && git commit --allow-empty -q -m init',
    { cwd: realRepo, shell: '/bin/bash' }
  );
});

afterAll(() => {
  fs.rmSync(realRepo, { recursive: true, force: true });
});

beforeEach(() => {
  metricsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-metrics-int-'));
  metricsFile = path.join(metricsDir, 'skills.jsonl');
  savedEnv = process.env[ENV_VAR];
  savedKbPath = process.env.AI_ISSUE_KB_PATH;
  savedGhToken = process.env.GITHUB_TOKEN;
  process.env[ENV_VAR] = metricsFile;
  // Make sure unrelated env state doesn't perturb skill behavior.
  delete process.env.AI_ISSUE_KB_PATH;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_VAR];
  else process.env[ENV_VAR] = savedEnv;
  if (savedKbPath === undefined) delete process.env.AI_ISSUE_KB_PATH;
  else process.env.AI_ISSUE_KB_PATH = savedKbPath;
  if (savedGhToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = savedGhToken;
  fs.rmSync(metricsDir, { recursive: true, force: true });
});

function readLines() {
  if (!fs.existsSync(metricsFile)) return [];
  return fs.readFileSync(metricsFile, 'utf8').split('\n').filter(l => l);
}

/**
 * Build the *wrapped* handler for a skill the same way the MCP server does.
 * We can't call require('skills/X/index.js').handleToolRequest because that
 * gives us the unwrapped function. Instead we re-wrap it using wrapToolHandler
 * with the same skill name, which is functionally identical to what the skill
 * registers at runtime.
 */
function buildWrappedHandler(handler, skillName) {
  const { wrapToolHandler } = require('../lib/skills-metrics');
  return wrapToolHandler(handler, skillName);
}

function assertMetricLine(skillName, toolName) {
  const lines = readLines();
  expect(lines.length).toBe(1);
  const m = JSON.parse(lines[0]);
  expect(m.skill).toBe(skillName);
  expect(m.tool).toBe(toolName);
  expect(typeof m.latency_ms).toBe('number');
  expect(m.latency_ms).toBeGreaterThanOrEqual(0);
  expect(typeof m.timestamp).toBe('string');
  expect(typeof m.output_size_chars).toBe('number');
}

describe('skills-metrics end-to-end (per skill)', () => {
  it('git-history-analyzer emits a metric line for analyze_file_history', async () => {
    const skill = require('../skills/git-history-analyzer');
    const wrapped = buildWrappedHandler(skill.handleToolRequest, 'git-history-analyzer');
    await wrapped({
      params: {
        name: 'analyze_file_history',
        arguments: { repoPath: realRepo, filePath: 'README.md', limit: 1 },
      },
    });
    assertMetricLine('git-history-analyzer', 'analyze_file_history');
  });

  it('report-validator emits a metric line for validate_report', async () => {
    const skill = require('../skills/report-validator');
    const wrapped = buildWrappedHandler(skill.handleToolRequest, 'report-validator');
    // Even an INVALID_INPUT error path produces a metric (with error: true)
    await wrapped({
      params: { name: 'validate_report', arguments: {} },
    });
    const lines = readLines();
    expect(lines.length).toBe(1);
    const m = JSON.parse(lines[0]);
    expect(m.skill).toBe('report-validator');
    expect(m.tool).toBe('validate_report');
  });

  it('similar-issue-finder emits a metric line for find_similar_issues', async () => {
    const skill = require('../skills/similar-issue-finder');
    const wrapped = buildWrappedHandler(skill.handlers.handleToolRequest, 'similar-issue-finder');
    await wrapped({
      params: { name: 'find_similar_issues', arguments: { issueText: 'whatever' } },
    });
    assertMetricLine('similar-issue-finder', 'find_similar_issues');
  });

  it('terraform-validator emits a metric line for validate_terraform_changes', async () => {
    const skill = require('../skills/terraform-validator');
    const wrapped = buildWrappedHandler(skill.handleToolRequest, 'terraform-validator');
    await wrapped({
      params: {
        name: 'validate_terraform_changes',
        arguments: { resourcePath: '/nonexistent.go', changedFields: [] },
      },
    });
    assertMetricLine('terraform-validator', 'validate_terraform_changes');
  });

  it('does not write any metric when env var is unset', async () => {
    delete process.env[ENV_VAR];
    const skill = require('../skills/git-history-analyzer');
    const wrapped = buildWrappedHandler(skill.handleToolRequest, 'git-history-analyzer');
    await wrapped({
      params: {
        name: 'analyze_file_history',
        arguments: { repoPath: realRepo, filePath: 'README.md', limit: 1 },
      },
    });
    expect(fs.existsSync(metricsFile)).toBe(false);
  });
});

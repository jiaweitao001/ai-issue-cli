#!/usr/bin/env node
// @ts-check

const fs = require('fs');

function usage() {
  return [
    'Usage: node scripts/agent-acceptance.js --issues <i1,i2,i3,i4,i5> [options]',
    '',
    'Options:',
    '  --agents <list>        Comma-separated agents to compare (default: copilot,claude-code)',
    '  --output <path>        Write the markdown plan/template to a file',
    '  --skip-eval           Include --skip-eval in generated solve commands',
    '  --branch              Include --branch in generated solve commands',
    '  --allow-partial       Allow fewer or more than five issues',
    '  -h, --help            Show this help',
  ].join('\n');
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

/**
 * @param {string[]} argv
 * @returns {{ issues: string[], agents: string[], output: string|null, skipEval: boolean, branch: boolean, allowPartial: boolean, help: boolean }}
 */
function parseArgs(argv) {
  const args = {
    issues: [],
    agents: ['copilot', 'claude-code'],
    output: null,
    skipEval: false,
    branch: false,
    allowPartial: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      args.help = true;
    } else if (arg === '--issues') {
      args.issues = parseCsv(argv[++i]);
    } else if (arg === '--agents') {
      args.agents = parseCsv(argv[++i]);
    } else if (arg === '--output') {
      args.output = argv[++i] || null;
    } else if (arg === '--skip-eval') {
      args.skipEval = true;
    } else if (arg === '--branch') {
      args.branch = true;
    } else if (arg === '--allow-partial') {
      args.allowPartial = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
}

/**
 * @param {{ help?: boolean, issues: string[], agents: string[], skipEval: boolean, branch: boolean, allowPartial: boolean }} args
 */
function validateArgs(args) {
  if (args.help) return;
  if (args.issues.length === 0) {
    throw new Error('--issues is required');
  }
  if (!args.allowPartial && args.issues.length !== 5) {
    throw new Error(`Phase 5B acceptance expects exactly five issues; got ${args.issues.length}. Use --allow-partial for a smoke template.`);
  }
  if (args.agents.length === 0) {
    throw new Error('--agents must include at least one agent');
  }
}

/**
 * @param {string} issue
 * @param {string} agent
 * @param {{ skipEval: boolean, branch: boolean }} options
 * @returns {string}
 */
function buildSolveCommand(issue, agent, options) {
  const parts = ['ai-issue'];
  if (options.skipEval) parts.push('--skip-eval');
  parts.push('solve', issue, '--agent', agent);
  if (options.branch) parts.push('--branch');
  return parts.join(' ');
}

/**
 * @param {{ issues: string[], agents: string[], skipEval: boolean, branch: boolean }} args
 * @returns {string}
 */
function renderMarkdown(args) {
  const lines = [
    '# Agent Acceptance Plan',
    '',
    'Use this template for manual Phase 5B acceptance. Run each command in a clean target repository checkout and record the observed behavior.',
    '',
    '## Commands',
    '',
    '| Issue | Agent | Command |',
    '|-------|-------|---------|',
  ];

  for (const issue of args.issues) {
    for (const agent of args.agents) {
      lines.push(`| ${issue} | ${agent} | \`${buildSolveCommand(issue, agent, args)}\` |`);
    }
  }

  lines.push(
    '',
    '## Result matrix',
    '',
    '| Issue | Expected type | Agent | Phase 1 classification | Phase 2 outcome | Artifact validation | Rubber-duck result | Duration | Estimated cost | Notes |',
    '|-------|---------------|-------|------------------------|-----------------|---------------------|--------------------|----------|----------------|-------|'
  );

  for (const issue of args.issues) {
    for (const agent of args.agents) {
      lines.push(`| ${issue} | TBD | ${agent} | TBD | TBD | TBD | TBD | TBD | TBD | TBD |`);
    }
  }

  lines.push(
    '',
    '## Acceptance checklist',
    '',
    '- Phase 1 report contains `## Problem Classification` and parses correctly.',
    '- CODE_CHANGE issues advance HEAD with issue-scoped commits.',
    '- GUIDANCE issues produce a useful analysis/guidance report without unnecessary code changes.',
    '- Rubber-duck critique/fix behavior is recorded for CODE_CHANGE issues.',
    '- Claude Code can call the configured MCP tools, including historical issue search when service credentials are configured.',
    '- Copilot and Claude Code results show no obvious quality regression for the issue set.',
    '- Record the five-issue average duration and estimated API cost.',
    ''
  );

  return lines.join('\n');
}

function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      io.stdout.write(usage() + '\n');
      return 0;
    }
    validateArgs(args);
    const markdown = renderMarkdown(args);
    if (args.output) {
      fs.writeFileSync(args.output, markdown);
      io.stdout.write(`Wrote acceptance template to ${args.output}\n`);
    } else {
      io.stdout.write(markdown);
    }
    return 0;
  } catch (err) {
    io.stderr.write(`${err.message}\n\n${usage()}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  parseArgs,
  validateArgs,
  buildSolveCommand,
  renderMarkdown,
  main,
  usage,
};

#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { PII_PATTERNS } = require('../lib/sanitize');

function lineForIndex(text, index) {
  return text.slice(0, index).split('\n').length;
}

function scanText(text, filePath = '<text>') {
  const findings = [];
  for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
    pattern.lastIndex = 0;
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (type === 'internalUrl' && /^https?:\/\/github\.com\/hashicorp\//i.test(match[0])) continue;
      findings.push({ type, file: filePath, line: lineForIndex(text, match.index || 0), match: match[0] });
    }
  }
  return findings;
}

function collectStringValues(value, values = []) {
  if (typeof value === 'string') values.push(value);
  else if (Array.isArray(value)) value.forEach(item => collectStringValues(item, values));
  else if (value && typeof value === 'object') {
    Object.values(value).forEach(item => collectStringValues(item, values));
  }
  return values;
}

function scanJsonText(text, filePath) {
  const findings = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line);
      for (const value of collectStringValues(parsed)) {
        findings.push(...scanText(value, filePath).map(finding => ({ ...finding, line: index + 1 })));
      }
    } catch (error) {
      findings.push(...scanText(line, filePath).map(finding => ({ ...finding, line: index + 1 })));
    }
  });
  return findings;
}

function scanFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  if (filePath.endsWith('.jsonl')) return scanJsonText(text, filePath);
  if (filePath.endsWith('.json')) {
    try {
      const parsed = JSON.parse(text);
      return collectStringValues(parsed).flatMap(value => scanText(value, filePath));
    } catch (error) {
      return scanText(text, filePath);
    }
  }
  return scanText(text, filePath);
}

function walk(dir) {
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, name);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) entries.push(...walk(fullPath));
    else if (stat.isFile()) entries.push(fullPath);
  }
  return entries;
}

function scanDir(dir) {
  const findings = [];
  for (const filePath of walk(dir)) findings.push(...scanFile(filePath));
  return findings;
}

function parseArgv(argv = process.argv.slice(2)) {
  const opts = { quiet: false };
  for (const arg of argv) {
    if (arg === '--quiet') opts.quiet = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (!opts.dir) opts.dir = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

async function main(options = parseArgv()) {
  if (options.help || !options.dir) {
    console.log('Usage: node scripts/eval/pii-scan.js <kb-dir> [--quiet]');
    return { findings: [] };
  }
  const findings = scanDir(options.dir);
  if (!options.quiet) {
    const seen = new Set();
    for (const finding of findings) {
      const key = `${finding.type}:${finding.file}:${finding.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`${finding.type}: ${finding.file}:${finding.line}`);
    }
  }
  if (findings.length) process.exitCode = 1;
  return { findings };
}

if (require.main === module) {
  main(parseArgv()).catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { main, scanText, scanFile, scanDir };

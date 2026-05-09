#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { VERSION } = require('../lib/config');
const { _internal } = require('../lib/local-knowledge-base');
const { sanitize } = require('./lib/sanitize');

const DEFAULT_SOURCE_REPO = 'hashicorp/terraform-provider-azurerm';
const LICENSE_TEXT = `This knowledge base is derived from public issues and PRs in the\nhashicorp/terraform-provider-azurerm repository, licensed under MPL-2.0.\nSource commit: unknown\n`;

function printHelp() {
  console.log(`Usage: node scripts/export-knowledge-base.js --service-url <url> --service-api-key <key> --output <dir> [options]\n\nOptions:\n  --service-url <url>       ai-issue-service base URL\n  --service-api-key <key>   API key sent as X-Api-Key\n  --output <dir>            Output KB directory\n  --min-confidence <n>      Minimum confidence (default: 0.8)\n  --source-repo <repo>      Source repository (default: ${DEFAULT_SOURCE_REPO})\n  --source-commit <sha>     Source commit for attribution\n  --version <version>       KB version (default: YYYY.MM.DD today)\n  --dry-run                 Fetch and build into a local scratch directory, then remove it\n  --help                    Show this help`);
}

function parseArgv(argv = process.argv.slice(2)) {
  const opts = { minConfidence: 0.8, sourceRepo: DEFAULT_SOURCE_REPO, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--service-url') opts.serviceUrl = argv[++i];
    else if (arg === '--service-api-key') opts.serviceApiKey = argv[++i];
    else if (arg === '--output') opts.output = argv[++i];
    else if (arg === '--min-confidence') opts.minConfidence = Number(argv[++i]);
    else if (arg === '--source-repo') opts.sourceRepo = argv[++i];
    else if (arg === '--source-commit') opts.sourceCommit = argv[++i];
    else if (arg === '--version') opts.version = argv[++i];
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!opts.version) opts.version = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  return opts;
}

function requestJson(url, apiKey) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('http://') ? http : https;
    const req = client.get(url, { headers: { 'X-Api-Key': apiKey || '' } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GET ${url} failed with HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`GET ${url} returned invalid JSON: ${error.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error(`GET ${url} timed out`)));
  });
}

function joinUrl(base, pathname) {
  return `${String(base).replace(/\/+$/, '')}${pathname}`;
}

async function fetchExport(serviceUrl, apiKey, minConfidence = 0.8, sourceRepo) {
  if (!sourceRepo) throw new Error('fetchExport: sourceRepo is required');
  const url = joinUrl(
    serviceUrl,
    `/knowledge/export?repo=${encodeURIComponent(sourceRepo)}&confidence_min=${encodeURIComponent(minConfidence)}`
  );
  const payload = await requestJson(url, apiKey);
  return Array.isArray(payload) ? payload : (payload.entries || payload.results || []);
}

async function fetchResources(serviceUrl, apiKey, sourceRepo) {
  if (!sourceRepo) throw new Error('fetchResources: sourceRepo is required');
  const url = joinUrl(
    serviceUrl,
    `/resources/index?repo=${encodeURIComponent(sourceRepo)}`
  );
  const payload = await requestJson(url, apiKey);
  return Array.isArray(payload) ? payload : (payload.entries || payload.resources || []);
}

function sanitizeEntry(value) {
  if (typeof value === 'string') return sanitize(value);
  if (Array.isArray(value)) return value.map(sanitizeEntry);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = sanitizeEntry(child);
    return out;
  }
  return value;
}

function shouldExclude(entry) {
  if (entry.labels?.some(l => l.startsWith('internal/') || l === 'security')) return true;
  if (entry.solution_summary?.length > 2000) return true;
  return false;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function buildManifest({ kbSha256 = '', version, entryCount, sourceRepo, sourceCommit }) {
  return {
    schemaVersion: 1,
    minCliVersion: VERSION,
    kbSha256,
    version,
    qualityGate: 'pending',
    entryCount,
    sourceRepo,
    sourceCommit,
    license: 'MPL-2.0',
    indexes: { df: 'kb-df.json' }
  };
}

function writeKb(outputDir, entries, options) {
  fs.mkdirSync(outputDir, { recursive: true });
  const kbPath = path.join(outputDir, 'kb.jsonl');
  const kbJsonl = entries.map(entry => JSON.stringify(entry)).join('\n') + (entries.length ? '\n' : '');
  fs.writeFileSync(kbPath, kbJsonl);
  fs.writeFileSync(path.join(outputDir, 'kb-df.json'), `${JSON.stringify(_internal.computeDocFrequency(entries), null, 2)}\n`);
  const manifest = buildManifest({
    kbSha256: sha256File(kbPath),
    version: options.version,
    entryCount: entries.length,
    sourceRepo: options.sourceRepo,
    sourceCommit: options.sourceCommit
  });
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const licenseText = `This knowledge base is derived from public issues and PRs in the\n${options.sourceRepo} repository, licensed under MPL-2.0.\nSource commit: ${options.sourceCommit || 'unknown'}\n`;
  fs.writeFileSync(path.join(outputDir, 'LICENSE.txt'), licenseText || LICENSE_TEXT);
  return manifest;
}

async function main(options = parseArgv()) {
  if (options.help) {
    printHelp();
    return { ok: true, help: true };
  }
  for (const key of ['serviceUrl', 'serviceApiKey', 'output']) {
    if (!options[key]) throw new Error(`Missing required option --${key.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}`);
  }
  const resolvedIssues = await fetchExport(options.serviceUrl, options.serviceApiKey, options.minConfidence, options.sourceRepo);
  const resources = await fetchResources(options.serviceUrl, options.serviceApiKey, options.sourceRepo);
  const entries = [...resolvedIssues, ...resources]
    .map(sanitizeEntry)
    .filter(entry => !shouldExclude(entry));
  const outputDir = options.dryRun
    ? fs.mkdtempSync(path.join(process.cwd(), '.export-kb-dry-run-'))
    : options.output;
  try {
    const manifest = writeKb(outputDir, entries, options);
    if (options.dryRun) {
      console.log(`Dry run OK: ${entries.length} entries, kbSha256=${manifest.kbSha256}, scratch=${outputDir}`);
    } else {
      console.log(`Exported ${entries.length} entries to ${options.output}`);
    }
    return { entries, manifest, outputDir };
  } finally {
    if (options.dryRun) fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main(parseArgv()).catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { main, sanitize, shouldExclude, fetchExport, fetchResources, buildManifest, parseArgv };

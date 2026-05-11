#!/usr/bin/env node
// @ts-check
const fs = require('fs');
const path = require('path');
const { LocalKnowledgeBase } = require('../../lib/local-knowledge-base');

const THRESHOLDS = { recallAt3: 0.6, mrrAt5: 0.4, resourceHit: 0.7 };

function printHelp() {
  console.log(`Usage: node scripts/eval/kb-quality-eval.js --kb <kb-dir> --eval-set <file> [--write-manifest]\n\nComputes Recall@3, MRR@5, and ResourceHit for a local knowledge base.`);
}

function parseArgv(argv = process.argv.slice(2)) {
  const opts = { writeManifest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--kb') opts.kb = argv[++i];
    else if (arg === '--eval-set') opts.evalSet = argv[++i];
    else if (arg === '--write-manifest') opts.writeManifest = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return opts;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function computeMetrics(cases) {
  const rows = cases.map(item => {
    const truth = new Set((item.ground_truth || []).map(Number));
    const results = item.results || [];
    const top3 = results.slice(0, 3);
    const hitAt3 = top3.some(result => truth.has(Number(result.issue_number))) ? 1 : 0;
    const rank = results.slice(0, 5).findIndex(result => truth.has(Number(result.issue_number)));
    const reciprocalRank = rank >= 0 ? 1 / (rank + 1) : 0;
    const resourceHit = results[0] && item.resource_type && results[0].resource_type === item.resource_type ? 1 : 0;
    return { ...item, hitAt3, reciprocalRank, resourceHit };
  });
  return {
    rows,
    recallAt3: mean(rows.map(row => row.hitAt3)),
    mrrAt5: mean(rows.map(row => row.reciprocalRank)),
    resourceHit: mean(rows.map(row => row.resourceHit)),
    passed: mean(rows.map(row => row.hitAt3)) >= THRESHOLDS.recallAt3 && mean(rows.map(row => row.reciprocalRank)) >= THRESHOLDS.mrrAt5
  };
}

async function evaluate(kbDir, evalSetPath) {
  const evalSet = JSON.parse(fs.readFileSync(evalSetPath, 'utf8'));
  const kb = new LocalKnowledgeBase(kbDir);
  await kb.load();
  const cases = [];
  for (const item of evalSet) {
    const results = await kb.findSimilarIssues(item.query, { resourceType: item.resource_type, limit: 5 });
    cases.push({ ...item, results });
  }
  return computeMetrics(cases);
}

function writeManifestGate(kbDir, gate) {
  const manifestPath = path.join(kbDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.qualityGate = gate;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function printResults(metrics) {
  console.log('Query | Hit@3 | RR@5 | ResourceHit');
  console.log('--- | ---: | ---: | ---:');
  for (const row of metrics.rows) {
    console.log(`${row.query} | ${row.hitAt3} | ${row.reciprocalRank.toFixed(3)} | ${row.resourceHit}`);
  }
  console.log(`\nRecall@3=${metrics.recallAt3.toFixed(3)} MRR@5=${metrics.mrrAt5.toFixed(3)} ResourceHit=${metrics.resourceHit.toFixed(3)}`);
  console.log(`qualityGate=${metrics.passed ? 'passed' : 'failed'}`);
  if (metrics.resourceHit < THRESHOLDS.resourceHit) {
    console.error(`Warning: ResourceHit ${metrics.resourceHit.toFixed(3)} is below ${THRESHOLDS.resourceHit}`);
  }
}

async function main(options = parseArgv()) {
  if (options.help) {
    printHelp();
    return { ok: true, help: true };
  }
  if (!options.kb) throw new Error('Missing required option --kb');
  if (!options.evalSet) throw new Error('Missing required option --eval-set');
  const metrics = await evaluate(options.kb, options.evalSet);
  const gate = metrics.passed ? 'passed' : 'failed';
  if (options.writeManifest) writeManifestGate(options.kb, gate);
  printResults(metrics);
  if (!metrics.passed) process.exitCode = 1;
  return metrics;
}

if (require.main === module) {
  main(parseArgv()).catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { main, evaluate, computeMetrics, parseArgv };

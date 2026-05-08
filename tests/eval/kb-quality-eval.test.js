const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { computeMetrics, evaluate, main } = require('../../scripts/eval/kb-quality-eval');
const { writeKbFixture, sampleEntries } = require('../helpers/kb-fixture');

const workRoot = path.join(__dirname, '..', 'fixtures', 'kb-eval-work');

function writeEvalSet(filePath, entries) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(entries, null, 2)}\n`);
}

function refreshSha(kbDir) {
  const kbPath = path.join(kbDir, 'kb.jsonl');
  const manifestPath = path.join(kbDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.kbSha256 = crypto.createHash('sha256').update(fs.readFileSync(kbPath)).digest('hex');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

describe('kb-quality-eval', () => {
  let originalExitCode;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    fs.rmSync(workRoot, { recursive: true, force: true });
    fs.mkdirSync(workRoot, { recursive: true });
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    fs.rmSync(workRoot, { recursive: true, force: true });
  });

  test('computeMetrics returns perfect scores for perfect top results', () => {
    const metrics = computeMetrics([
      {
        query: 'a',
        resource_type: 'azurerm_a',
        ground_truth: [1],
        results: [{ issue_number: 1, resource_type: 'azurerm_a' }]
      },
      {
        query: 'b',
        resource_type: 'azurerm_b',
        ground_truth: [2, 3],
        results: [{ issue_number: 3, resource_type: 'azurerm_b' }]
      }
    ]);

    expect(metrics.recallAt3).toBe(1);
    expect(metrics.mrrAt5).toBe(1);
    expect(metrics.resourceHit).toBe(1);
    expect(metrics.passed).toBe(true);
  });

  test('computeMetrics returns partial scores for mixed results', () => {
    const metrics = computeMetrics([
      {
        query: 'a',
        resource_type: 'azurerm_a',
        ground_truth: [10],
        results: [
          { issue_number: 9, resource_type: 'azurerm_other' },
          { issue_number: 10, resource_type: 'azurerm_a' }
        ]
      },
      {
        query: 'b',
        resource_type: 'azurerm_b',
        ground_truth: [20],
        results: [
          { issue_number: 21, resource_type: 'azurerm_b' },
          { issue_number: 22, resource_type: 'azurerm_b' },
          { issue_number: 23, resource_type: 'azurerm_b' },
          { issue_number: 24, resource_type: 'azurerm_b' },
          { issue_number: 20, resource_type: 'azurerm_b' }
        ]
      }
    ]);

    expect(metrics.recallAt3).toBe(0.5);
    expect(metrics.mrrAt5).toBe(0.35);
    expect(metrics.resourceHit).toBe(0.5);
    expect(metrics.passed).toBe(false);
  });

  test('evaluate runs end-to-end against a fixture KB', async () => {
    const kbDir = path.join(workRoot, 'kb');
    const evalSetPath = path.join(workRoot, 'eval-set.json');
    writeKbFixture(kbDir);
    writeEvalSet(evalSetPath, [
      {
        query: 'azurerm_key_vault_certificate timeout polling',
        resource_type: 'azurerm_key_vault_certificate',
        ground_truth: [101]
      },
      {
        query: 'azurerm_storage_account network rules crash bypass',
        resource_type: 'azurerm_storage_account',
        ground_truth: [202]
      }
    ]);

    const metrics = await evaluate(kbDir, evalSetPath);

    expect(metrics.rows).toHaveLength(2);
    expect(metrics.recallAt3).toBeGreaterThan(0);
    expect(metrics.mrrAt5).toBeGreaterThan(0);
    expect(metrics.resourceHit).toBeGreaterThan(0);
  });

  test('--write-manifest writes passed quality gate', async () => {
    const kbDir = path.join(workRoot, 'kb-pass');
    const evalSetPath = path.join(workRoot, 'eval-pass.json');
    writeKbFixture(kbDir);
    writeEvalSet(evalSetPath, [
      {
        query: 'azurerm_key_vault_certificate timeout polling certificate',
        resource_type: 'azurerm_key_vault_certificate',
        ground_truth: [101]
      }
    ]);

    const metrics = await main({ kb: kbDir, evalSet: evalSetPath, writeManifest: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(kbDir, 'manifest.json'), 'utf8'));

    expect(metrics.passed).toBe(true);
    expect(manifest.qualityGate).toBe('passed');
  });

  test('--write-manifest writes failed quality gate', async () => {
    const kbDir = path.join(workRoot, 'kb-fail');
    const evalSetPath = path.join(workRoot, 'eval-fail.json');
    writeKbFixture(kbDir, {}, sampleEntries);
    refreshSha(kbDir);
    writeEvalSet(evalSetPath, [
      {
        query: 'totally unrelated query with no result',
        resource_type: 'azurerm_key_vault_certificate',
        ground_truth: [9999]
      }
    ]);

    const metrics = await main({ kb: kbDir, evalSet: evalSetPath, writeManifest: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(kbDir, 'manifest.json'), 'utf8'));

    expect(metrics.passed).toBe(false);
    expect(manifest.qualityGate).toBe('failed');
    expect(process.exitCode).toBe(1);
  });
});

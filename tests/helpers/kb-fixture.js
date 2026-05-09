const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sampleEntries = [
  {
    type: 'resolved_issue',
    issue_number: 101,
    title: 'azurerm_key_vault_certificate polling timeout during creation',
    body_summary: 'Certificate creation times out after thirty minutes when Key Vault polling stalls.',
    labels: ['service/keyvault', 'bug'],
    resource_type: 'azurerm_key_vault_certificate',
    service: 'keyvault',
    pr_number: 1101,
    pr_url: 'https://github.com/hashicorp/terraform-provider-azurerm/pull/1101',
    changed_files: ['internal/services/keyvault/key_vault_certificate_resource.go'],
    solution_summary: 'Add a custom poller with retry handling for certificate creation timeout.',
    keywords: ['timeout', 'polling', 'certificate', 'keyvault', 'creation']
  },
  {
    type: 'resolved_issue',
    issue_number: 202,
    title: 'azurerm_storage_account network rules crash on update',
    body_summary: 'Storage account network rules update crashes when bypass settings are empty.',
    labels: ['service/storage', 'bug'],
    resource_type: 'azurerm_storage_account',
    service: 'storage',
    pr_number: 2202,
    pr_url: 'https://github.com/hashicorp/terraform-provider-azurerm/pull/2202',
    changed_files: ['internal/services/storage/storage_account_resource.go'],
    solution_summary: 'Guard empty network bypass settings before expanding storage rules.',
    keywords: ['storage', 'network', 'rules', 'crash', 'bypass']
  },
  {
    type: 'resource_index',
    resource_type: 'key_vault_certificate',
    service: 'keyvault',
    source_files: ['internal/services/keyvault/key_vault_certificate_resource.go'],
    test_files: ['internal/services/keyvault/key_vault_certificate_resource_test.go'],
    doc_file: 'website/docs/r/key_vault_certificate.html.markdown',
    common_issues: ['timeout', 'polling', 'certificate']
  },
  {
    type: 'resource_index',
    resource_type: 'cognitive_*',
    owners: ['promisinganuj'],
    source_files: [],
    test_files: [],
    common_issues: []
  }
];

function writeKbFixture(kbDir, overrides = {}, entries = sampleEntries) {
  if (!kbDir) {
    throw new Error('writeKbFixture: kbDir is required (use createScratchRoot to obtain one)');
  }
  fs.mkdirSync(kbDir, { recursive: true });
  const kbJsonl = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
  fs.writeFileSync(path.join(kbDir, 'kb.jsonl'), kbJsonl);
  const manifest = {
    schemaVersion: 1,
    minCliVersion: '0.0.1',
    kbSha256: crypto.createHash('sha256').update(kbJsonl).digest('hex'),
    qualityGate: 'passed',
    version: '2026.05.07',
    ...overrides
  };
  for (const key of Object.keys(manifest)) {
    if (manifest[key] === undefined) delete manifest[key];
  }
  fs.writeFileSync(path.join(kbDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { kbDir, manifest, entries, kbJsonl };
}

// Returns a fresh, unique tmpdir for one test suite. Suites that share the
// same on-disk dir race when jest runs them in parallel workers — see
// docs/PHASE5_AUDIT_2026-05-09.md (gap-kb-fixture-race).
function createScratchRoot(label = 'kb') {
  const safe = String(label).replace(/[^a-zA-Z0-9_-]+/g, '-');
  return fs.mkdtempSync(path.join(os.tmpdir(), `ai-issue-${safe}-`));
}

function cleanupScratchRoot(root) {
  if (!root) return;
  fs.rmSync(root, { recursive: true, force: true });
}

module.exports = {
  sampleEntries,
  writeKbFixture,
  createScratchRoot,
  cleanupScratchRoot
};

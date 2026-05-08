const fs = require('fs');
const path = require('path');
const { sanitize } = require('../../scripts/lib/sanitize');
const { scanText, scanFile, scanDir, main } = require('../../scripts/eval/pii-scan');

const workRoot = path.join(__dirname, '..', 'fixtures', 'pii-work');

const cases = [
  {
    type: 'githubToken',
    positive: 'token ghp_AAAAAAAAAAAAAAAAAAAAA',
    negative: 'token ghx_AAAAAAAAAAAAAAAAAAAAA',
    redaction: '[token-redacted]'
  },
  {
    type: 'awsAccessKey',
    positive: 'access AKIAIOSFODNN7EXAMPLE',
    negative: 'access AKIAiosfodnn7example',
    redaction: '[aws-key-redacted]'
  },
  {
    type: 'awsSecret',
    positive: 'value ABCDEFGHIJKLMNOPQRSTUVWXYZabcd1234567890',
    negative: 'value ABCDEFGHIJKLMNOPQRSTUVWXYZabcd123456789',
    redaction: '[aws-secret-redacted]'
  },
  {
    type: 'azureConnString',
    positive: 'DefaultEndpointsProtocol=https;AccountName=foo;AccountKey=bar==',
    negative: 'DefaultEndpointsProtocol=http;AccountName=foo;AccountKey=bar==',
    redaction: '[azure-connection-redacted]'
  },
  {
    type: 'gcpServiceAccount',
    positive: '{"type":"service_account","project_id":"p","private_key":"abc"}',
    negative: '{"type":"user_account","project_id":"p","private_key":"abc"}',
    redaction: '[gcp-service-account-redacted]'
  },
  {
    type: 'privateKey',
    positive: '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----',
    negative: '-----BEGIN RSA PUBLIC KEY-----\nabc\n-----END RSA PUBLIC KEY-----',
    redaction: '[private-key-redacted]'
  }
];

describe('pii-scan', () => {
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

  test.each(cases)('$type positive matches and redacts', ({ type, positive, redaction }) => {
    const findings = scanText(positive, 'case.txt');
    expect(findings.some(finding => finding.type === type)).toBe(true);
    expect(sanitize(positive)).toContain(redaction);
  });

  test.each(cases)('$type negative does not match', ({ type, negative }) => {
    const findings = scanText(negative, 'case.txt');
    expect(findings.some(finding => finding.type === type)).toBe(false);
  });

  test('scanFile and scanDir report all dirty fixture secret types', () => {
    const dirtyDir = path.join(workRoot, 'dirty');
    fs.mkdirSync(dirtyDir, { recursive: true });
    for (const item of cases.slice(0, 5)) {
      fs.writeFileSync(path.join(dirtyDir, `${item.type}.txt`), `${item.positive}\n`);
    }

    const fileFindings = scanFile(path.join(dirtyDir, 'githubToken.txt'));
    const dirFindings = scanDir(dirtyDir);
    const foundTypes = new Set(dirFindings.map(finding => finding.type));

    expect(fileFindings.some(finding => finding.type === 'githubToken')).toBe(true);
    for (const item of cases.slice(0, 5)) expect(foundTypes.has(item.type)).toBe(true);
  });

  test('clean fixture has no findings and main exits zero', async () => {
    const cleanDir = path.join(workRoot, 'clean');
    fs.mkdirSync(cleanDir, { recursive: true });
    fs.writeFileSync(path.join(cleanDir, 'README.md'), 'normal markdown with https://example.com and AKIA lowercase akiaiosfodnn7example\n');

    const result = await main({ dir: cleanDir, quiet: true });

    expect(scanDir(cleanDir)).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });
});

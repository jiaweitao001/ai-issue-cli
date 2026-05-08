const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { Readable } = require('stream');
const zlib = require('zlib');
const tar = require('tar');

let mockHome = path.join(process.cwd(), '.ai-issue', 'test-runtime', 'kb-home');
jest.mock('os', () => ({ ...jest.requireActual('os'), homedir: jest.fn(() => mockHome) }));

const mockLoadConfig = jest.fn();
const mockSaveConfig = jest.fn();
jest.mock('../../lib/config', () => ({
  loadConfig: mockLoadConfig,
  saveConfig: mockSaveConfig,
  DEFAULT_CONFIG: {},
  CONFIG_FILE: require('path').join(mockHome, '.ai-issue', 'config.json'),
  VERSION: '0.9.2',
  expandHome: (value) => !value ? value : value === '~' ? mockHome : value.startsWith('~/') ? require('path').join(mockHome, value.slice(2)) : value,
}));

const mockCreateLogger = require('../helpers/mock-logger').mockCreateLogger;
jest.mock('../../lib/logger', () => mockCreateLogger());

jest.mock('https');
const https = require('https');
const { cmdInfo, cmdRemove, cmdVerify, cmdUpdate, installKnowledgeBase, _internal, _test } = require('../../lib/commands/kb');
const { log, info, success, error } = require('../../lib/logger');

const runtimeRoot = path.join(process.cwd(), '.ai-issue', 'test-runtime', 'kb-cmd');
const version = '2026.05.07';

function rmRuntime() { fs.rmSync(path.join(process.cwd(), '.ai-issue', 'test-runtime'), { recursive: true, force: true }); }
function writeSample(dir, overrides = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const entries = [
    { type: 'resolved_issue', issue_number: 1, title: 'one', solution_summary: 'fixed' },
    { type: 'resource_index', resource_type: 'azurerm_x' },
  ];
  const kb = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'kb.jsonl'), kb);
  const manifest = { schemaVersion: 1, minCliVersion: '0.0.1', version, kbSha256: crypto.createHash('sha256').update(kb).digest('hex'), qualityGate: 'passed', entryCount: entries.length, ...overrides };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { manifest, entries };
}
async function tarSample(sampleDir) {
  const out = path.join(runtimeRoot, `sample-${Date.now()}-${Math.random()}.tar.gz`);
  await tar.c({ cwd: sampleDir, file: out, gzip: true }, ['manifest.json', 'kb.jsonl']);
  return fs.readFileSync(out);
}
function tarHeader(name, type = '0', body = Buffer.from('x'), linkname = '') {
  const h = Buffer.alloc(512, 0);
  h.write(name, 0, 100);
  h.write('0000777\0', 100, 8); h.write('0000000\0', 108, 8); h.write('0000000\0', 116, 8);
  h.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 12);
  h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12);
  h.fill(' ', 148, 156); h[156] = type.charCodeAt(0); h.write(linkname, 157, 100); h.write('ustar\0', 257, 6); h.write('00', 263, 2);
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512, 0);
  return Buffer.concat([h, body, pad]);
}
function evilTar(name, type = '0', linkname = '') { return zlib.gzipSync(Buffer.concat([tarHeader(name, type, Buffer.from('x'), linkname), Buffer.alloc(1024)])); }
function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function releaseJson(v = version) {
  return JSON.stringify({ tag_name: v, assets: [
    { name: `kb-${v}.tar.gz`, browser_download_url: 'https://download/kb.tgz' },
    { name: `kb-${v}.tar.gz.sha256`, browser_download_url: 'https://download/kb.sha256' },
  ] });
}
function makeReq() { const req = new EventEmitter(); req.setTimeout = jest.fn(); req.destroy = (err) => req.emit('error', err || new Error('destroyed')); return req; }
function makeRes(status, body) { const res = Readable.from(body ? [Buffer.from(body)] : []); res.statusCode = status; return res; }
function queueResponses(items) {
  https.get.mockImplementation((url, opts, cb) => {
    const item = items.shift();
    const req = makeReq();
    if (!item) throw new Error(`unexpected request ${url}`);
    if (item.never) return req;
    process.nextTick(() => cb(makeRes(item.status || 200, typeof item.body === 'function' ? item.body(url, opts) : item.body)));
    return req;
  });
}
function mockReleaseDownload(tarBuf, options = {}) {
  const digest = options.sha || sha(tarBuf);
  queueResponses([
    { body: releaseJson(options.version || version) },
    { body: `${digest}  kb-${version}.tar.gz\n` },
    { status: options.tarStatus || 200, body: tarBuf },
  ]);
}
function expectNoInstall(v = version) {
  expect(fs.existsSync(path.join(mockHome, '.ai-issue', 'kb', v))).toBe(false);
  const staging = path.join(mockHome, '.ai-issue', 'kb', '.staging');
  expect(!fs.existsSync(staging) || fs.readdirSync(staging).length === 0).toBe(true);
}

beforeEach(() => {
  rmRuntime();
  fs.mkdirSync(runtimeRoot, { recursive: true });
  mockHome = path.join(process.cwd(), '.ai-issue', 'test-runtime', 'kb-home');
  mockLoadConfig.mockReturnValue({ knowledgeBasePath: '' });
  mockSaveConfig.mockClear(); https.get.mockReset(); jest.clearAllMocks();
  _internal.RETRY_DELAYS_MS = [0, 0, 0]; _internal.HTTP_TIMEOUT_MS = 200; _internal.FIRST_BYTE_TIMEOUT_MS = 150; _internal.CONNECT_TIMEOUT_MS = 150;
  jest.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`process.exit ${code}`); });
});
afterEach(() => { process.exit.mockRestore(); delete process.env.CI; delete process.env.AI_ISSUE_DEBUG; });
afterAll(() => rmRuntime());

describe('commands/kb download', () => {
  test('happy path installs atomically and updates config', async () => {
    const sample = path.join(runtimeRoot, 'sample'); writeSample(sample);
    const tarBuf = await tarSample(sample); mockReleaseDownload(tarBuf);
    const result = await installKnowledgeBase({ source: 'jiaweitao001/ai-issue-cli' });
    expect(result.displayPath).toBe(`~/.ai-issue/kb/${version}`);
    expect(fs.existsSync(path.join(mockHome, '.ai-issue', 'kb', version, 'manifest.json'))).toBe(true);
    expect(fs.readdirSync(path.join(mockHome, '.ai-issue', 'kb', '.staging'))).toHaveLength(0);
    expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ knowledgeBasePath: `~/.ai-issue/kb/${version}` }));
  });
  test('mid-fetch HTTP error cleans staging', async () => {
    const sample = path.join(runtimeRoot, 'sample'); writeSample(sample); const tarBuf = await tarSample(sample); const digest = sha(tarBuf);
    queueResponses([{ body: releaseJson() }, { body: `${digest}\n` }, { status: 500, body: 'no' }, { status: 500, body: 'no' }, { status: 500, body: 'no' }, { status: 500, body: 'no' }]);
    await expect(installKnowledgeBase({})).rejects.toThrow(/HTTP 500/); expectNoInstall(); expect(https.get).toHaveBeenCalledTimes(6);
  });
  test('tarball SHA mismatch cleans staging', async () => {
    const sample = path.join(runtimeRoot, 'sample'); writeSample(sample); const tarBuf = await tarSample(sample);
    mockReleaseDownload(tarBuf, { sha: '0'.repeat(64) });
    await expect(installKnowledgeBase({})).rejects.toThrow(/SHA256 mismatch/); expectNoInstall();
  });
  test('lock contention aborts immediately without network', async () => {
    fs.mkdirSync(path.join(mockHome, '.ai-issue', 'kb'), { recursive: true }); fs.writeFileSync(path.join(mockHome, '.ai-issue', 'kb', '.lock'), 'x');
    const start = Date.now(); await expect(installKnowledgeBase({})).rejects.toThrow(/operation is in progress/);
    expect(Date.now() - start).toBeLessThan(100); expect(https.get).not.toHaveBeenCalled();
  });
  test.each([
    ['absolute path', evilTar('/etc/passwd-like'), /absolute path/],
    ['dotdot path', evilTar('../escapee.txt'), /\.\./],
    ['symlink', evilTar('link', '2', '../../outside'), /link entry/],
  ])('rejects tar attack: %s', async (_name, buf, message) => {
    mockReleaseDownload(buf); await expect(installKnowledgeBase({})).rejects.toThrow(message); expectNoInstall();
  });
  test('retries 5xx and succeeds on next attempt', async () => {
    const sample = path.join(runtimeRoot, 'sample'); writeSample(sample); const tarBuf = await tarSample(sample); const digest = sha(tarBuf);
    queueResponses([{ body: releaseJson() }, { body: `${digest}\n` }, { status: 500, body: 'no' }, { status: 200, body: tarBuf }]);
    await expect(installKnowledgeBase({})).resolves.toMatchObject({ version });
    expect(https.get).toHaveBeenCalledTimes(4);
  });
  test('does not retry 4xx', async () => {
    queueResponses([{ status: 404, body: 'not found' }]);
    await expect(installKnowledgeBase({})).rejects.toThrow(/HTTP 404/); expect(https.get).toHaveBeenCalledTimes(1);
  });
  test('total timeout aborts hanging request', async () => {
    _internal.HTTP_TIMEOUT_MS = 30; _internal.FIRST_BYTE_TIMEOUT_MS = 1000;
    queueResponses([{ never: true }]);
    await expect(installKnowledgeBase({})).rejects.toThrow(/timed out/);
  });
  test('range resume appends on 206 and restarts on 200', async () => {
    const partial = path.join(runtimeRoot, 'file.partial'); const final = path.join(runtimeRoot, 'file.tar.gz');
    fs.writeFileSync(partial, 'abc'); queueResponses([{ status: 206, body: 'def' }]);
    await _test.downloadFile('https://download/range', final, partial); expect(fs.readFileSync(final, 'utf8')).toBe('abcdef');
    fs.rmSync(final, { force: true }); fs.writeFileSync(partial, 'abc'); queueResponses([{ status: 200, body: 'xyz' }]);
    await _test.downloadFile('https://download/range', final, partial); expect(fs.readFileSync(final, 'utf8')).toBe('xyz');
  });
});

describe('commands/kb verify info remove', () => {
  test('verify exit codes 2, 3, 4, and 0', async () => {
    mockLoadConfig.mockReturnValue({ knowledgeBasePath: path.join(mockHome, 'missing') });
    await expect(cmdVerify()).rejects.toThrow('process.exit 2');
    const dir = path.join(mockHome, 'kbv'); writeSample(dir); fs.rmSync(path.join(dir, 'kb.jsonl'));
    mockLoadConfig.mockReturnValue({ knowledgeBasePath: dir }); await expect(cmdVerify()).rejects.toThrow('process.exit 3');
    writeSample(dir, { kbSha256: '0'.repeat(64) }); await expect(cmdVerify()).rejects.toThrow('process.exit 4');
    expect(error.mock.calls.flat().join('\n')).toContain('expected:'); expect(error.mock.calls.flat().join('\n')).toContain('actual:'); expect(error.mock.calls.flat().join('\n')).toContain('size:');
    writeSample(dir); await cmdVerify(); expect(success).toHaveBeenCalledWith(expect.stringContaining('OK:'));
  });
  test('info hides home path and marks private source', async () => {
    const dir = path.join(mockHome, '.ai-issue', 'kb', version); writeSample(dir, { sourceRepo: 'internal-org/private-fork', sourceCommit: 'abc' });
    mockLoadConfig.mockReturnValue({ knowledgeBasePath: `~/.ai-issue/kb/${version}` });
    await cmdInfo(); const output = log.mock.calls.flat().join('\n');
    expect(output).toContain(`~/.ai-issue/kb/${version}`); expect(output).not.toContain(mockHome); expect(output).toContain('[private]');
  });
  test('remove deletes dir and clears config, and is safe when unset', async () => {
    const dir = path.join(mockHome, '.ai-issue', 'kb', version); writeSample(dir);
    const cfg = { knowledgeBasePath: dir }; mockLoadConfig.mockReturnValue(cfg);
    await cmdRemove({ yes: true }); expect(fs.existsSync(dir)).toBe(false); expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ knowledgeBasePath: '' }));
    mockLoadConfig.mockReturnValue({ knowledgeBasePath: '' }); await cmdRemove({ yes: true }); expect(info).toHaveBeenCalledWith('Nothing to remove');
  });
});

describe('commands/kb update', () => {
  test('returns early with "no KB configured" when knowledgeBasePath is unset', async () => {
    mockLoadConfig.mockReturnValue({ knowledgeBasePath: '' });
    await cmdUpdate();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('No knowledge base configured'));
    expect(https.get).not.toHaveBeenCalled();
  });

  test('reports "up to date" when current version equals latest', async () => {
    mockLoadConfig.mockReturnValue({ knowledgeBasePath: `~/.ai-issue/kb/${version}` });
    queueResponses([{ body: releaseJson(version) }]);
    await cmdUpdate({ source: 'jiaweitao001/ai-issue-cli' });
    expect(info).toHaveBeenCalledWith(expect.stringContaining(`up to date: ${version}`));
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  test('skips install with "KB outdated, skip update in CI" when CI=true and newer version exists', async () => {
    process.env.CI = 'true';
    mockLoadConfig.mockReturnValue({ knowledgeBasePath: `~/.ai-issue/kb/2026.01.01` });
    queueResponses([{ body: releaseJson(version) }]);
    await cmdUpdate({ source: 'jiaweitao001/ai-issue-cli' });
    expect(info).toHaveBeenCalledWith(expect.stringContaining('KB outdated, skip update in CI'));
    expect(mockSaveConfig).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(mockHome, '.ai-issue', 'kb', version))).toBe(false);
  });

  test('downloads newer version when not in CI', async () => {
    mockLoadConfig.mockReturnValue({ knowledgeBasePath: `~/.ai-issue/kb/2026.01.01` });
    const sample = path.join(runtimeRoot, 'sample-update'); writeSample(sample);
    const tarBuf = await tarSample(sample); const digest = sha(tarBuf);
    queueResponses([
      { body: releaseJson(version) },
      { body: releaseJson(version) },
      { body: `${digest}  kb-${version}.tar.gz\n` },
      { status: 200, body: tarBuf },
    ]);
    await cmdUpdate({ source: 'jiaweitao001/ai-issue-cli' });
    expect(fs.existsSync(path.join(mockHome, '.ai-issue', 'kb', version, 'manifest.json'))).toBe(true);
    expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ knowledgeBasePath: `~/.ai-issue/kb/${version}` }));
  });
});

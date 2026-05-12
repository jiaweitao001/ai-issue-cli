// @ts-check
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const tar = require('tar');
const { loadConfig, saveConfig } = require('../config');
const { log, info, success, warning, error } = require('../logger');
const { LocalKnowledgeBase } = require('../local-knowledge-base');
const { expandHome, loadManifest, verifySha256 } = require('../kb-resolver');
const { promptInput } = require('../prompts');

const DEFAULT_SOURCE = 'jiaweitao001/ai-issue-cli';
const PUBLIC_SOURCE_ORGS = new Set(['hashicorp', 'kubernetes', 'opentofu']);
const _internal = {
  CONNECT_TIMEOUT_MS: 10_000,
  FIRST_BYTE_TIMEOUT_MS: 30_000,
  HTTP_TIMEOUT_MS: 5 * 60_000,
  RETRY_DELAYS_MS: [500, 2_000, 8_000],
};

function displayPathWithHome(filePath) {
  const expanded = expandHome(filePath || '');
  const home = os.homedir();
  if (expanded && home && (expanded === home || expanded.startsWith(`${home}${path.sep}`))) return `~${expanded.slice(home.length)}`;
  return expanded;
}
function kbRoot() { return path.join(os.homedir(), '.ai-issue', 'kb'); }
function stagingRoot() { return path.join(kbRoot(), '.staging'); }
function sanitizeVersion(version) {
  const value = String(version || '').trim();
  if (!value || value.includes('/') || value.includes('\\') || value.includes('\u0000') || value.includes('..')) {
    throw Object.assign(new Error(`Invalid KB version: ${value || '(empty)'}`), { code: 'INVALID_VERSION' });
  }
  return value;
}
function parseRepo(source) {
  const repo = source || DEFAULT_SOURCE;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw Object.assign(new Error(`Invalid source repo: ${repo}`), { code: 'INVALID_SOURCE' });
  return repo;
}
function parseSha256(text) {
  const match = String(text || '').match(/[a-fA-F0-9]{64}/);
  if (!match) throw Object.assign(new Error('SHA256 asset did not contain a 64-character hex digest'), { code: 'INVALID_SHA256_ASSET' });
  return match[0].toLowerCase();
}
function withTotalTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out after ${_internal.HTTP_TIMEOUT_MS}ms`), { code: 'HTTP_TIMEOUT' })), _internal.HTTP_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
function requestUrl(url, options = {}) {
  return withTotalTimeout(new Promise((resolve, reject) => {
    let firstByteTimer; let settled = false;
    const headers = { 'User-Agent': 'ai-issue-cli', Accept: 'application/vnd.github+json', ...(options.headers || {}) };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const req = https.get(url, { headers }, (res) => { clearTimeout(firstByteTimer); settled = true; resolve({ req, res }); });
    req.setTimeout(_internal.CONNECT_TIMEOUT_MS, () => req.destroy(Object.assign(new Error(`Connection timed out after ${_internal.CONNECT_TIMEOUT_MS}ms`), { code: 'ETIMEDOUT' })));
    firstByteTimer = setTimeout(() => {
      if (!settled) req.destroy(Object.assign(new Error(`First byte timed out after ${_internal.FIRST_BYTE_TIMEOUT_MS}ms`), { code: 'EFIRSTBYTE_TIMEOUT' }));
    }, _internal.FIRST_BYTE_TIMEOUT_MS);
    req.on('error', (err) => { clearTimeout(firstByteTimer); reject(err); });
  }), `GET ${url}`);
}
function readResponseText(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', chunk => chunks.push(Buffer.from(chunk)));
    res.on('error', reject);
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}
async function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function retryHttp(fn) {
  let lastError;
  const attempts = _internal.RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await fn(attempt); } catch (err) {
      lastError = err;
      if (err && err.status >= 400 && err.status < 500) throw err;
      if (!(err && (err.status >= 500 || err.code === 'HTTP_5XX')) || attempt === attempts - 1) break;
      await sleep(_internal.RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}
async function fetchJson(url) {
  return retryHttp(async () => {
    const { res } = await requestUrl(url);
    const status = res.statusCode || 0;
    const body = await readResponseText(res);
    if (status >= 500) throw Object.assign(new Error(`HTTP ${status} fetching ${url}`), { code: 'HTTP_5XX', status });
    if (status >= 400) throw Object.assign(new Error(`HTTP ${status} fetching ${url}: ${body}`), { code: 'HTTP_4XX', status });
    return JSON.parse(body);
  });
}
async function fetchText(url) {
  return retryHttp(async () => {
    const { res } = await requestUrl(url);
    const status = res.statusCode || 0;
    const body = await readResponseText(res);
    if (status >= 500) throw Object.assign(new Error(`HTTP ${status} fetching ${url}`), { code: 'HTTP_5XX', status });
    if (status >= 400) throw Object.assign(new Error(`HTTP ${status} fetching ${url}: ${body}`), { code: 'HTTP_4XX', status });
    return body;
  });
}
async function fetchRelease(source, version) {
  const repo = parseRepo(source);
  const suffix = version ? `/releases/tags/${encodeURIComponent(version)}` : '/releases/latest';
  return fetchJson(`https://api.github.com/repos/${repo}${suffix}`);
}
function releaseVersion(release, requestedVersion) {
  const tag = requestedVersion || release.tag_name || release.name || '';
  return sanitizeVersion(String(tag).replace(/^kb-/, '').replace(/^v/, ''));
}
function findAsset(release, name) {
  return (Array.isArray(release.assets) ? release.assets : []).find(asset => asset && asset.name === name && asset.browser_download_url);
}
function createStagingNames(version) {
  const base = `${sanitizeVersion(version)}-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  return { tarPath: path.join(stagingRoot(), `${base}.tar.gz`), partialPath: path.join(stagingRoot(), `${base}.tar.gz.partial`), extractDir: path.join(stagingRoot(), base), base };
}
function acquireLock() {
  fs.mkdirSync(kbRoot(), { recursive: true });
  const lockPath = path.join(kbRoot(), '.lock');
  let fd;
  try {
    fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, `${process.pid}\n`);
    fs.closeSync(fd);
  } catch (err) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_e) {} }
    if (err && err.code === 'EEXIST') throw Object.assign(new Error(`another \`ai-issue kb\` operation is in progress (lock: ${displayPathWithHome(lockPath)})`), { code: 'LOCKED', exitCode: 1 });
    throw err;
  }
  const cleanup = () => { try { fs.unlinkSync(lockPath); } catch (_err) {} };
  process.once('exit', cleanup);
  return () => { cleanup(); process.removeListener('exit', cleanup); };
}
function drain(res) { return new Promise(resolve => { res.resume(); res.on('end', resolve); res.on('error', resolve); }); }
function pipeToFile(res, filePath, flags) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(filePath, { flags });
    let done = false;
    const finish = (err) => { if (done) return; done = true; err ? reject(err) : resolve(); };
    res.on('error', finish); out.on('error', finish); out.on('finish', () => finish()); res.pipe(out);
  });
}
async function downloadFile(url, finalPath, partialPath) {
  return retryHttp(async () => {
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    let start = fs.existsSync(partialPath) ? fs.statSync(partialPath).size : 0;
    const { res } = await requestUrl(url, { headers: start > 0 ? { Range: `bytes=${start}-` } : {} });
    const status = res.statusCode || 0;
    if (status >= 500) { await drain(res); throw Object.assign(new Error(`HTTP ${status} downloading ${url}`), { code: 'HTTP_5XX', status }); }
    if (status >= 400) { await drain(res); throw Object.assign(new Error(`HTTP ${status} downloading ${url}`), { code: 'HTTP_4XX', status }); }
    let append = false;
    if (start > 0) {
      if (status === 206) append = true;
      else { fs.rmSync(partialPath, { force: true }); start = 0; }
    }
    await pipeToFile(res, partialPath, append ? 'a' : 'w');
    fs.renameSync(partialPath, finalPath);
    return finalPath;
  });
}
async function extractTarSafe(tarPath, extractDir) {
  fs.mkdirSync(extractDir, { recursive: true });
  let unsafe = null;
  await tar.x({
    file: tarPath, cwd: extractDir, strict: true, preservePaths: false,
    filter: (entryPath, /** @type {any} */ entry) => {
      if (entryPath.startsWith('/')) unsafe = Object.assign(new Error(`Refusing tar entry with absolute path: ${entryPath}`), { code: 'TAR_ABSOLUTE_PATH' });
      else if (entryPath.includes('..')) unsafe = Object.assign(new Error(`Refusing tar entry containing '..': ${entryPath}`), { code: 'TAR_DOTDOT_PATH' });
      else if (entryPath.includes('\u0000')) unsafe = Object.assign(new Error('Refusing tar entry containing NUL byte'), { code: 'TAR_NUL_PATH' });
      else if (entry && (entry.type === 'Link' || entry.type === 'SymbolicLink')) unsafe = Object.assign(new Error(`Refusing tar link entry: ${entry.path || entryPath}`), { code: 'TAR_LINK_ENTRY' });
      return !unsafe;
    },
    onentry: /** @type {any} */ (entry) => {
      if (entry.type === 'Link' || entry.type === 'SymbolicLink') unsafe = unsafe || Object.assign(new Error(`Refusing tar link entry: ${entry.path}`), { code: 'TAR_LINK_ENTRY' });
    }
  });
  if (unsafe) throw unsafe;
  assertNoSymlinks(extractDir);
}
function assertNoSymlinks(root) {
  for (const name of fs.readdirSync(root)) {
    const p = path.join(root, name);
    const stat = fs.lstatSync(p);
    if (stat.isSymbolicLink()) throw Object.assign(new Error(`Refusing extracted symlink: ${displayPathWithHome(p)}`), { code: 'TAR_SYMLINK_FOUND' });
    if (stat.isDirectory()) assertNoSymlinks(p);
  }
}
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject); stream.on('data', chunk => hash.update(chunk)); stream.on('end', () => resolve(hash.digest('hex')));
  });
}
async function installKnowledgeBase(options = {}) {
  const source = parseRepo(options.source || DEFAULT_SOURCE);
  let unlock; let staging;
  try {
    unlock = acquireLock();
    const release = await fetchRelease(source, options.version);
    const version = releaseVersion(release, options.version);
    const tarAsset = findAsset(release, `kb-${version}.tar.gz`);
    const shaAsset = findAsset(release, `kb-${version}.tar.gz.sha256`);
    if (!tarAsset || !shaAsset) throw Object.assign(new Error(`Release is missing kb-${version}.tar.gz or .sha256 asset`), { code: 'ASSET_MISSING' });
    fs.mkdirSync(stagingRoot(), { recursive: true });
    staging = createStagingNames(version);
    const expectedTarSha = parseSha256(await fetchText(shaAsset.browser_download_url));
    await downloadFile(tarAsset.browser_download_url, staging.tarPath, staging.partialPath);
    const actualTarSha = await hashFile(staging.tarPath);
    if (actualTarSha !== expectedTarSha) throw Object.assign(new Error(`Downloaded tarball SHA256 mismatch: expected ${expectedTarSha}, actual ${actualTarSha}`), { code: 'TARBALL_SHA256_MISMATCH', expected: expectedTarSha, actual: actualTarSha });
    await extractTarSafe(staging.tarPath, staging.extractDir);
    const manifest = loadManifest(staging.extractDir);
    const kbSha = await verifySha256(path.join(staging.extractDir, 'kb.jsonl'), manifest.kbSha256);
    if (!kbSha.ok) throw Object.assign(new Error(`Knowledge base kb.jsonl SHA256 mismatch: expected ${kbSha.expected}, actual ${kbSha.actual}`), { code: 'KB_SHA256_MISMATCH', expected: kbSha.expected, actual: kbSha.actual });
    await new LocalKnowledgeBase(staging.extractDir).load();
    const finalDir = path.join(kbRoot(), version);
    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.renameSync(staging.extractDir, finalDir);
    fs.rmSync(staging.tarPath, { force: true }); fs.rmSync(staging.partialPath, { force: true });
    const config = loadConfig(); config.knowledgeBasePath = `~/.ai-issue/kb/${version}`; saveConfig(config);
    const message = `✅ Knowledge base installed: ~/.ai-issue/kb/${version}`;
    if (process.env.CI === 'true') console.error(message); else success(message);
    return { version, path: finalDir, displayPath: `~/.ai-issue/kb/${version}` };
  } catch (err) {
    if (staging) { fs.rmSync(staging.extractDir, { recursive: true, force: true }); fs.rmSync(staging.tarPath, { force: true }); fs.rmSync(staging.partialPath, { force: true }); }
    throw err;
  } finally { if (unlock) unlock(); }
}
async function runAndExitOnError(fn) { try { return await fn(); } catch (err) { error(err && err.message ? err.message : String(err)); process.exit(err && typeof err.exitCode === 'number' ? err.exitCode : 1); } }
async function cmdDownload(options = {}) { return runAndExitOnError(() => installKnowledgeBase(options)); }
function compareVersion(a, b) {
  const parse = value => String(value || '').split(/[^0-9A-Za-z]+/).filter(Boolean).map(part => (/^\d+$/.test(part) ? Number(part) : part));
  const left = parse(a); const right = parse(b); const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) { const l = left[i] == null ? 0 : left[i]; const r = right[i] == null ? 0 : right[i]; if (l === r) continue; if (typeof l === 'number' && typeof r === 'number') return l > r ? 1 : -1; return String(l) > String(r) ? 1 : -1; }
  return 0;
}
async function cmdUpdate(options = {}) {
  return runAndExitOnError(async () => {
    const config = loadConfig();
    if (!config.knowledgeBasePath) { info('No knowledge base configured. Run `ai-issue kb download`.'); return; }
    const current = path.basename(expandHome(config.knowledgeBasePath));
    const release = await fetchRelease(options.source || DEFAULT_SOURCE);
    const latest = releaseVersion(release);
    if (current === latest || compareVersion(current, latest) >= 0) { info(`Knowledge base is up to date: ${current}`); return; }
    if (process.env.CI === 'true') { info('KB outdated, skip update in CI'); return; }
    await installKnowledgeBase({ ...options, version: latest });
  });
}
function readKbEntries(kbDir) {
  const kbPath = path.join(kbDir, 'kb.jsonl');
  const content = fs.existsSync(kbPath) ? fs.readFileSync(kbPath, 'utf8') : '';
  return content.split('\n').filter(Boolean).map(line => JSON.parse(line));
}
function formatEntryCounts(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry.type || 'unknown', (counts.get(entry.type || 'unknown') || 0) + 1);
  return Array.from(counts.entries()).map(([type, count]) => `${count} ${type}`).join(', ');
}
function isPrivateSource(sourceRepo) { const org = String(sourceRepo || '').split('/')[0]; return !!org && !PUBLIC_SOURCE_ORGS.has(org.toLowerCase()); }
async function cmdInfo(_options) {
  return runAndExitOnError(async () => {
    const config = loadConfig();
    if (!config.knowledgeBasePath) { info('No knowledge base configured. Run `ai-issue kb download`.'); return; }
    const kbDir = expandHome(config.knowledgeBasePath);
    const manifest = loadManifest(kbDir);
    const entries = readKbEntries(kbDir);
    if (process.env.AI_ISSUE_DEBUG === 'true') {
      warning('Debug output may include source metadata; review before sharing.');
      if (manifest.sourceRepo && isPrivateSource(manifest.sourceRepo)) warning('manifest source contains organization information; evaluate before sharing KB output.');
    }
    log(`Knowledge base: ${displayPathWithHome(kbDir)}`);
    log(`  Version:    ${manifest.version || path.basename(kbDir)}`);
    log(`  Entries:    ${entries.length}${entries.length ? ` (${formatEntryCounts(entries)})` : ''}`);
    if (manifest.sourceRepo) log(`  Source:     ${manifest.sourceRepo}${manifest.sourceCommit ? ` @ ${manifest.sourceCommit}` : ''}${isPrivateSource(manifest.sourceRepo) ? ' [private]' : ''}`);
    if (manifest.quality || manifest.qualityGate) {
      const q = manifest.quality || {}; const parts = [];
      if (q.recallAt3 != null) parts.push(`Recall@3 = ${q.recallAt3}`); if (q.mrrAt5 != null) parts.push(`MRR@5 = ${q.mrrAt5}`); if (q.resourceHit != null) parts.push(`ResourceHit = ${q.resourceHit}`);
      parts.push(`→ ${manifest.qualityGate === 'passed' ? 'enabled' : (manifest.qualityGate || 'unknown')}`); log(`  Quality:    ${parts.join('  ')}`);
    }
    if (manifest.license) log(`  License:    ${manifest.license}`);
  });
}
async function cmdVerify(options = {}) {
  const kbDir = expandHome(options.path || loadConfig().knowledgeBasePath || '');
  const display = displayPathWithHome(kbDir);
  try {
    if (!kbDir || !fs.existsSync(kbDir) || !fs.existsSync(path.join(kbDir, 'manifest.json'))) { error('Missing manifest.json. Run: ai-issue kb download'); process.exit(2); return; }
    const manifest = loadManifest(kbDir);
    const required = ['kb.jsonl'];
    if (manifest.indexes && manifest.indexes.df) required.push(manifest.indexes.df); else if (fs.existsSync(path.join(kbDir, 'kb-df.json'))) required.push('kb-df.json');
    const missing = required.find(file => !fs.existsSync(path.join(kbDir, file)));
    if (missing) { error(`Missing ${missing}. Run: ai-issue kb download`); process.exit(3); return; }
    const kbPath = path.join(kbDir, 'kb.jsonl');
    const result = await verifySha256(kbPath, manifest.kbSha256);
    if (!result.ok) { error('SHA256 mismatch'); error(`expected: ${result.expected}`); error(`actual: ${result.actual}`); error(`size: ${fs.statSync(kbPath).size}`); process.exit(4); return; }
    success(`OK: ${display} @ ${manifest.version || path.basename(kbDir)} (${readKbEntries(kbDir).length} entries)`);
  } catch (err) {
    if (err && /^process\.exit /.test(err.message || '')) throw err;
    error(err && err.message ? err.message : String(err));
    process.exit(1);
  }
}
async function confirmRemove() { if (process.env.CI === 'true') return true; const answer = await promptInput('Remove local knowledge base? (y/N) '); return /^y(es)?$/i.test(String(answer || '').trim()); }
async function cmdRemove(options = {}) {
  return runAndExitOnError(async () => {
    const config = loadConfig();
    if (!config.knowledgeBasePath) { info('Nothing to remove'); return; }
    const kbDir = expandHome(config.knowledgeBasePath);
    if (!options.yes && !(await confirmRemove())) { info('Cancelled, no changes.'); return; }
    fs.rmSync(kbDir, { recursive: true, force: true }); config.knowledgeBasePath = ''; saveConfig(config); success(`Removed knowledge base: ${displayPathWithHome(kbDir)}`);
  });
}
async function cmdKb(action, options = {}) {
  if (action === 'download') return cmdDownload(options);
  if (action === 'update') return cmdUpdate(options);
  if (action === 'info') return cmdInfo(options);
  if (action === 'verify') return cmdVerify(options);
  if (action === 'remove') return cmdRemove(options);
  error(`Unknown kb action: ${action || ''}`); error('Available actions: download, update, info, verify, remove'); process.exit(1);
}
module.exports = { cmdKb, cmdDownload, cmdUpdate, cmdInfo, cmdVerify, cmdRemove, installKnowledgeBase, _internal, _test: { extractTarSafe, displayPathWithHome, isPrivateSource, downloadFile, createStagingNames } };

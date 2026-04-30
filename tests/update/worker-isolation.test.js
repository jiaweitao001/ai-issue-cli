// @ts-check
'use strict';

/**
 * Static-analysis test for the update worker (UPDATE_COMMAND_PROPOSAL.md §6.1).
 *
 * The worker is staged out of the npm-managed package directory at
 * `~/.ai-issue/cache/update-worker-<sha>.js` and runs DURING `npm install`,
 * which is in the process of overwriting `lib/*.js`. Therefore the worker
 * MUST NOT `require(...)` any project-internal module — only Node built-ins.
 *
 * This file enforces that invariant by reading the worker source verbatim
 * (NO mocking) and scanning every require() call site.
 *
 * NOTE: This test deliberately does NOT mock fs.
 */

const realFs = jest.requireActual('fs');
const path = require('path');

const BUILT_IN_MODULES = new Set([
  // CommonJS built-ins (Node >= 16). Keep in sync with `node -e "require('module').builtinModules"`.
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'dns/promises',
  'domain', 'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector',
  'module', 'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'readline/promises',
  'repl', 'stream', 'stream/consumers', 'stream/promises', 'stream/web',
  'string_decoder', 'sys', 'timers', 'timers/promises', 'tls', 'trace_events',
  'tty', 'url', 'util', 'util/types', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

describe('lib/update/worker isolation', () => {
  const workerPath = path.join(__dirname, '..', '..', 'lib', 'update', 'worker.js');
  const src = realFs.readFileSync(workerPath, 'utf8');

  test('only requires Node built-ins (no project deps)', () => {
    const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    const offenders = [];
    let m;
    while ((m = requireRe.exec(src)) !== null) {
      const mod = m[1];
      if (mod.startsWith('node:')) continue; // node: prefix is always built-in
      if (BUILT_IN_MODULES.has(mod)) continue;
      offenders.push(mod);
    }
    expect(offenders).toEqual([]);
  });

  test('does not invoke ai-issue.js or any project lib/* file via subprocess', () => {
    // Best-effort regex per UPDATE_COMMAND_PROPOSAL.md §6.1: catches an
    // accidental execFileSync/spawn that points back at the package's own files.
    const subprocessRe = /(?:execFileSync|spawnSync|spawn)\s*\([^)]*?(?:lib\/[a-zA-Z]|ai-issue\.js)[^)]*?\)/g;
    const matches = src.match(subprocessRe) || [];
    expect(matches).toEqual([]);
  });

  test('does not require any path containing ../ (would escape into project tree)', () => {
    const relRe = /require\(\s*['"](\.\.\/[^'"]+)['"]\s*\)/g;
    const matches = src.match(relRe) || [];
    expect(matches).toEqual([]);
  });

  test('does not require a sibling project file via ./[^worker]', () => {
    // Allow `./` only if it's the worker itself or zero-occurrences. We do
    // NOT want any sibling like `./logger`, `./config`, etc.
    const sibRe = /require\(\s*['"]\.\/([^'"]+)['"]\s*\)/g;
    const matches = [];
    let m;
    while ((m = sibRe.exec(src)) !== null) {
      matches.push(m[1]);
    }
    expect(matches).toEqual([]);
  });
});

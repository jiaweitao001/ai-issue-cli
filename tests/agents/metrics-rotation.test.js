// @ts-check
/**
 * Tests for lib/agents/metrics-rotation.js (SKILLS_ENHANCEMENT_PLAN §C2.3).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { rotateIfNeeded, rotatedPath, DEFAULT_MAX_BYTES, DEFAULT_KEEP } =
  require('../../lib/agents/metrics-rotation');

let dir;
let active;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-rotation-test-'));
  active = path.join(dir, 'skills.jsonl');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function fileExists(p) { return fs.existsSync(p); }

describe('rotatedPath', () => {
  it('inserts the rotation index before the extension', () => {
    expect(rotatedPath('/a/b/skills.jsonl', 1)).toBe(path.join('/a/b', 'skills.1.jsonl'));
    expect(rotatedPath('/a/b/skills.jsonl', 3)).toBe(path.join('/a/b', 'skills.3.jsonl'));
  });
});

describe('rotateIfNeeded', () => {
  it('does nothing when the active file does not exist', () => {
    expect(() => rotateIfNeeded(active)).not.toThrow();
    expect(fileExists(active)).toBe(false);
  });

  it('does nothing when the file is under maxBytes', () => {
    fs.writeFileSync(active, 'small\n');
    rotateIfNeeded(active, { maxBytes: 1024 });
    expect(fileExists(active)).toBe(true);
    expect(fileExists(rotatedPath(active, 1))).toBe(false);
  });

  it('rotates when the file exceeds maxBytes', () => {
    fs.writeFileSync(active, 'x'.repeat(2000));
    rotateIfNeeded(active, { maxBytes: 1000 });
    expect(fileExists(active)).toBe(false);
    expect(fileExists(rotatedPath(active, 1))).toBe(true);
    expect(fs.readFileSync(rotatedPath(active, 1), 'utf8')).toHaveLength(2000);
  });

  it('shifts existing rotated files up and drops the oldest', () => {
    fs.writeFileSync(active, 'x'.repeat(2000));
    fs.writeFileSync(rotatedPath(active, 1), 'old1');
    fs.writeFileSync(rotatedPath(active, 2), 'old2');
    fs.writeFileSync(rotatedPath(active, 3), 'old3');
    rotateIfNeeded(active, { maxBytes: 1000, keep: 3 });
    expect(fileExists(active)).toBe(false);
    expect(fs.readFileSync(rotatedPath(active, 1), 'utf8')).toHaveLength(2000);
    expect(fs.readFileSync(rotatedPath(active, 2), 'utf8')).toBe('old1');
    expect(fs.readFileSync(rotatedPath(active, 3), 'utf8')).toBe('old2');
    // old3 dropped (no .4)
    expect(fileExists(rotatedPath(active, 4))).toBe(false);
  });

  it('uses 10 MB as the default cap', () => {
    expect(DEFAULT_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(DEFAULT_KEEP).toBe(3);
  });

  it('is a no-op when activePath is empty/null', () => {
    expect(() => rotateIfNeeded('')).not.toThrow();
    expect(() => rotateIfNeeded(null)).not.toThrow();
  });

  it('respects custom keep count', () => {
    fs.writeFileSync(active, 'x'.repeat(2000));
    fs.writeFileSync(rotatedPath(active, 1), 'old1');
    rotateIfNeeded(active, { maxBytes: 1000, keep: 1 });
    // keep=1 means only .1 is kept; the previous .1 should be dropped (overwritten by new .1)
    expect(fileExists(active)).toBe(false);
    expect(fs.readFileSync(rotatedPath(active, 1), 'utf8')).toHaveLength(2000);
    expect(fileExists(rotatedPath(active, 2))).toBe(false);
  });
});

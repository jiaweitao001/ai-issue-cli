// @ts-check
/**
 * Tests for lib/skills-metrics.js (SKILLS_ENHANCEMENT_PLAN §C2).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const skillsMetrics = require('../lib/skills-metrics');
const { wrapToolHandler, emitMetric, ENV_VAR, __internal } = skillsMetrics;
const { computeMetric } = __internal;

let metricsDir;
let metricsFile;
let originalEnv;

beforeEach(() => {
  metricsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-metrics-test-'));
  metricsFile = path.join(metricsDir, 'skills.jsonl');
  originalEnv = process.env[ENV_VAR];
  delete process.env[ENV_VAR];
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env[ENV_VAR];
  else process.env[ENV_VAR] = originalEnv;
  fs.rmSync(metricsDir, { recursive: true, force: true });
});

function readLines() {
  if (!fs.existsSync(metricsFile)) return [];
  return fs.readFileSync(metricsFile, 'utf8').split('\n').filter(l => l.length > 0);
}

describe('emitMetric', () => {
  it('is a no-op when env var is unset', () => {
    emitMetric({ tool: 'x' });
    expect(fs.existsSync(metricsFile)).toBe(false);
  });

  it('appends one JSON line + newline when env var is set', () => {
    process.env[ENV_VAR] = metricsFile;
    emitMetric({ tool: 'x', latency_ms: 5 });
    const lines = readLines();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ tool: 'x', latency_ms: 5 });
  });

  it('appends a second line on a second call (does not truncate)', () => {
    process.env[ENV_VAR] = metricsFile;
    emitMetric({ tool: 'a' });
    emitMetric({ tool: 'b' });
    const lines = readLines();
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).tool).toBe('a');
    expect(JSON.parse(lines[1]).tool).toBe('b');
  });

  it('swallows write errors when target is unwritable', () => {
    // Point at a path inside a non-existent dir → appendFileSync throws ENOENT
    process.env[ENV_VAR] = path.join(metricsDir, 'no-such-subdir', 'skills.jsonl');
    expect(() => emitMetric({ tool: 'x' })).not.toThrow();
  });
});

describe('computeMetric', () => {
  it('produces the documented schema', () => {
    const startNs = 1000n;
    const endNs = 6000000n; // 5 ms in nanoseconds (6_000_000 - 1_000 = 5_999_000ns ≈ 5ms)
    const m = computeMetric({
      skillName: 'demo',
      toolName: 'do_something',
      startNs,
      endNs,
      result: { ok: true, items: [1, 2, 3] },
    });
    expect(m.skill).toBe('demo');
    expect(m.tool).toBe('do_something');
    expect(m.latency_ms).toBe(5);
    expect(m.output_size_chars).toBe(JSON.stringify({ ok: true, items: [1, 2, 3] }).length);
    expect(typeof m.timestamp).toBe('string');
    expect(() => new Date(m.timestamp)).not.toThrow();
    expect(m).not.toHaveProperty('error');
  });

  it('measures characters not bytes (UTF-8 safety)', () => {
    const m = computeMetric({
      skillName: 'demo',
      toolName: 'x',
      startNs: 0n,
      endNs: 0n,
      result: { msg: '你好' }, // 2 chars but 6 bytes in UTF-8
    });
    expect(m.output_size_chars).toBe(JSON.stringify({ msg: '你好' }).length);
  });

  it('falls back to -1 output_size_chars when result is unstringifiable (cycle)', () => {
    const cycle = {};
    cycle.self = cycle;
    const m = computeMetric({
      skillName: 'demo',
      toolName: 'x',
      startNs: 0n,
      endNs: 0n,
      result: cycle,
    });
    expect(m.output_size_chars).toBe(-1);
  });

  it('emits error: true and zero output_size_chars on error path', () => {
    const m = computeMetric({
      skillName: 'demo',
      toolName: 'x',
      startNs: 0n,
      endNs: 1000000n,
      error: true,
    });
    expect(m.error).toBe(true);
    expect(m.output_size_chars).toBe(0);
    expect(m.latency_ms).toBe(1);
  });

  it('uses null toolName when undefined (does not throw)', () => {
    const m = computeMetric({
      skillName: 'demo',
      toolName: undefined,
      startNs: 0n,
      endNs: 0n,
      result: {},
    });
    expect(m.tool).toBeNull();
  });
});

describe('wrapToolHandler', () => {
  it('throws TypeError for non-function handler', () => {
    expect(() => wrapToolHandler('not-a-fn', 'demo')).toThrow(TypeError);
  });

  it('throws TypeError for empty skillName', () => {
    expect(() => wrapToolHandler(async () => {}, '')).toThrow(TypeError);
    expect(() => wrapToolHandler(async () => {}, null)).toThrow(TypeError);
  });

  it('returns the wrapped handler that forwards request and result', async () => {
    const handler = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    const wrapped = wrapToolHandler(handler, 'demo');
    const req = { params: { name: 'do_thing', arguments: { x: 1 } } };
    const res = await wrapped(req);
    expect(handler).toHaveBeenCalledWith(req);
    expect(res).toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });

  it('writes a metric line on success when env var is set', async () => {
    process.env[ENV_VAR] = metricsFile;
    const handler = jest.fn().mockResolvedValue({ ok: true });
    const wrapped = wrapToolHandler(handler, 'demo-skill');
    await wrapped({ params: { name: 'do_thing', arguments: {} } });
    const lines = readLines();
    expect(lines).toHaveLength(1);
    const m = JSON.parse(lines[0]);
    expect(m.skill).toBe('demo-skill');
    expect(m.tool).toBe('do_thing');
    expect(typeof m.latency_ms).toBe('number');
    expect(m.latency_ms).toBeGreaterThanOrEqual(0);
    expect(m.output_size_chars).toBe(JSON.stringify({ ok: true }).length);
    expect(m).not.toHaveProperty('error');
  });

  it('writes a metric line with error: true when handler throws, and re-throws', async () => {
    process.env[ENV_VAR] = metricsFile;
    const handler = jest.fn().mockRejectedValue(new Error('boom'));
    const wrapped = wrapToolHandler(handler, 'demo-skill');
    await expect(
      wrapped({ params: { name: 'do_thing', arguments: {} } })
    ).rejects.toThrow('boom');
    const lines = readLines();
    expect(lines).toHaveLength(1);
    const m = JSON.parse(lines[0]);
    expect(m.error).toBe(true);
    expect(m.tool).toBe('do_thing');
    expect(m.skill).toBe('demo-skill');
    expect(m.output_size_chars).toBe(0);
  });

  it('does not write anything when env var is unset', async () => {
    const handler = jest.fn().mockResolvedValue({ ok: true });
    const wrapped = wrapToolHandler(handler, 'demo');
    await wrapped({ params: { name: 'x', arguments: {} } });
    expect(fs.existsSync(metricsFile)).toBe(false);
  });

  it('handles missing request.params gracefully (tool=null)', async () => {
    process.env[ENV_VAR] = metricsFile;
    const handler = jest.fn().mockResolvedValue({ ok: true });
    const wrapped = wrapToolHandler(handler, 'demo');
    await wrapped({});
    const lines = readLines();
    expect(JSON.parse(lines[0]).tool).toBeNull();
  });

  it('preserves return value identity (no deep clone)', async () => {
    process.env[ENV_VAR] = metricsFile;
    const obj = { mutable: true };
    const handler = jest.fn().mockResolvedValue(obj);
    const wrapped = wrapToolHandler(handler, 'demo');
    const res = await wrapped({ params: { name: 'x', arguments: {} } });
    expect(res).toBe(obj);
  });

  it('does not break the skill if metrics write throws', async () => {
    process.env[ENV_VAR] = path.join(metricsDir, 'missing-subdir', 'skills.jsonl');
    const handler = jest.fn().mockResolvedValue({ ok: true });
    const wrapped = wrapToolHandler(handler, 'demo');
    await expect(
      wrapped({ params: { name: 'x', arguments: {} } })
    ).resolves.toEqual({ ok: true });
  });
});

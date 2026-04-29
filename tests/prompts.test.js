/**
 * Tests for lib/prompts.js
 */
const { Readable, Writable } = require('stream');
const {
  selectionStateMachine,
  _parseKeyEvents,
  runNumberedSelect,
  promptSelect,
  promptInput,
} = require('../lib/prompts');

/**
 * Build a Writable that captures writes into an array of strings.
 */
function makeCaptureStream() {
  const chunks = [];
  const w = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  w.captured = () => chunks.join('');
  return w;
}

/**
 * Build a Readable that yields a single string then ends.
 */
function makeStringReadable(s) {
  const r = Readable.from([s]);
  // Numbered select doesn't use isTTY, but be explicit.
  r.isTTY = false;
  return r;
}

describe('prompts: selectionStateMachine', () => {
  it('initializes at the requested index', () => {
    const m = selectionStateMachine(5, { initialIndex: 2 });
    expect(m.getIndex()).toBe(2);
  });

  it('clamps initialIndex into the valid range', () => {
    expect(selectionStateMachine(3, { initialIndex: 99 }).getIndex()).toBe(2);
    expect(selectionStateMachine(3, { initialIndex: -5 }).getIndex()).toBe(0);
  });

  it('throws on non-positive itemCount', () => {
    expect(() => selectionStateMachine(0)).toThrow();
    expect(() => selectionStateMachine(-1)).toThrow();
    expect(() => selectionStateMachine(1.5)).toThrow();
  });

  it('moves down with wrap-around', () => {
    const m = selectionStateMachine(3, { initialIndex: 0 });
    expect(m.handle('down').kind).toBe('cursor');
    expect(m.getIndex()).toBe(1);
    m.handle('down');
    m.handle('down');
    expect(m.getIndex()).toBe(0); // wrapped
  });

  it('moves up with wrap-around', () => {
    const m = selectionStateMachine(3, { initialIndex: 0 });
    m.handle('up');
    expect(m.getIndex()).toBe(2); // wrapped
  });

  it('returns commit with current index on enter', () => {
    const m = selectionStateMachine(5, { initialIndex: 2 });
    m.handle('down');
    const result = m.handle('enter');
    expect(result).toEqual({ kind: 'commit', index: 3 });
  });

  it('returns cancel on cancel event', () => {
    const m = selectionStateMachine(3);
    expect(m.handle('cancel')).toEqual({ kind: 'cancel' });
  });

  it('ignores unknown events as noop', () => {
    const m = selectionStateMachine(3, { initialIndex: 1 });
    expect(m.handle('floof').kind).toBe('noop');
    expect(m.getIndex()).toBe(1);
  });
});

describe('prompts: _parseKeyEvents', () => {
  it('parses arrow up / down (CSI form)', () => {
    expect(_parseKeyEvents('\x1b[A')).toEqual(['up']);
    expect(_parseKeyEvents('\x1b[B')).toEqual(['down']);
  });

  it('parses arrow up / down (SS3 form)', () => {
    expect(_parseKeyEvents('\x1bOA')).toEqual(['up']);
    expect(_parseKeyEvents('\x1bOB')).toEqual(['down']);
  });

  it('parses Enter (\\r and \\n)', () => {
    expect(_parseKeyEvents('\r')).toEqual(['enter']);
    expect(_parseKeyEvents('\n')).toEqual(['enter']);
  });

  it('parses Ctrl+C as cancel', () => {
    expect(_parseKeyEvents('\x03')).toEqual(['cancel']);
  });

  it('handles concatenated chunks', () => {
    expect(_parseKeyEvents('\x1b[B\x1b[B\r')).toEqual(['down', 'down', 'enter']);
  });

  it('ignores unrecognised bytes', () => {
    expect(_parseKeyEvents('xyz')).toEqual([]);
  });
});

describe('prompts: runNumberedSelect', () => {
  it('writes the list and returns 0-based index for valid input', async () => {
    const stdin = makeStringReadable('3\n');
    const stdout = makeCaptureStream();
    const result = await runNumberedSelect(['a', 'b', 'c', 'd'], { initialIndex: 0 }, stdin, stdout);
    expect(result).toBe(2);
    const out = stdout.captured();
    expect(out).toContain('  1) a');
    expect(out).toContain('  4) d');
    expect(out).toContain('Select [1-4, default 1]:');
  });

  it('returns initialIndex when answer is empty', async () => {
    const stdin = makeStringReadable('\n');
    const stdout = makeCaptureStream();
    const result = await runNumberedSelect(['a', 'b', 'c'], { initialIndex: 1 }, stdin, stdout);
    expect(result).toBe(1);
  });

  it('returns null on out-of-range input and prints diagnostic', async () => {
    const stdin = makeStringReadable('99\n');
    const stdout = makeCaptureStream();
    const result = await runNumberedSelect(['a', 'b'], {}, stdin, stdout);
    expect(result).toBeNull();
    expect(stdout.captured()).toContain('Invalid selection');
  });

  it('returns null on non-numeric input', async () => {
    const stdin = makeStringReadable('xyz\n');
    const stdout = makeCaptureStream();
    const result = await runNumberedSelect(['a', 'b'], {}, stdin, stdout);
    expect(result).toBeNull();
  });

  it('renders header when provided', async () => {
    const stdin = makeStringReadable('1\n');
    const stdout = makeCaptureStream();
    await runNumberedSelect(['a', 'b'], { header: 'Pick a model:' }, stdin, stdout);
    expect(stdout.captured()).toContain('Pick a model:');
  });

  it('returns null for empty list', async () => {
    const stdin = makeStringReadable('1\n');
    const stdout = makeCaptureStream();
    const result = await runNumberedSelect([], {}, stdin, stdout);
    expect(result).toBeNull();
  });
});

describe('prompts: promptSelect dispatcher', () => {
  let originalIsTTY_in;
  let originalIsTTY_out;
  let originalSetRawMode;

  beforeEach(() => {
    originalIsTTY_in = process.stdin.isTTY;
    originalIsTTY_out = process.stdout.isTTY;
    originalSetRawMode = process.stdin.setRawMode;
  });
  afterEach(() => {
    process.stdin.isTTY = originalIsTTY_in;
    process.stdout.isTTY = originalIsTTY_out;
    process.stdin.setRawMode = originalSetRawMode;
  });

  it('returns null when stdin is not readable and not TTY', async () => {
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    // Force readable to false
    const origReadable = Object.getOwnPropertyDescriptor(process.stdin, 'readable');
    Object.defineProperty(process.stdin, 'readable', { value: false, configurable: true });
    try {
      const result = await promptSelect(['a']);
      expect(result).toBeNull();
    } finally {
      if (origReadable) Object.defineProperty(process.stdin, 'readable', origReadable);
    }
  });
});

describe('prompts: runArrowSelect', () => {
  // Skipping: requires real TTY semantics including setRawMode side effects.
  // The pure state machine is fully covered above; key parsing is fully
  // covered by _parseKeyEvents tests; remaining wiring is verified by the
  // smoke test in tests/commands/model.test.js plus manual acceptance.
  it.skip('exercised by manual acceptance + state machine + parser tests', () => {});
});

describe('prompts: promptInput', () => {
  it('reads a single line from stdin', async () => {
    const stdin = makeStringReadable('hello world\n');
    const stdout = makeCaptureStream();
    const result = await promptInput('What? ', stdin, stdout);
    expect(result).toBe('hello world');
    expect(stdout.captured()).toContain('What? ');
  });

  it('returns null when stdin is not readable', async () => {
    const stdin = new Readable({ read() {} });
    Object.defineProperty(stdin, 'readable', { value: false });
    const stdout = makeCaptureStream();
    const result = await promptInput('? ', stdin, stdout);
    expect(result).toBeNull();
  });
});

/**
 * Tests for lib/ui/prompts.js — short-interaction layer with enquirer +
 * fallback. Covers the 4 branches required by the spec §5.3 acceptance:
 *
 *   1. Non-TTY (or CI=true) → fallback to lib/prompts (no enquirer call).
 *   2. TTY + enquirer available → enquirer path used.
 *   3. TTY + enquirer cancel (Ctrl+C) → returns null (no fallback recurse).
 *   4. TTY + enquirer load failure → fallback used silently.
 */

// We intentionally do NOT mock lib/logger here — uiPrompts doesn't use it.
// Mock lib/prompts so we can drive fallback returns.
const mockFallbackSelect = jest.fn();
const mockFallbackInput = jest.fn();
jest.mock('../../lib/prompts', () => ({
  promptSelect: mockFallbackSelect,
  promptInput: mockFallbackInput,
}));

describe('lib/ui/prompts', () => {
  let uiPrompts;
  let origStdinTTYDesc;
  let origStdoutTTYDesc;
  let origCI;

  beforeEach(() => {
    // Reset module cache so the enquirer probe + module state is fresh.
    jest.resetModules();
    jest.doMock('../../lib/prompts', () => ({
      promptSelect: mockFallbackSelect,
      promptInput: mockFallbackInput,
    }));
    mockFallbackSelect.mockReset();
    mockFallbackInput.mockReset();

    // Snapshot original property descriptors so afterEach can faithfully
    // restore them. Plain assignment is unreliable because makeTTY/
    // makeNonTTY redefine these as data properties whose descriptor
    // attributes we then take over — see Node #18 worker pollution.
    origStdinTTYDesc = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    origStdoutTTYDesc = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    origCI = process.env.CI;
    delete process.env.CI;
  });

  afterEach(() => {
    restoreTTYDesc(process.stdin, 'isTTY', origStdinTTYDesc);
    restoreTTYDesc(process.stdout, 'isTTY', origStdoutTTYDesc);
    if (origCI === undefined) delete process.env.CI;
    else process.env.CI = origCI;
    jest.dontMock('enquirer');
  });

  function restoreTTYDesc(target, prop, desc) {
    if (desc) {
      Object.defineProperty(target, prop, desc);
    } else {
      // No original own descriptor -> remove the own property we may have
      // added so that the prototype value (or undefined) shows through.
      try { delete target[prop]; } catch (_) { /* ignore */ }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  function loadModule() {
    uiPrompts = require('../../lib/ui/prompts');
    return uiPrompts;
  }

  function makeNonTTY() {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true, configurable: true });
  }

  function makeTTY() {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true, configurable: true });
  }

  /**
   * Replace the `enquirer` module in the require cache with a stubbed
   * factory.  Each constructor returns an object with a `run()` method
   * controlled by the supplied `runImpl` (a function returning a Promise).
   */
  function stubEnquirer({ Select, Input, Confirm, MultiSelect } = {}) {
    jest.doMock('enquirer', () => ({
      Select: function (opts) {
        this.opts = opts;
        this.run = Select || (() => Promise.resolve(opts.choices[0].name));
      },
      Input: function (opts) {
        this.opts = opts;
        this.run = Input || (() => Promise.resolve(''));
      },
      Confirm: function (opts) {
        this.opts = opts;
        this.run = Confirm || (() => Promise.resolve(true));
      },
      MultiSelect: function (opts) {
        this.opts = opts;
        this.run = MultiSelect || (() => Promise.resolve([]));
      },
    }), { virtual: false });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Branch 1: non-TTY / CI=true → fallback
  // ─────────────────────────────────────────────────────────────────────────

  describe('non-TTY / CI fallback', () => {
    it('select(): non-TTY → calls fallback.promptSelect', async () => {
      makeNonTTY();
      stubEnquirer({ Select: () => Promise.resolve('SHOULD-NOT-RUN') });
      mockFallbackSelect.mockResolvedValue(1);
      const ui = loadModule();
      const result = await ui.select(
        [{ name: 'a', label: 'A' }, { name: 'b', label: 'B' }],
        { initialIndex: 0, message: 'pick:' }
      );
      expect(result).toBe('b');
      expect(mockFallbackSelect).toHaveBeenCalledTimes(1);
      const [lines, opts] = mockFallbackSelect.mock.calls[0];
      expect(lines).toEqual(['A', 'B']);
      expect(opts).toMatchObject({ initialIndex: 0, header: 'pick:' });
    });

    it('select(): CI=true even with TTY → calls fallback', async () => {
      makeTTY();
      process.env.CI = 'true';
      stubEnquirer({ Select: () => Promise.resolve('SHOULD-NOT-RUN') });
      mockFallbackSelect.mockResolvedValue(0);
      const ui = loadModule();
      const result = await ui.select([{ name: 'x' }], {});
      expect(result).toBe('x');
      expect(mockFallbackSelect).toHaveBeenCalledTimes(1);
    });

    it('confirm(): non-TTY → uses promptInput Y/n shape', async () => {
      makeNonTTY();
      mockFallbackInput.mockResolvedValue('y');
      const ui = loadModule();
      const ok = await ui.confirm({ message: 'Proceed?', default: false });
      expect(ok).toBe(true);
      expect(mockFallbackInput).toHaveBeenCalledWith('Proceed? (y/N) ');
    });

    it('input(): non-TTY → forwards to promptInput with trailing space', async () => {
      makeNonTTY();
      mockFallbackInput.mockResolvedValue('hello');
      const ui = loadModule();
      const v = await ui.input('Name:');
      expect(v).toBe('hello');
      expect(mockFallbackInput).toHaveBeenCalledWith('Name: ');
    });

    it('confirm(): empty answer with default=true → returns true', async () => {
      makeNonTTY();
      mockFallbackInput.mockResolvedValue('');
      const ui = loadModule();
      const ok = await ui.confirm({ message: 'OK?', default: true });
      expect(ok).toBe(true);
    });

    it('confirm(): empty answer with default=false → returns false', async () => {
      makeNonTTY();
      mockFallbackInput.mockResolvedValue('');
      const ui = loadModule();
      const ok = await ui.confirm({ message: 'OK?', default: false });
      expect(ok).toBe(false);
    });

    it('confirm(): null fallback answer → returns null', async () => {
      makeNonTTY();
      mockFallbackInput.mockResolvedValue(null);
      const ui = loadModule();
      const ok = await ui.confirm({ message: 'OK?', default: true });
      expect(ok).toBeNull();
    });

    it('select(): empty items → null without touching fallback', async () => {
      makeNonTTY();
      const ui = loadModule();
      const r = await ui.select([], {});
      expect(r).toBeNull();
      expect(mockFallbackSelect).not.toHaveBeenCalled();
    });

    it('multiselect(): non-TTY → returns null (no fallback wired in PR-1)', async () => {
      makeNonTTY();
      const ui = loadModule();
      const r = await ui.multiselect([{ name: 'a' }, { name: 'b' }], {});
      expect(r).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Branch 2: TTY + enquirer used
  // ─────────────────────────────────────────────────────────────────────────

  describe('TTY + enquirer', () => {
    it('select(): runs enquirer.Select and returns chosen name', async () => {
      makeTTY();
      stubEnquirer({ Select: () => Promise.resolve('two') });
      const ui = loadModule();
      const r = await ui.select(
        [{ name: 'one', label: 'One' }, { name: 'two', label: 'Two' }],
        { initialIndex: 1, message: 'pick:' }
      );
      expect(r).toBe('two');
      expect(mockFallbackSelect).not.toHaveBeenCalled();
    });

    it('input(): runs enquirer.Input and returns string', async () => {
      makeTTY();
      stubEnquirer({ Input: () => Promise.resolve('typed') });
      const ui = loadModule();
      const r = await ui.input({ message: 'Name:' });
      expect(r).toBe('typed');
    });

    it('confirm(): runs enquirer.Confirm and returns boolean', async () => {
      makeTTY();
      stubEnquirer({ Confirm: () => Promise.resolve(false) });
      const ui = loadModule();
      const r = await ui.confirm({ message: 'OK?', default: true });
      expect(r).toBe(false);
    });

    it('multiselect(): runs enquirer.MultiSelect and returns array', async () => {
      makeTTY();
      stubEnquirer({ MultiSelect: () => Promise.resolve(['a', 'c']) });
      const ui = loadModule();
      const r = await ui.multiselect(
        [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
        {}
      );
      expect(r).toEqual(['a', 'c']);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Branch 3: TTY + enquirer cancel → null
  // ─────────────────────────────────────────────────────────────────────────

  describe('enquirer cancel handling (v1.1 I13)', () => {
    it('select(): empty-string throw → null (no fallback)', async () => {
      makeTTY();
      stubEnquirer({ Select: () => Promise.reject('') });
      const ui = loadModule();
      const r = await ui.select([{ name: 'a' }], {});
      expect(r).toBeNull();
      expect(mockFallbackSelect).not.toHaveBeenCalled();
    });

    it('select(): undefined throw → null', async () => {
      makeTTY();
      stubEnquirer({ Select: () => Promise.reject(undefined) });
      const ui = loadModule();
      const r = await ui.select([{ name: 'a' }], {});
      expect(r).toBeNull();
    });

    it('input(): cancel-named error → null', async () => {
      makeTTY();
      stubEnquirer({ Input: () => Promise.reject(new Error('cancelled by user')) });
      const ui = loadModule();
      const r = await ui.input('?');
      expect(r).toBeNull();
    });

    it('confirm(): cancel-named error → null', async () => {
      makeTTY();
      stubEnquirer({ Confirm: () => Promise.reject(new Error('aborted')) });
      const ui = loadModule();
      const r = await ui.confirm({ message: '?' });
      expect(r).toBeNull();
    });

    it('_isCancelError predicate behavior', () => {
      const ui = loadModule();
      expect(ui._isCancelError(null)).toBe(true);
      expect(ui._isCancelError(undefined)).toBe(true);
      expect(ui._isCancelError('')).toBe(true);
      expect(ui._isCancelError('cancelled')).toBe(true);
      expect(ui._isCancelError(new Error('cancelled by user'))).toBe(true);
      expect(ui._isCancelError(new Error(''))).toBe(true);
      expect(ui._isCancelError(new Error('something else'))).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Branch 4: TTY + enquirer load failure → fallback
  // ─────────────────────────────────────────────────────────────────────────

  describe('enquirer load failure', () => {
    it('select(): if enquirer cannot be loaded → uses fallback', async () => {
      makeTTY();
      // Force enquirer require to throw.
      jest.doMock('enquirer', () => { throw new Error('module missing'); }, { virtual: true });
      mockFallbackSelect.mockResolvedValue(0);
      const ui = loadModule();
      const r = await ui.select([{ name: 'one' }], {});
      expect(r).toBe('one');
      expect(mockFallbackSelect).toHaveBeenCalledTimes(1);
    });

    it('select(): if enquirer throws non-cancel error → fallback used silently', async () => {
      makeTTY();
      stubEnquirer({ Select: () => Promise.reject(new Error('terminal-broken')) });
      mockFallbackSelect.mockResolvedValue(0);
      const ui = loadModule();
      const r = await ui.select([{ name: 'fb' }], {});
      expect(r).toBe('fb');
      expect(mockFallbackSelect).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // _shouldUseEnquirer matrix
  // ─────────────────────────────────────────────────────────────────────────

  describe('_shouldUseEnquirer', () => {
    it('returns false when stdin is not TTY', () => {
      const ui = loadModule();
      expect(ui._shouldUseEnquirer({
        stdin: { isTTY: false }, stdout: { isTTY: true }, env: {}
      })).toBe(false);
    });
    it('returns false when stdout is not TTY', () => {
      const ui = loadModule();
      expect(ui._shouldUseEnquirer({
        stdin: { isTTY: true }, stdout: { isTTY: false }, env: {}
      })).toBe(false);
    });
    it('returns false when CI=true', () => {
      const ui = loadModule();
      expect(ui._shouldUseEnquirer({
        stdin: { isTTY: true }, stdout: { isTTY: true }, env: { CI: 'true' }
      })).toBe(false);
    });
    it('returns true when TTY + non-CI + enquirer loadable', () => {
      stubEnquirer();
      const ui = loadModule();
      expect(ui._shouldUseEnquirer({
        stdin: { isTTY: true }, stdout: { isTTY: true }, env: {}
      })).toBe(true);
    });
  });
});

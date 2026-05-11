// @ts-check
/**
 * Terminal prompt utilities.
 *
 * The selection picker is split into two layers per design proposal §5.2:
 *   1. selectionStateMachine — a pure, side-effect-free state machine that
 *      handles 'up' / 'down' / 'enter' / 'cancel' events. Easy to unit-test
 *      without any stdio mocking.
 *   2. runArrowSelect / runNumberedSelect — stream adapters that translate
 *      stdin bytes into events, drive the state machine, and render to stdout.
 *
 * promptSelect dispatches between the two adapters based on stdin/stdout TTY
 * status and setRawMode availability.
 */

const readline = require('readline');

/**
 * @typedef {Object} SelectMachine
 * @property {() => number} getIndex
 * @property {(event: 'up'|'down'|'enter'|'cancel') => { kind: 'cursor'|'commit'|'cancel'|'noop', index?: number }} handle
 */

/**
 * Pure state machine: tracks the cursor index and converts events into
 * outcomes. No stdio. No timers. Same input → same output.
 *
 * @param {number} itemCount
 * @param {{ initialIndex?: number }} [opts]
 * @returns {SelectMachine}
 */
function selectionStateMachine(itemCount, { initialIndex = 0 } = {}) {
  if (!Number.isInteger(itemCount) || itemCount <= 0) {
    throw new Error('selectionStateMachine: itemCount must be a positive integer');
  }
  let idx = Math.min(Math.max(initialIndex, 0), itemCount - 1);
  return {
    getIndex: () => idx,
    handle(event) {
      switch (event) {
        case 'up':
          idx = (idx - 1 + itemCount) % itemCount;
          return { kind: 'cursor' };
        case 'down':
          idx = (idx + 1) % itemCount;
          return { kind: 'cursor' };
        case 'enter':
          return { kind: 'commit', index: idx };
        case 'cancel':
          return { kind: 'cancel' };
        default:
          return { kind: 'noop' };
      }
    },
  };
}

/**
 * Translate a raw stdin chunk into a list of events.
 * Recognised sequences:
 *   - \x1b[A → up         (also \x1bOA in some terminals)
 *   - \x1b[B → down       (also \x1bOB)
 *   - \r or \n → enter
 *   - \x03 (Ctrl+C) → cancel
 * Anything else is ignored.
 *
 * Exported for testing.
 *
 * @param {Buffer | string} chunk
 * @returns {Array<'up'|'down'|'enter'|'cancel'>}
 */
function _parseKeyEvents(chunk) {
  const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  /** @type {Array<'up'|'down'|'enter'|'cancel'>} */
  const events = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\x03') {
      events.push('cancel');
    } else if (c === '\r' || c === '\n') {
      events.push('enter');
    } else if (c === '\x1b' && i + 2 < s.length && (s[i + 1] === '[' || s[i + 1] === 'O')) {
      const arrow = s[i + 2];
      if (arrow === 'A') events.push('up');
      else if (arrow === 'B') events.push('down');
      i += 2;
    }
  }
  return events;
}

/**
 * Render the selection list. Uses ANSI to clear and redraw.
 *
 * @param {NodeJS.WriteStream} stdout
 * @param {string[]} lines
 * @param {number} cursorIdx
 * @param {string} [header]
 * @param {boolean} [firstRender]
 */
function _render(stdout, lines, cursorIdx, header, firstRender) {
  if (!firstRender) {
    // Move up to the top of the previously-rendered block (lines + header lines)
    const headerLines = header ? header.split('\n').length : 0;
    const total = lines.length + headerLines;
    readline.moveCursor(stdout, 0, -total);
    readline.clearScreenDown(stdout);
  }
  if (header) stdout.write(header + '\n');
  for (let i = 0; i < lines.length; i++) {
    const marker = i === cursorIdx ? '> ' : '  ';
    stdout.write(`${marker}${lines[i]}\n`);
  }
}

/**
 * Arrow-key selector. Requires raw mode + TTY. Blocks until enter or cancel.
 *
 * @param {string[]} lines - Display strings, one per item
 * @param {{ initialIndex?: number, header?: string }} [opts]
 * @param {NodeJS.ReadStream} [stdin]
 * @param {NodeJS.WriteStream} [stdout]
 * @returns {Promise<number|null>} - Index selected, or null on cancel
 */
function runArrowSelect(lines, opts = {}, stdin = process.stdin, stdout = process.stdout) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(lines) || lines.length === 0) {
      reject(new Error('runArrowSelect: lines must be a non-empty array'));
      return;
    }
    const machine = selectionStateMachine(lines.length, { initialIndex: opts.initialIndex });
    const header = opts.header;

    let rawWasSet = false;
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      try {
        if (rawWasSet && typeof stdin.setRawMode === 'function') {
          stdin.setRawMode(false);
        }
      } catch (_) {
        // ignore
      }
      stdin.removeListener('data', onData);
      try {
        stdin.pause();
      } catch (_) {
        // ignore
      }
      process.removeListener('SIGINT', onSigint);
      process.removeListener('exit', cleanup);
    };

    const onSigint = () => {
      cleanup();
      resolve(null);
    };

    const onData = (chunk) => {
      const events = _parseKeyEvents(chunk);
      for (const evt of events) {
        const result = machine.handle(evt);
        if (result.kind === 'commit') {
          cleanup();
          resolve(result.index);
          return;
        }
        if (result.kind === 'cancel') {
          cleanup();
          resolve(null);
          return;
        }
        if (result.kind === 'cursor') {
          _render(stdout, lines, machine.getIndex(), header, false);
        }
      }
    };

    try {
      if (typeof stdin.setRawMode === 'function') {
        stdin.setRawMode(true);
        rawWasSet = true;
      }
      stdin.resume();
      // setEncoding so chunks come as strings
      if (typeof stdin.setEncoding === 'function') stdin.setEncoding('utf8');
      stdin.on('data', onData);
      process.on('SIGINT', onSigint);
      process.on('exit', cleanup);
      _render(stdout, lines, machine.getIndex(), header, true);
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

/**
 * Numbered selector. Works in any environment where stdin is readable.
 * Prints the list once, then reads a single line via readline.
 *
 * @param {string[]} lines
 * @param {{ initialIndex?: number, header?: string }} [opts]
 * @param {NodeJS.ReadStream} [stdin]
 * @param {NodeJS.WriteStream} [stdout]
 * @returns {Promise<number|null>}
 */
function runNumberedSelect(lines, opts = {}, stdin = process.stdin, stdout = process.stdout) {
  return new Promise((resolve) => {
    if (!Array.isArray(lines) || lines.length === 0) {
      resolve(null);
      return;
    }
    const initial = (opts.initialIndex !== undefined ? opts.initialIndex : 0) + 1;
    const header = opts.header;
    if (header) stdout.write(header + '\n');
    for (let i = 0; i < lines.length; i++) {
      stdout.write(`  ${i + 1}) ${lines[i]}\n`);
    }
    const rl = readline.createInterface({ input: stdin, output: stdout, terminal: false });
    rl.question(`Select [1-${lines.length}, default ${initial}]: `, (answer) => {
      rl.close();
      const trimmed = (answer || '').trim();
      if (trimmed === '') {
        resolve(initial - 1);
        return;
      }
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 1 || n > lines.length) {
        stdout.write(`Invalid selection: ${trimmed}\n`);
        resolve(null);
        return;
      }
      resolve(n - 1);
    });
  });
}

/**
 * Dispatch between arrow selector and numbered selector based on environment.
 *
 * Decision matrix:
 *   stdin TTY + stdout TTY + setRawMode available → runArrowSelect
 *   stdin readable (incl. pipe)                  → runNumberedSelect
 *   otherwise                                    → null (caller handles non-interactive)
 *
 * @param {string[]} lines
 * @param {{ initialIndex?: number, header?: string }} [opts]
 * @returns {Promise<number|null>}
 */
function promptSelect(lines, opts = {}) {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const stdinTTY = !!stdin.isTTY;
  const stdoutTTY = !!stdout.isTTY;
  const rawSupported = stdinTTY && typeof stdin.setRawMode === 'function';
  if (stdinTTY && stdoutTTY && rawSupported) {
    return runArrowSelect(lines, opts, stdin, stdout);
  }
  if (stdin.readable) {
    return runNumberedSelect(lines, opts, stdin, stdout);
  }
  return Promise.resolve(null);
}

/**
 * Read a single line of free-form input.
 *
 * @param {string} question
 * @param {NodeJS.ReadStream} [stdin]
 * @param {NodeJS.WriteStream} [stdout]
 * @returns {Promise<string|null>}
 */
function promptInput(question, stdin = process.stdin, stdout = process.stdout) {
  return new Promise((resolve) => {
    if (!stdin.readable) {
      resolve(null);
      return;
    }
    const rl = readline.createInterface({ input: stdin, output: stdout, terminal: false });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer == null ? '' : answer);
    });
  });
}

module.exports = {
  selectionStateMachine,
  runArrowSelect,
  runNumberedSelect,
  promptSelect,
  promptInput,
  _parseKeyEvents,
};

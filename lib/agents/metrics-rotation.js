// @ts-check
/**
 * Best-effort log rotation for the skills metrics JSONL file.
 * SKILLS_ENHANCEMENT_PLAN §C2.3 — 10 MB cap, keep 3 rotated files.
 *
 * Rotation strategy: when the active file exceeds `maxBytes`, rename it
 * to `.1.jsonl`, shifting any existing `.1` → `.2`, `.2` → `.3`, dropping
 * `.3`. Renames are atomic on the same filesystem (POSIX `rename(2)` /
 * Windows `MoveFileEx` w/o REPLACE_EXISTING — we use `fs.renameSync` which
 * accepts overwrites on POSIX).
 *
 * Concurrency: with multiple agent runs racing, two callers may both see
 * size > cap and both rotate. The "loser" overwrites the "winner"'s
 * rotation. Acceptable trade-off — metrics are best-effort observability,
 * not audit logs. We never lose more than one rotation cycle's worth of
 * data (the just-written file remains intact; only the older rotated
 * snapshot may be replaced).
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_KEEP = 3;

/**
 * @param {string} activePath  e.g. "/home/user/.ai-issue/metrics/skills.jsonl"
 * @param {number} index       1, 2, 3, ...
 * @returns {string}           e.g. "/.../skills.1.jsonl"
 */
function rotatedPath(activePath, index) {
  const dir = path.dirname(activePath);
  const ext = path.extname(activePath);
  const base = path.basename(activePath, ext);
  return path.join(dir, `${base}.${index}${ext}`);
}

/**
 * Rotate the metrics file if it exceeds `maxBytes`. Best-effort: any I/O
 * error is swallowed (callers should not let metrics break agent startup).
 *
 * @param {string} activePath
 * @param {{ maxBytes?: number, keep?: number }} [opts]
 */
function rotateIfNeeded(activePath, opts = {}) {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const keep = opts.keep ?? DEFAULT_KEEP;
  if (!activePath) return;
  let size;
  try {
    const stat = fs.statSync(activePath);
    size = stat.size;
  } catch (_e) {
    // File doesn't exist yet — nothing to rotate.
    return;
  }
  if (size <= maxBytes) return;
  try {
    // Walk from the oldest (.keep) backwards: drop oldest, then shift up.
    const oldest = rotatedPath(activePath, keep);
    if (fs.existsSync(oldest)) {
      try { fs.unlinkSync(oldest); } catch (_e) { /* swallow */ }
    }
    for (let i = keep - 1; i >= 1; i--) {
      const from = rotatedPath(activePath, i);
      const to = rotatedPath(activePath, i + 1);
      if (fs.existsSync(from)) {
        try { fs.renameSync(from, to); } catch (_e) { /* swallow */ }
      }
    }
    fs.renameSync(activePath, rotatedPath(activePath, 1));
  } catch (_e) {
    // Catastrophic rotation failure (e.g. disk full mid-rename) — leave
    // the active file in whatever state it ended up; next write may still
    // succeed.
  }
}

module.exports = {
  rotateIfNeeded,
  rotatedPath,
  DEFAULT_MAX_BYTES,
  DEFAULT_KEEP,
};

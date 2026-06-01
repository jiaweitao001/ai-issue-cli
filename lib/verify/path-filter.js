// @ts-check

/**
 * Normalize GitHub Actions path patterns and git paths to the same shape.
 * @param {string} value
 * @returns {string}
 */
function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Convert the small GitHub Actions glob subset used by azurerm workflows into
 * a RegExp. Supports literal paths, `*`, and `**`.
 * @param {string} pattern
 * @returns {RegExp}
 */
function globToRegExp(pattern) {
  const source = normalizePath(pattern);
  let out = '^';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '*' && next === '*') {
      const after = source[i + 2];
      if (after === '/') {
        out += '(?:.*\\/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (ch === '*') {
      out += '[^/]*';
    } else {
      out += ch.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  out += '$';
  return new RegExp(out);
}

/**
 * @param {string} file
 * @param {string} pattern
 * @returns {boolean}
 */
function matchesPattern(file, pattern) {
  return globToRegExp(pattern).test(normalizePath(file));
}

/**
 * @param {string[]} changedFiles
 * @param {string[]} patterns
 * @returns {boolean}
 */
function shouldRunForPaths(changedFiles, patterns) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) return false;
  if (!Array.isArray(patterns) || patterns.length === 0) return true;
  return changedFiles.some(file => patterns.some(pattern => matchesPattern(file, pattern)));
}

module.exports = {
  normalizePath,
  globToRegExp,
  matchesPattern,
  shouldRunForPaths
};

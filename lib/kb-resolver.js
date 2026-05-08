const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const kbErrors = Object.freeze({
  KB_CORRUPTED: 'KB_CORRUPTED',
  KB_SHA256_MISMATCH: 'KB_SHA256_MISMATCH',
  KB_SCHEMA_TOO_NEW: 'KB_SCHEMA_TOO_NEW',
  KB_SCHEMA_TOO_OLD: 'KB_SCHEMA_TOO_OLD',
  CLI_TOO_OLD: 'CLI_TOO_OLD'
});

function makeKbError(code, message, extras = {}) {
  return Object.assign(new Error(message), { code, ...extras });
}

function expandHome(value) {
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (typeof value === 'string' && value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function resolveKbPath(value) {
  if (!value) return '';
  return path.resolve(expandHome(value));
}

function loadManifest(kbDir) {
  const manifestPath = path.join(kbDir, 'manifest.json');
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch (error) {
    throw makeKbError(
      kbErrors.KB_CORRUPTED,
      `Knowledge base manifest is missing or unreadable: ${manifestPath}`,
      { path: manifestPath, cause: error }
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw makeKbError(
      kbErrors.KB_CORRUPTED,
      `Knowledge base manifest contains invalid JSON: ${manifestPath}`,
      { path: manifestPath, cause: error }
    );
  }

  for (const key of ['schemaVersion', 'minCliVersion', 'kbSha256']) {
    if (!Object.prototype.hasOwnProperty.call(manifest, key)) {
      throw makeKbError(
        kbErrors.KB_CORRUPTED,
        `Knowledge base manifest is missing required field "${key}": ${manifestPath}`,
        { path: manifestPath, field: key }
      );
    }
  }

  return manifest;
}

function verifySha256(filePath, expectedHex) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => {
      const actual = hash.digest('hex');
      if (actual === expectedHex) {
        resolve({ ok: true, actual });
      } else {
        resolve({ ok: false, actual, expected: expectedHex });
      }
    });
  });
}

module.exports = {
  expandHome,
  resolveKbPath,
  loadManifest,
  verifySha256,
  kbErrors,
  makeKbError
};

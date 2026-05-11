// @ts-check

const fs = require('fs');
const path = require('path');
const { UnsupportedArtifactKind } = require('./errors');
const { finalizeArtifact } = require('./artifact-finalizer');

/**
 * @param {string} value
 * @returns {string}
 */
function decodeAttribute(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * @param {string} stdout
 * @param {string} artifactPath
 * @returns {string|null}
 */
function extractArtifactBlock(stdout, artifactPath) {
  const pattern = /<artifact\s+path=(["'])(.*?)\1\s*>([\s\S]*?)<\/artifact>/g;
  let match;
  while ((match = pattern.exec(stdout)) !== null) {
    if (decodeAttribute(match[2]) === artifactPath) {
      return match[3];
    }
  }
  return null;
}

/**
 * @param {string} filePath
 */
function ensureParentDir(filePath) {
  const parent = path.dirname(filePath);
  if (parent && parent !== '.') {
    fs.mkdirSync(parent, { recursive: true });
  }
}

/**
 * Collect expected artifacts from direct files, stdout artifact blocks, or a
 * degraded stdout fallback.
 *
 * @param {import('../types').ArtifactSpec[]} specs
 * @param {{ stdout: string, repoPath: string }} source
 * @returns {{ artifacts: Record<string, string>, warnings: string[] }}
 */
function collectArtifacts(specs, source) {
  /** @type {Record<string, string>} */
  const artifacts = {};
  const warnings = [];

  for (const spec of specs || []) {
    if (spec.kind !== 'file' && spec.kind !== 'stdout') {
      throw new UnsupportedArtifactKind(`ClaudeCodeAgent does not support artifact kind '${spec.kind}'`);
    }

    if (spec.kind === 'stdout') {
      finalizeArtifact(spec, source.stdout, artifacts, warnings, 'stdout');
      continue;
    }

    if (fs.existsSync(spec.path)) {
      const content = fs.readFileSync(spec.path, 'utf8');
      finalizeArtifact(spec, content, artifacts, warnings);
      continue;
    }

    const extracted = extractArtifactBlock(source.stdout, spec.path);
    if (extracted !== null) {
      ensureParentDir(spec.path);
      fs.writeFileSync(spec.path, extracted, 'utf8');
      finalizeArtifact(spec, extracted, artifacts, warnings);
      continue;
    }

    warnings.push(`[claude-code] Artifact '${spec.path}' not found in <artifact> block; writing full stdout as degraded fallback`);
    ensureParentDir(spec.path);
    fs.writeFileSync(spec.path, source.stdout, 'utf8');
    finalizeArtifact(spec, source.stdout, artifacts, warnings);
  }

  return { artifacts, warnings };
}

module.exports = {
  collectArtifacts,
  decodeAttribute,
  extractArtifactBlock
};

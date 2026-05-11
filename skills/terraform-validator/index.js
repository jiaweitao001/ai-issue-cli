#!/usr/bin/env node
/**
 * Terraform Validator - MCP Server
 *
 * Pre-commit static checks for hashicorp/terraform-provider-azurerm style
 * Go code.
 *
 * B-MVP rules (field-naming consistency):
 *   - field-naming-undeclared (high)
 *   - field-naming-case (medium)
 *
 * B-Extend rules (added in PR #46):
 *   - schema-optional-get (medium): `<rd>.Get("k")` on an inline Schema
 *     entry that is `Optional: true` without `Default:` and without
 *     `Computed: true`. Get() returns the zero value when unset, which is
 *     indistinguishable from an explicit zero — use GetOk() to detect
 *     "not provided".
 *   - pointer-from-unchecked-chain (warning, advisory): `pointer.From(a.b.c)`
 *     where the chain has ≥2 levels of pointer field access AND none of the
 *     intermediate prefixes (`a.b`) appears in a nil-check earlier in the
 *     same function body. Only triggers on the simplified R1' heuristic;
 *     deeper taint analysis is out of scope.
 *
 * Public tool: validate_terraform_changes({repoPath, files[]})
 *   → {findings: [{rule, file, line, severity, message}], summary: string}
 *
 * Hard input contract (rubber-duck v5 — see SKILLS_ENHANCEMENT_PLAN §B-MVP):
 *   - repoPath: required, must be an existing directory
 *   - files[]: required and non-empty (no whole-repo scan)
 *   - each file in files[] must resolve under repoPath (no `../escape`)
 *   - any input violation → MCP error with `INVALID_INPUT` style message
 *
 * Self-skip: if files[] contains no terraform-provider files
 * (`*_resource.go` / `*_resource_gen.go` / `*_data_source.go`), the validator
 * returns `{findings: [], summary: "no terraform provider files in scope,
 * validator skipped"}` so non-Terraform repos see a clean no-op.
 *
 * Skipped on purpose (documented limitations — see README):
 *   - dot-navigation keys like `d.Get("network_rule_set.0.bypass")`
 *   - functions that take multiple `*ResourceData` parameters
 *   - cross-SDK struct field validation (LLM uses grep_search instead)
 *   - Schema entries built via helper functions (commonschema.Location() etc.)
 *     — properties are opaque, so schema-optional-get cannot evaluate them
 *   - closures that read variables nil-checked in the OUTER function body
 *     — pointer-from-unchecked-chain is function-scoped and may false-flag
 */

const fs = require('fs');
const path = require('path');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const TERRAFORM_FILE_SUFFIXES = ['_resource.go', '_resource_gen.go', '_data_source.go'];

/**
 * Walk forward from `text[openIdx]` (which must be `{`) and find the index
 * of the matching `}`. Skips Go string literals (double-quoted with escapes,
 * raw backtick strings) and both line/block comments so braces inside those
 * don't unbalance the parser.
 */
function findMatchingBrace(text, openIdx) {
  if (text[openIdx] !== '{') return -1;
  let depth = 0;
  let i = openIdx;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const eol = text.indexOf('\n', i);
      i = eol === -1 ? text.length : eol + 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? text.length : close + 2;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '"') { i++; break; }
        if (text[i] === '\n') break;
        i++;
      }
      continue;
    }
    if (c === '`') {
      const close = text.indexOf('`', i + 1);
      i = close === -1 ? text.length : close + 1;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

/**
 * Inside a Schema block (text[0]==='{', text[end]==='}'), extract the keys
 * defined at depth 1 only — any nested `{...}` block is brace-skipped so
 * fields of a nested `Elem: &pluginsdk.Resource{Schema: ...}` do NOT bleed
 * up into the outer schema's key list.
 */
function extractSchemaKeysFromBlock(blockText) {
  const keys = [];
  let i = 1; // step past outer {
  const end = blockText.length - 1;
  while (i < end) {
    const c = blockText[i];
    if (c === '/' && blockText[i + 1] === '/') {
      const eol = blockText.indexOf('\n', i);
      i = eol === -1 ? end : eol + 1;
      continue;
    }
    if (c === '/' && blockText[i + 1] === '*') {
      const close = blockText.indexOf('*/', i + 2);
      i = close === -1 ? end : close + 2;
      continue;
    }
    if (c === '`') {
      const close = blockText.indexOf('`', i + 1);
      i = close === -1 ? end : close + 1;
      continue;
    }
    if (c === '{') {
      const close = findMatchingBrace(blockText, i);
      i = close === -1 ? end : close + 1;
      continue;
    }
    if (c === '"') {
      const m = blockText.slice(i).match(/^"([^"]+)"\s*:/);
      if (m) {
        keys.push(m[1]);
        i += m[0].length;
        continue;
      }
      i++;
      while (i < end) {
        if (blockText[i] === '\\') { i += 2; continue; }
        if (blockText[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }
    i++;
  }
  return keys;
}

/**
 * Parse the property flags (Required / Optional / Computed / Default) that
 * appear at the **top level** of an inline Schema entry body — i.e. NOT
 * nested inside an `Elem: &pluginsdk.Resource{...}` block. Without the
 * depth-1 walk, a regex over the whole body would mistake a nested entry's
 * `Optional: true` for the outer's, falsely typing the outer as Optional.
 */
function parseSchemaEntryFlags(innerText) {
  let optional = false;
  let required = false;
  let computed = false;
  let hasDefault = false;
  let i = 0;
  const end = innerText.length;
  while (i < end) {
    const c = innerText[i];
    if (c === '/' && innerText[i + 1] === '/') {
      const eol = innerText.indexOf('\n', i);
      i = eol === -1 ? end : eol + 1;
      continue;
    }
    if (c === '/' && innerText[i + 1] === '*') {
      const close = innerText.indexOf('*/', i + 2);
      i = close === -1 ? end : close + 2;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < end) {
        if (innerText[i] === '\\') { i += 2; continue; }
        if (innerText[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '`') {
      const close = innerText.indexOf('`', i + 1);
      i = close === -1 ? end : close + 1;
      continue;
    }
    if (c === '{') {
      const close = findMatchingBrace(innerText, i);
      i = close === -1 ? end : close + 1;
      continue;
    }
    const m = innerText.slice(i).match(/^(Required|Optional|Computed|Default(?:Func)?)\b\s*:/);
    if (m) {
      const afterColon = i + m[0].length;
      if (m[1] === 'Default' || m[1] === 'DefaultFunc') {
        hasDefault = true;
      } else {
        let j = afterColon;
        while (j < end && /\s/.test(innerText[j])) j++;
        if (innerText.slice(j, j + 4) === 'true' &&
            (j + 4 === end || /\W/.test(innerText[j + 4]))) {
          if (m[1] === 'Required') required = true;
          else if (m[1] === 'Optional') optional = true;
          else if (m[1] === 'Computed') computed = true;
        }
      }
      i = afterColon;
      continue;
    }
    i++;
  }
  return { optional, required, computed, hasDefault };
}

/**
 * Inside a Schema block (text[0]==='{', text[end]==='}'), extract the entries
 * defined at depth 1 along with their declared property flags
 * (Optional/Required/Computed and whether a Default is set). Entries whose
 * value is a function call (e.g. `commonschema.Location()`) are returned with
 * `inline: false` and no flags — properties are opaque and the caller must
 * not rely on them.
 *
 * Used by the B-Extend `schema-optional-get` rule. The simpler
 * `extractSchemaKeysFromBlock` is retained for back-compat and direct testing.
 */
function extractSchemaEntriesFromBlock(blockText) {
  const entries = [];
  let i = 1;
  const end = blockText.length - 1;
  while (i < end) {
    const c = blockText[i];
    if (c === '/' && blockText[i + 1] === '/') {
      const eol = blockText.indexOf('\n', i);
      i = eol === -1 ? end : eol + 1;
      continue;
    }
    if (c === '/' && blockText[i + 1] === '*') {
      const close = blockText.indexOf('*/', i + 2);
      i = close === -1 ? end : close + 2;
      continue;
    }
    if (c === '`') {
      const close = blockText.indexOf('`', i + 1);
      i = close === -1 ? end : close + 1;
      continue;
    }
    if (c === '{') {
      const close = findMatchingBrace(blockText, i);
      i = close === -1 ? end : close + 1;
      continue;
    }
    if (c === '"') {
      const m = blockText.slice(i).match(/^"([^"]+)"\s*:\s*/);
      if (m) {
        const key = m[1];
        const afterColon = i + m[0].length;
        if (blockText[afterColon] === '{') {
          const close = findMatchingBrace(blockText, afterColon);
          if (close !== -1) {
            const innerText = blockText.slice(afterColon + 1, close);
            const flags = parseSchemaEntryFlags(innerText);
            entries.push({ key, ...flags, inline: true });
            i = close + 1;
            continue;
          }
        }
        entries.push({ key, inline: false });
        i = afterColon;
        continue;
      }
      i++;
      while (i < end) {
        if (blockText[i] === '\\') { i += 2; continue; }
        if (blockText[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }
    i++;
  }
  return entries;
}

/**
 * Find every `Schema: map[string]*<schema|pluginsdk>.Schema {...}` literal
 * in the file and return their byte ranges plus their direct-child entries
 * (and a `keys` projection for back-compat with B-MVP rule wiring).
 * Top-level vs nested distinction is computed by the caller via range
 * containment.
 */
function findSchemaLiterals(content) {
  const literals = [];
  const re = /Schema\s*:\s*map\[string\]\*(?:schema|pluginsdk)\.Schema\s*\{/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const openIdx = content.indexOf('{', m.index);
    if (openIdx === -1) continue;
    const closeIdx = findMatchingBrace(content, openIdx);
    if (closeIdx === -1) continue;
    const block = content.slice(openIdx, closeIdx + 1);
    const entries = extractSchemaEntriesFromBlock(block);
    literals.push({
      start: openIdx,
      end: closeIdx,
      entries,
      keys: entries.map(e => e.key),
    });
  }
  return literals;
}

/**
 * Top-level Schema literals are those NOT contained inside the byte range
 * of any other Schema literal — i.e. they are not nested under an outer
 * Schema's `Elem: &pluginsdk.Resource{Schema: ...}`.
 */
function topLevelSchemas(literals) {
  return literals.filter(s =>
    !literals.some(other => other !== s && other.start < s.start && other.end > s.end)
  );
}

/**
 * Collect all parameter names whose declared type is `*schema.ResourceData`
 * or `*pluginsdk.ResourceData`. The set is global to the file because
 * azurerm convention is `d` everywhere; per-function scoping is a known
 * B-MVP limitation (see README).
 */
function findResourceDataVarnames(content) {
  const set = new Set();
  const re = /\b(\w+)\s+\*(?:schema|pluginsdk)\.ResourceData\b/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    set.add(m[1]);
  }
  return set;
}

/**
 * Find every `<varname>.(Set|Get|GetOk|GetOkExists)("<key>"` call site.
 * Line number is derived by counting `\n` up to the match.
 */
function findSetGetCalls(content) {
  const calls = [];
  const re = /\b(\w+)\.(Set|Get|GetOk|GetOkExists)\(\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const line = (content.slice(0, m.index).match(/\n/g) || []).length + 1;
    calls.push({
      varname: m[1],
      method: m[2],
      key: m[3],
      line,
    });
  }
  return calls;
}

function snakeToCamel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function camelToSnake(s) {
  return s.replace(/([A-Z])/g, '_$1').toLowerCase();
}
/** Toggle snake_case ↔ camelCase if applicable; returns null if neither shape. */
function toggleNamingStyle(key) {
  if (key.includes('_')) return snakeToCamel(key);
  if (/[A-Z]/.test(key)) return camelToSnake(key);
  return null;
}

/**
 * Run the field-naming consistency checks on a single file's text.
 * Returns an array of finding objects (without `file` — caller injects it).
 */
function checkFieldNamingForFile(content) {
  const findings = [];
  const literals = findSchemaLiterals(content);
  const tops = topLevelSchemas(literals);
  const topKeys = new Set();
  for (const s of tops) {
    for (const k of s.keys) topKeys.add(k);
  }

  // No Schema literal at all → not a resource-defining file, skip
  if (literals.length === 0) return findings;

  const rdVars = findResourceDataVarnames(content);
  if (rdVars.size === 0) return findings;

  const calls = findSetGetCalls(content);
  for (const c of calls) {
    if (!rdVars.has(c.varname)) continue;
    if (c.key.includes('.')) continue; // dot-nav skipped per plan
    if (topKeys.has(c.key)) continue;

    const alt = toggleNamingStyle(c.key);
    if (alt && topKeys.has(alt)) {
      findings.push({
        rule: 'field-naming-case',
        line: c.line,
        severity: 'medium',
        message:
          `Schema declares "${alt}" but ${c.varname}.${c.method}() uses ` +
          `"${c.key}". Naming style drift — align the accessor with the schema key.`,
      });
    } else {
      findings.push({
        rule: 'field-naming-undeclared',
        line: c.line,
        severity: 'high',
        message:
          `${c.varname}.${c.method}("${c.key}") references a key not declared ` +
          `in any top-level Schema in this file. Either add it to Schema or ` +
          `correct the spelling.`,
      });
    }
  }
  return findings;
}

/**
 * B-Extend rule: schema-optional-get
 *
 * Flag `<rd>.Get("key")` (method exactly `Get`) where the key is declared in
 * a top-level Schema as `Optional: true` AND NOT `Computed: true` AND has no
 * `Default:`. Such fields cannot distinguish "not provided" from "explicit
 * zero" via Get() — GetOk() (or HasChange()) is needed.
 *
 * Skipped:
 *   - keys not declared in any top-level inline Schema entry
 *   - entries built via helper functions (`inline: false`) — properties opaque
 *   - dot-navigation keys (already handled by .includes('.'))
 *   - methods other than the bare `Get` (`GetOk`, `GetOkExists`, `Set`)
 */
function checkSchemaOptionalGet(content) {
  const findings = [];
  const literals = findSchemaLiterals(content);
  if (literals.length === 0) return findings;
  const tops = topLevelSchemas(literals);
  const topEntries = new Map();
  for (const s of tops) {
    for (const e of s.entries) {
      if (!topEntries.has(e.key)) topEntries.set(e.key, e);
    }
  }
  if (topEntries.size === 0) return findings;

  const rdVars = findResourceDataVarnames(content);
  if (rdVars.size === 0) return findings;

  const calls = findSetGetCalls(content);
  for (const c of calls) {
    if (!rdVars.has(c.varname)) continue;
    if (c.method !== 'Get') continue;
    if (c.key.includes('.')) continue;
    const entry = topEntries.get(c.key);
    if (!entry || !entry.inline) continue;
    if (!entry.optional) continue;
    if (entry.computed) continue;
    if (entry.hasDefault) continue;

    findings.push({
      rule: 'schema-optional-get',
      line: c.line,
      severity: 'medium',
      message:
        `${c.varname}.Get("${c.key}") reads an Optional field that has ` +
        `no Default and is not Computed. Get() returns the zero value when ` +
        `the user did not set it, indistinguishable from an explicit zero. ` +
        `Use ${c.varname}.GetOk("${c.key}") to detect the "not provided" case.`,
    });
  }
  return findings;
}

/**
 * Find every Go function (or function literal) body in the file. Returns
 * `[{start, bodyStart, bodyEnd}]` where `start` is the index of `func` and
 * `bodyStart`/`bodyEnd` bracket the `{...}` of the body. Skips strings and
 * comments. The walker tracks paren and bracket depth so that the `{` of a
 * receiver/return-type literal does not get mistaken for the body opener.
 *
 * Function literals (`func() { ... }`) are included — closures share the
 * outer function's variable scope, so `pointer-from-unchecked-chain` may
 * false-flag a variable that the OUTER function nil-checked. This is a
 * documented limitation.
 */
function findGoFunctionBodies(content) {
  const funcs = [];
  const re = /\bfunc\b/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    let i = m.index + 4;
    let parenDepth = 0;
    let bracketDepth = 0;
    while (i < content.length) {
      const c = content[i];
      if (c === '/' && content[i + 1] === '/') {
        const eol = content.indexOf('\n', i);
        i = eol === -1 ? content.length : eol + 1;
        continue;
      }
      if (c === '/' && content[i + 1] === '*') {
        const close = content.indexOf('*/', i + 2);
        i = close === -1 ? content.length : close + 2;
        continue;
      }
      if (c === '"') {
        i++;
        while (i < content.length) {
          if (content[i] === '\\') { i += 2; continue; }
          if (content[i] === '"' || content[i] === '\n') { i++; break; }
          i++;
        }
        continue;
      }
      if (c === '`') {
        const close = content.indexOf('`', i + 1);
        i = close === -1 ? content.length : close + 1;
        continue;
      }
      if (c === '(') { parenDepth++; i++; continue; }
      if (c === ')') { parenDepth--; i++; continue; }
      if (c === '[') { bracketDepth++; i++; continue; }
      if (c === ']') { bracketDepth--; i++; continue; }
      if (c === '{' && parenDepth === 0 && bracketDepth === 0) {
        const bodyEnd = findMatchingBrace(content, i);
        if (bodyEnd !== -1) {
          funcs.push({ start: m.index, bodyStart: i, bodyEnd });
        }
        break;
      }
      i++;
    }
  }
  return funcs;
}

/**
 * Find the smallest function (or function literal) body containing `offset`.
 * Returns null if `offset` is outside every function (top-level code).
 */
function findEnclosingFunction(funcs, offset) {
  let best = null;
  for (const f of funcs) {
    if (f.bodyStart <= offset && offset <= f.bodyEnd) {
      if (!best || (f.bodyEnd - f.bodyStart) < (best.bodyEnd - best.bodyStart)) {
        best = f;
      }
    }
  }
  return best;
}

/**
 * B-Extend rule: pointer-from-unchecked-chain (R1', severity=warning)
 *
 * Flag every `pointer.From(<a.b.c…>)` call where the dotted chain has at
 * least 3 segments (e.g. `resp.Model.Properties.Foo`) and at least one
 * intermediate prefix (e.g. `resp.Model`, `resp.Model.Properties`) does NOT
 * appear in a nil-check (`X == nil` / `X != nil`) earlier in the same
 * function body. Severity is `warning` — advisory; the validator does not
 * have full type info, so false positives are possible (e.g. value-typed
 * intermediate fields, struct embedding). Treat findings as prompts to
 * audit, not as hard blockers.
 *
 * Argument forms with parentheses (e.g. `pointer.From(getX())`) are NOT
 * matched by the chain regex and are silently skipped.
 */
function checkPointerFromForFile(content) {
  const findings = [];
  const re = /pointer\.From\(\s*([\w.]+)\s*\)/g;
  let m;
  let funcs = null;
  while ((m = re.exec(content)) !== null) {
    const chain = m[1];
    const parts = chain.split('.');
    if (parts.length < 3) continue;
    const prefixes = [];
    for (let n = 2; n < parts.length; n++) {
      prefixes.push(parts.slice(0, n).join('.'));
    }
    if (prefixes.length === 0) continue;

    if (funcs === null) funcs = findGoFunctionBodies(content);
    const fn = findEnclosingFunction(funcs, m.index);
    if (!fn) continue;
    const bodyBefore = content.slice(fn.bodyStart, m.index);

    const unchecked = [];
    for (const prefix of prefixes) {
      const escaped = prefix.replace(/\./g, '\\.');
      const nilRe = new RegExp(`\\b${escaped}\\s*[!=]=\\s*nil\\b`);
      if (!nilRe.test(bodyBefore)) unchecked.push(prefix);
    }
    if (unchecked.length === 0) continue;

    const line = (content.slice(0, m.index).match(/\n/g) || []).length + 1;
    const list = unchecked.map(p => `"${p}"`).join(', ');
    findings.push({
      rule: 'pointer-from-unchecked-chain',
      line,
      severity: 'warning',
      message:
        `pointer.From(${chain}) dereferences a chain whose intermediate ` +
        `level(s) ${list} are not nil-checked earlier in this function body. ` +
        `If any intermediate is nil at runtime this will panic. Add a guard ` +
        `(e.g. \`if ${unchecked[0]} == nil { return ... }\`) or document why ` +
        `the chain is guaranteed non-nil here.`,
    });
  }
  return findings;
}

/**
 * Resolve a possibly-relative file path under repoPath and verify it does
 * not escape via `..` segments. Throws if the path is outside repoPath.
 * Returns the absolute path.
 */
function resolveUnderRepo(repoPath, file) {
  const abs = path.isAbsolute(file) ? file : path.resolve(repoPath, file);
  const repoReal = path.resolve(repoPath);
  const rel = path.relative(repoReal, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`INVALID_INPUT: file "${file}" resolves outside repoPath`);
  }
  return abs;
}

function isTerraformProviderFile(filePath) {
  return TERRAFORM_FILE_SUFFIXES.some(suffix => filePath.endsWith(suffix));
}

/**
 * Top-level entry point invoked by the MCP tool.
 */
async function validateTerraformChanges(args) {
  if (!args || typeof args !== 'object') {
    throw new Error('INVALID_INPUT: arguments object required');
  }
  const { repoPath, files } = args;
  if (!repoPath || typeof repoPath !== 'string') {
    throw new Error('INVALID_INPUT: repoPath required (string)');
  }
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    throw new Error(`INVALID_INPUT: repoPath does not exist or is not a directory: ${repoPath}`);
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('INVALID_INPUT: files[] required (non-empty array of modified file paths)');
  }
  for (const f of files) {
    if (typeof f !== 'string' || !f) {
      throw new Error('INVALID_INPUT: each file in files[] must be a non-empty string');
    }
  }

  // Resolve paths up-front so `../escape` attempts fail fast
  const resolved = files.map(f => ({ original: f, abs: resolveUnderRepo(repoPath, f) }));

  const tfFiles = resolved.filter(r => isTerraformProviderFile(r.abs));
  if (tfFiles.length === 0) {
    return {
      findings: [],
      summary: 'no terraform provider files in scope, validator skipped',
    };
  }

  const findings = [];
  for (const { original, abs } of tfFiles) {
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      findings.push({
        rule: 'io-error',
        file: original,
        line: 0,
        severity: 'high',
        message: `Failed to read file: ${err.message}`,
      });
      continue;
    }
    const fileFindings = [
      ...checkFieldNamingForFile(content),
      ...checkSchemaOptionalGet(content),
      ...checkPointerFromForFile(content),
    ];
    for (const f of fileFindings) findings.push({ ...f, file: original });
  }

  const counts = findings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] || 0) + 1;
    return acc;
  }, {});
  const summary =
    `Validated ${tfFiles.length} terraform file(s); ` +
    `found ${findings.length} finding(s) ` +
    `(high=${counts.high || 0}, medium=${counts.medium || 0}, ` +
    `warning=${counts.warning || 0}).`;

  return { findings, summary };
}

const server = new Server(
  {
    name: 'terraform-validator',
    version: '1.0.0',
  },
  {
    capabilities: { tools: {} },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'validate_terraform_changes',
      description: `Pre-commit validator for terraform-provider-azurerm style Go changes.

Use this in Phase 2 (and rubber-duck) BEFORE committing if the changeset includes \`*_resource.go\` / \`*_resource_gen.go\` / \`*_data_source.go\` files. Non-terraform-provider repos can safely skip the call — the validator self-skips when no matching files are present.

Input:
  - repoPath (string, required): absolute path to the repo root
  - files (string[], required, non-empty): list of modified files (paths
    relative to repoPath are accepted)

Output:
  {
    findings: [
      {
        rule: 'field-naming-undeclared' | 'field-naming-case' |
              'schema-optional-get' | 'pointer-from-unchecked-chain',
        file: string,
        line: number,
        severity: 'high' | 'medium' | 'warning',
        message: string
      }
    ],
    summary: string
  }

Findings (and how to triage):
  - field-naming-undeclared (high): \`d.Set/Get("key")\` references a key
    not declared in any top-level Schema in the file. Likely a typo or a
    forgotten Schema entry; MUST be fixed before commit.
  - field-naming-case (medium): The schema declares the snake_case
    counterpart but the accessor uses camelCase (or vice versa). Fix to
    align with the schema spelling.
  - schema-optional-get (medium): \`<rd>.Get("key")\` reads an Optional
    field that has no Default and is not Computed. Get() can't distinguish
    "not provided" from "explicit zero" — switch to GetOk() if the
    distinction matters.
  - pointer-from-unchecked-chain (warning): \`pointer.From(a.b.c)\` chain
    has unchecked intermediate level(s). Advisory — false positives possible
    when intermediates are value types or struct-embedded. Audit and either
    add a nil guard or document why the chain is safe.

Known limitations (see README):
  - dot-navigation keys (e.g. "network_rule_set.0.bypass") are skipped
  - functions with multiple *ResourceData parameters not handled
  - Schema entries built via helper functions (commonschema.Location() etc.)
    have opaque properties — schema-optional-get can't evaluate them
  - closures inherit the outer function's variable scope; the nil-check
    rule is function-scoped and may false-flag in that case
  - cross-SDK struct field validation is out of scope (use grep_search)`,
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: {
            type: 'string',
            description: 'Absolute path to repository root',
          },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Modified file paths (relative to repoPath or absolute under it)',
          },
        },
        required: ['repoPath', 'files'],
      },
    },
  ],
}));

async function handleToolRequest(request) {
  const { name, arguments: args } = request.params;
  if (name !== 'validate_terraform_changes') {
    return {
      content: [{ type: 'text', text: `Error: unknown tool ${name}` }],
      isError: true,
    };
  }
  try {
    const result = await validateTerraformChanges(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error validating terraform changes: ${err.message}` }],
      isError: true,
    };
  }
}

server.setRequestHandler(CallToolRequestSchema, handleToolRequest);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Terraform Validator MCP Server running on stdio');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  validateTerraformChanges,
  handleToolRequest,
  // Internals exported for unit tests
  __internal: {
    findMatchingBrace,
    extractSchemaKeysFromBlock,
    parseSchemaEntryFlags,
    extractSchemaEntriesFromBlock,
    findSchemaLiterals,
    topLevelSchemas,
    findResourceDataVarnames,
    findSetGetCalls,
    checkFieldNamingForFile,
    checkSchemaOptionalGet,
    findGoFunctionBodies,
    findEnclosingFunction,
    checkPointerFromForFile,
    resolveUnderRepo,
    isTerraformProviderFile,
    toggleNamingStyle,
  },
};

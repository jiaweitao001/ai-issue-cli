const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn(() => ({
    setRequestHandler: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
  })),
}), { virtual: true });
jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(),
}), { virtual: true });
jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ListToolsRequestSchema: 'ListToolsRequestSchema',
}), { virtual: true });

const SKILL = require('../../skills/terraform-validator/index.js');
const { validateTerraformChanges, handleToolRequest, __internal } = SKILL;

// ---------------------------------------------------------------------------
// Fixtures (synthetic but shaped after real terraform-provider-azurerm code)
// ---------------------------------------------------------------------------

const FIXTURE_1_CLEAN = `package foo

import "github.com/hashicorp/terraform-provider-azurerm/internal/tf/pluginsdk"

func resourceFoo() *pluginsdk.Resource {
  return &pluginsdk.Resource{
    Schema: map[string]*pluginsdk.Schema{
      "name": {
        Type:     pluginsdk.TypeString,
        Required: true,
      },
      "runtime_environment": {
        Type:     pluginsdk.TypeString,
        Optional: true,
      },
    },
  }
}

func resourceFooRead(d *pluginsdk.ResourceData, meta interface{}) error {
  d.Set("name", "x")
  d.Set("runtime_environment", "prod")
  return nil
}
`;

const FIXTURE_2_UNDECLARED_KEY = `package foo

import "github.com/hashicorp/terraform-provider-azurerm/internal/tf/pluginsdk"

func resourceFoo() *pluginsdk.Resource {
  return &pluginsdk.Resource{
    Schema: map[string]*pluginsdk.Schema{
      "name": {
        Type: pluginsdk.TypeString,
      },
    },
  }
}

func resourceFooRead(d *pluginsdk.ResourceData, meta interface{}) error {
  d.Set("name", "x")
  d.Set("runtime_env", "prod")
  return nil
}
`;

const FIXTURE_3_CASE_DRIFT = `package foo

import "github.com/hashicorp/terraform-provider-azurerm/internal/tf/pluginsdk"

func resourceFoo() *pluginsdk.Resource {
  return &pluginsdk.Resource{
    Schema: map[string]*pluginsdk.Schema{
      "runtime_environment": {
        Type: pluginsdk.TypeString,
      },
    },
  }
}

func resourceFooRead(d *pluginsdk.ResourceData, meta interface{}) error {
  d.Set("runtimeEnvironment", "prod")
  return nil
}
`;

const FIXTURE_4_NESTED_AND_DOTNAV = `package foo

import "github.com/hashicorp/terraform-provider-azurerm/internal/tf/pluginsdk"

func resourceFoo() *pluginsdk.Resource {
  return &pluginsdk.Resource{
    Schema: map[string]*pluginsdk.Schema{
      "name": {
        Type: pluginsdk.TypeString,
      },
      "network_rule_set": {
        Type: pluginsdk.TypeList,
        Elem: &pluginsdk.Resource{
          Schema: map[string]*pluginsdk.Schema{
            "bypass": {
              Type: pluginsdk.TypeString,
            },
            "default_action": {
              Type: pluginsdk.TypeString,
            },
          },
        },
      },
    },
  }
}

func resourceFooRead(d *pluginsdk.ResourceData, meta interface{}) error {
  d.Set("name", "x")
  // dot-navigation into the nested resource — must be ignored, not flagged
  bypass := d.Get("network_rule_set.0.bypass").(string)
  _ = bypass
  return nil
}
`;

const FIXTURE_5A_OK = `package multi

import "github.com/hashicorp/terraform-provider-azurerm/internal/tf/pluginsdk"

func resourceA() *pluginsdk.Resource {
  return &pluginsdk.Resource{
    Schema: map[string]*pluginsdk.Schema{
      "alpha": { Type: pluginsdk.TypeString },
    },
  }
}

func resourceARead(d *pluginsdk.ResourceData, meta interface{}) error {
  d.Set("alpha", "ok")
  return nil
}
`;

const FIXTURE_5B_BAD = `package multi

import "github.com/hashicorp/terraform-provider-azurerm/internal/tf/pluginsdk"

func resourceB() *pluginsdk.Resource {
  return &pluginsdk.Resource{
    Schema: map[string]*pluginsdk.Schema{
      "beta": { Type: pluginsdk.TypeString },
    },
  }
}

func resourceBRead(d *pluginsdk.ResourceData, meta interface{}) error {
  d.Set("gamma", "wrong")
  return nil
}
`;

const FIXTURE_6_CUSTOM_VARNAME = `package foo

import "github.com/hashicorp/terraform-provider-azurerm/internal/tf/pluginsdk"

func resourceFoo() *pluginsdk.Resource {
  return &pluginsdk.Resource{
    Schema: map[string]*pluginsdk.Schema{
      "size": { Type: pluginsdk.TypeString },
    },
  }
}

// Convention departure: parameter is "rd" not "d". Should still be recognized.
func resourceFooRead(rd *pluginsdk.ResourceData, meta interface{}) error {
  rd.Set("size", "small")
  rd.Set("undeclared_key", "boom")
  return nil
}
`;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRepo(filesMap) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tfv-test-'));
  for (const [rel, content] of Object.entries(filesMap)) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return repo;
}

function cleanup(repo) {
  if (repo && fs.existsSync(repo)) fs.rmSync(repo, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Internal parser unit tests
// ---------------------------------------------------------------------------

describe('terraform-validator internals', () => {
  describe('findMatchingBrace', () => {
    it('matches a simple balanced pair', () => {
      const t = 'x{abc}y';
      expect(__internal.findMatchingBrace(t, 1)).toBe(5);
    });

    it('handles nesting', () => {
      const t = '{a{b{c}d}e}';
      expect(__internal.findMatchingBrace(t, 0)).toBe(t.length - 1);
    });

    it('skips braces inside double-quoted strings', () => {
      const t = '{ "evil}": "x{}y" }';
      expect(__internal.findMatchingBrace(t, 0)).toBe(t.length - 1);
    });

    it('skips braces inside backtick raw strings', () => {
      const t = '{ x: `evil}` }';
      expect(__internal.findMatchingBrace(t, 0)).toBe(t.length - 1);
    });

    it('skips braces inside line comments', () => {
      const t = '{ // }\n  x }';
      expect(__internal.findMatchingBrace(t, 0)).toBe(t.length - 1);
    });

    it('skips braces inside block comments', () => {
      const t = '{ /* } { */ x }';
      expect(__internal.findMatchingBrace(t, 0)).toBe(t.length - 1);
    });

    it('returns -1 for unbalanced input', () => {
      expect(__internal.findMatchingBrace('{abc', 0)).toBe(-1);
    });
  });

  describe('extractSchemaKeysFromBlock', () => {
    it('extracts depth-1 keys only, skipping nested blocks', () => {
      const block = `{
        "outer_a": &pluginsdk.Schema{
          "should_not_be_extracted": &pluginsdk.Schema{},
        },
        "outer_b": { Type: x },
      }`;
      const keys = __internal.extractSchemaKeysFromBlock(block);
      expect(keys).toEqual(['outer_a', 'outer_b']);
    });

    it('ignores keys appearing inside string literals', () => {
      const block = `{
        "real": { x: "fake_key": pretend },
      }`;
      const keys = __internal.extractSchemaKeysFromBlock(block);
      expect(keys).toEqual(['real']);
    });
  });

  describe('topLevelSchemas', () => {
    it('separates outer Schema from nested Elem.Schema', () => {
      const literals = __internal.findSchemaLiterals(FIXTURE_4_NESTED_AND_DOTNAV);
      expect(literals.length).toBe(2);
      const tops = __internal.topLevelSchemas(literals);
      expect(tops.length).toBe(1);
      expect(tops[0].keys).toEqual(['name', 'network_rule_set']);
      const nested = literals.find(l => l !== tops[0]);
      expect(nested.keys).toEqual(['bypass', 'default_action']);
    });
  });

  describe('findResourceDataVarnames', () => {
    it('picks up varname even when not "d"', () => {
      const set = __internal.findResourceDataVarnames(FIXTURE_6_CUSTOM_VARNAME);
      expect(set.has('rd')).toBe(true);
    });

    it('handles both schema.ResourceData and pluginsdk.ResourceData', () => {
      const code = `func a(d *schema.ResourceData) {}\nfunc b(rd *pluginsdk.ResourceData) {}`;
      const set = __internal.findResourceDataVarnames(code);
      expect([...set].sort()).toEqual(['d', 'rd']);
    });
  });

  describe('toggleNamingStyle', () => {
    it('snake → camel', () => {
      expect(__internal.toggleNamingStyle('runtime_environment')).toBe('runtimeEnvironment');
    });
    it('camel → snake', () => {
      expect(__internal.toggleNamingStyle('runtimeEnvironment')).toBe('runtime_environment');
    });
    it('returns null for plain lowercase', () => {
      expect(__internal.toggleNamingStyle('name')).toBeNull();
    });
  });

  describe('resolveUnderRepo', () => {
    it('rejects ../escape paths', () => {
      const repo = makeRepo({ 'a.go': 'x' });
      try {
        expect(() => __internal.resolveUnderRepo(repo, '../escape.go')).toThrow(/INVALID_INPUT/);
      } finally {
        cleanup(repo);
      }
    });

    it('accepts relative paths inside repo', () => {
      const repo = makeRepo({ 'sub/a.go': 'x' });
      try {
        const abs = __internal.resolveUnderRepo(repo, 'sub/a.go');
        expect(abs).toBe(path.resolve(repo, 'sub/a.go'));
      } finally {
        cleanup(repo);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// validateTerraformChanges integration tests
// ---------------------------------------------------------------------------

describe('validateTerraformChanges', () => {
  let repo;

  afterEach(() => {
    cleanup(repo);
    repo = null;
  });

  describe('input contract', () => {
    it('rejects missing repoPath', async () => {
      await expect(validateTerraformChanges({ files: ['x.go'] }))
        .rejects.toThrow(/INVALID_INPUT.*repoPath/);
    });

    it('rejects non-existent repoPath', async () => {
      await expect(
        validateTerraformChanges({ repoPath: '/no/such/dir/xyz', files: ['x.go'] })
      ).rejects.toThrow(/INVALID_INPUT.*does not exist/);
    });

    it('rejects missing files[]', async () => {
      repo = makeRepo({ 'a.go': 'x' });
      await expect(validateTerraformChanges({ repoPath: repo }))
        .rejects.toThrow(/INVALID_INPUT.*files\[\]/);
    });

    it('rejects empty files[]', async () => {
      repo = makeRepo({ 'a.go': 'x' });
      await expect(validateTerraformChanges({ repoPath: repo, files: [] }))
        .rejects.toThrow(/INVALID_INPUT.*files\[\]/);
    });

    it('rejects path that escapes repoPath', async () => {
      repo = makeRepo({ 'a.go': 'x' });
      await expect(
        validateTerraformChanges({ repoPath: repo, files: ['../escape_resource.go'] })
      ).rejects.toThrow(/INVALID_INPUT/);
    });
  });

  describe('self-skip', () => {
    it('returns clean skip when no terraform provider files in scope', async () => {
      repo = makeRepo({ 'main.go': 'package x', 'README.md': '# hi' });
      const r = await validateTerraformChanges({
        repoPath: repo,
        files: ['main.go', 'README.md'],
      });
      expect(r.findings).toEqual([]);
      expect(r.summary).toMatch(/no terraform provider files in scope/);
    });

    it('still skips on .go files that are not _resource.go style', async () => {
      repo = makeRepo({ 'helpers.go': 'package x' });
      const r = await validateTerraformChanges({ repoPath: repo, files: ['helpers.go'] });
      expect(r.summary).toMatch(/skipped/);
    });
  });

  describe('Fixture 1: clean resource', () => {
    it('returns no findings', async () => {
      repo = makeRepo({ 'foo_resource.go': FIXTURE_1_CLEAN });
      const r = await validateTerraformChanges({ repoPath: repo, files: ['foo_resource.go'] });
      expect(r.findings).toEqual([]);
      expect(r.summary).toMatch(/found 0 finding/);
    });
  });

  describe('Fixture 2: undeclared key', () => {
    it('reports 1 high finding for d.Set("runtime_env") with rule field-naming-undeclared', async () => {
      repo = makeRepo({ 'foo_resource.go': FIXTURE_2_UNDECLARED_KEY });
      const r = await validateTerraformChanges({ repoPath: repo, files: ['foo_resource.go'] });
      expect(r.findings.length).toBe(1);
      const f = r.findings[0];
      expect(f.rule).toBe('field-naming-undeclared');
      expect(f.severity).toBe('high');
      expect(f.message).toContain('runtime_env');
      expect(f.file).toBe('foo_resource.go');
      expect(f.line).toBeGreaterThan(0);
    });
  });

  describe('Fixture 3: case drift', () => {
    it('reports 1 medium finding with rule field-naming-case', async () => {
      repo = makeRepo({ 'foo_resource.go': FIXTURE_3_CASE_DRIFT });
      const r = await validateTerraformChanges({ repoPath: repo, files: ['foo_resource.go'] });
      expect(r.findings.length).toBe(1);
      const f = r.findings[0];
      expect(f.rule).toBe('field-naming-case');
      expect(f.severity).toBe('medium');
      expect(f.message).toContain('runtime_environment');
      expect(f.message).toContain('runtimeEnvironment');
    });
  });

  describe('Fixture 4: nested schema + dot-navigation', () => {
    it('does not flag dot-navigation key, does not bleed nested keys to top-level', async () => {
      repo = makeRepo({ 'foo_resource.go': FIXTURE_4_NESTED_AND_DOTNAV });
      const r = await validateTerraformChanges({ repoPath: repo, files: ['foo_resource.go'] });
      expect(r.findings).toEqual([]);
    });
  });

  describe('Fixture 5: multi-file', () => {
    it('groups findings by file and only flags the bad file', async () => {
      repo = makeRepo({
        'a_resource.go': FIXTURE_5A_OK,
        'b_resource.go': FIXTURE_5B_BAD,
      });
      const r = await validateTerraformChanges({
        repoPath: repo,
        files: ['a_resource.go', 'b_resource.go'],
      });
      expect(r.findings.length).toBe(1);
      expect(r.findings[0].file).toBe('b_resource.go');
      expect(r.findings[0].rule).toBe('field-naming-undeclared');
      expect(r.summary).toMatch(/Validated 2 terraform file/);
    });
  });

  describe('Fixture 6: custom varname (rd instead of d)', () => {
    it('still recognizes rd as ResourceData and flags undeclared key on rd.Set', async () => {
      repo = makeRepo({ 'foo_resource.go': FIXTURE_6_CUSTOM_VARNAME });
      const r = await validateTerraformChanges({ repoPath: repo, files: ['foo_resource.go'] });
      expect(r.findings.length).toBe(1);
      expect(r.findings[0].message).toContain('undeclared_key');
      expect(r.findings[0].message).toContain('rd.Set');
    });
  });

  describe('file pattern coverage', () => {
    it('also validates _data_source.go files', async () => {
      repo = makeRepo({ 'foo_data_source.go': FIXTURE_2_UNDECLARED_KEY });
      const r = await validateTerraformChanges({ repoPath: repo, files: ['foo_data_source.go'] });
      expect(r.findings.length).toBe(1);
    });

    it('also validates _resource_gen.go files', async () => {
      repo = makeRepo({ 'foo_resource_gen.go': FIXTURE_2_UNDECLARED_KEY });
      const r = await validateTerraformChanges({ repoPath: repo, files: ['foo_resource_gen.go'] });
      expect(r.findings.length).toBe(1);
    });
  });

  describe('absolute paths in files[]', () => {
    it('accepts absolute paths under repoPath', async () => {
      repo = makeRepo({ 'foo_resource.go': FIXTURE_1_CLEAN });
      const abs = path.join(repo, 'foo_resource.go');
      const r = await validateTerraformChanges({ repoPath: repo, files: [abs] });
      expect(r.findings).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// MCP tool plumbing
// ---------------------------------------------------------------------------

describe('handleToolRequest (MCP plumbing)', () => {
  let repo;
  afterEach(() => {
    cleanup(repo);
    repo = null;
  });

  it('returns success result for valid input', async () => {
    repo = makeRepo({ 'foo_resource.go': FIXTURE_2_UNDECLARED_KEY });
    const res = await handleToolRequest({
      params: {
        name: 'validate_terraform_changes',
        arguments: { repoPath: repo, files: ['foo_resource.go'] },
      },
    });
    expect(res.isError).toBeUndefined();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.findings.length).toBe(1);
    expect(parsed.summary).toBeTruthy();
  });

  it('returns isError=true for unknown tool', async () => {
    const res = await handleToolRequest({
      params: { name: 'wat', arguments: {} },
    });
    expect(res.isError).toBe(true);
  });

  it('returns isError=true for INVALID_INPUT, surfacing message', async () => {
    const res = await handleToolRequest({
      params: { name: 'validate_terraform_changes', arguments: {} },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/INVALID_INPUT/);
  });
});

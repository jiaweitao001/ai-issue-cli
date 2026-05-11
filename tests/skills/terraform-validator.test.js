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

// ---------------------------------------------------------------------------
// B-Extend rule fixtures
// ---------------------------------------------------------------------------

const FIXTURE_OPT_GET_BAD = `package foo

import "github.com/hashicorp/terraform-provider-azurerm/internal/tf/pluginsdk"

func resourceFoo() *pluginsdk.Resource {
  return &pluginsdk.Resource{
    Schema: map[string]*pluginsdk.Schema{
      "tag": {
        Type:     pluginsdk.TypeString,
        Optional: true,
      },
    },
  }
}

func resourceFooRead(d *pluginsdk.ResourceData, meta interface{}) error {
  v := d.Get("tag").(string)
  _ = v
  return nil
}
`;

const FIXTURE_OPT_GET_OK_GETOK = `package foo

import "github.com/hashicorp/terraform-provider-azurerm/internal/tf/pluginsdk"

func resourceFoo() *pluginsdk.Resource {
  return &pluginsdk.Resource{
    Schema: map[string]*pluginsdk.Schema{
      "tag": {
        Type:     pluginsdk.TypeString,
        Optional: true,
      },
    },
  }
}

func resourceFooRead(d *pluginsdk.ResourceData, meta interface{}) error {
  if v, ok := d.GetOk("tag"); ok {
    _ = v
  }
  return nil
}
`;

const FIXTURE_OPT_GET_WITH_DEFAULT = `package foo

import "github.com/hashicorp/terraform-provider-azurerm/internal/tf/pluginsdk"

func resourceFoo() *pluginsdk.Resource {
  return &pluginsdk.Resource{
    Schema: map[string]*pluginsdk.Schema{
      "tag": {
        Type:     pluginsdk.TypeString,
        Optional: true,
        Default:  "prod",
      },
    },
  }
}

func resourceFooRead(d *pluginsdk.ResourceData, meta interface{}) error {
  v := d.Get("tag").(string)
  _ = v
  return nil
}
`;

const FIXTURE_OPT_COMPUTED_GET = `package foo

import "github.com/hashicorp/terraform-provider-azurerm/internal/tf/pluginsdk"

func resourceFoo() *pluginsdk.Resource {
  return &pluginsdk.Resource{
    Schema: map[string]*pluginsdk.Schema{
      "tag": {
        Type:     pluginsdk.TypeString,
        Optional: true,
        Computed: true,
      },
    },
  }
}

func resourceFooRead(d *pluginsdk.ResourceData, meta interface{}) error {
  v := d.Get("tag").(string)
  _ = v
  return nil
}
`;

const FIXTURE_REQUIRED_GET = `package foo

import "github.com/hashicorp/terraform-provider-azurerm/internal/tf/pluginsdk"

func resourceFoo() *pluginsdk.Resource {
  return &pluginsdk.Resource{
    Schema: map[string]*pluginsdk.Schema{
      "name": {
        Type:     pluginsdk.TypeString,
        Required: true,
      },
    },
  }
}

func resourceFooRead(d *pluginsdk.ResourceData, meta interface{}) error {
  v := d.Get("name").(string)
  _ = v
  return nil
}
`;

const FIXTURE_OPT_GET_HELPER_FN = `package foo

import "github.com/hashicorp/terraform-provider-azurerm/internal/tf/pluginsdk"

func resourceFoo() *pluginsdk.Resource {
  return &pluginsdk.Resource{
    Schema: map[string]*pluginsdk.Schema{
      "location": commonschema.Location(),
    },
  }
}

func resourceFooRead(d *pluginsdk.ResourceData, meta interface{}) error {
  v := d.Get("location").(string)
  _ = v
  return nil
}
`;

const FIXTURE_NIL_UNCHECKED = `package foo

func read(d *pluginsdk.ResourceData, meta interface{}) error {
  resp, err := client.Get(ctx, id)
  if err != nil {
    return err
  }
  d.Set("foo", pointer.From(resp.Model.Properties.Foo))
  return nil
}
`;

const FIXTURE_NIL_CHECKED = `package foo

func read(d *pluginsdk.ResourceData, meta interface{}) error {
  resp, err := client.Get(ctx, id)
  if err != nil {
    return err
  }
  if resp.Model == nil || resp.Model.Properties == nil {
    return nil
  }
  d.Set("foo", pointer.From(resp.Model.Properties.Foo))
  return nil
}
`;

const FIXTURE_NIL_PARTIAL = `package foo

func read(d *pluginsdk.ResourceData, meta interface{}) error {
  resp, err := client.Get(ctx, id)
  if err != nil {
    return err
  }
  if resp.Model != nil {
    d.Set("foo", pointer.From(resp.Model.Properties.Foo))
  }
  return nil
}
`;

const FIXTURE_NIL_GUARDED_AND = `package foo

func read(d *pluginsdk.ResourceData, meta interface{}) error {
  resp, _ := client.Get(ctx, id)
  if resp.Model != nil && resp.Model.Properties != nil {
    d.Set("foo", pointer.From(resp.Model.Properties.Foo))
  }
  return nil
}
`;

const FIXTURE_NIL_SHORT_CHAIN = `package foo

func read(d *pluginsdk.ResourceData, meta interface{}) error {
  resp, _ := client.Get(ctx, id)
  d.Set("foo", pointer.From(resp.Foo))
  return nil
}
`;

const FIXTURE_NIL_FUNC_CALL_ARG = `package foo

func read(d *pluginsdk.ResourceData, meta interface{}) error {
  d.Set("foo", pointer.From(getValue()))
  return nil
}
`;

const FIXTURE_NIL_TWO_FUNCS = `package foo

func helperA(resp *Response) {
  if resp.Model == nil || resp.Model.Properties == nil { return }
  _ = pointer.From(resp.Model.Properties.Foo)
}

func helperB(resp *Response) {
  _ = pointer.From(resp.Model.Properties.Foo)
}
`;

// ---------------------------------------------------------------------------
// B-Extend: extractSchemaEntriesFromBlock unit tests
// ---------------------------------------------------------------------------

describe('extractSchemaEntriesFromBlock (B-Extend)', () => {
  it('extracts inline entries with property flags', () => {
    const block = `{
      "name": {Required: true},
      "tag": {Optional: true},
      "computed_only": {Computed: true},
      "with_default": {Optional: true, Default: "x"},
    }`;
    const entries = __internal.extractSchemaEntriesFromBlock(block);
    expect(entries).toEqual([
      { key: 'name', optional: false, required: true, computed: false, hasDefault: false, inline: true },
      { key: 'tag', optional: true, required: false, computed: false, hasDefault: false, inline: true },
      { key: 'computed_only', optional: false, required: false, computed: true, hasDefault: false, inline: true },
      { key: 'with_default', optional: true, required: false, computed: false, hasDefault: true, inline: true },
    ]);
  });

  it('marks function-call values as inline:false (opaque)', () => {
    const block = `{
      "location": commonschema.Location(),
      "tag": {Optional: true},
    }`;
    const entries = __internal.extractSchemaEntriesFromBlock(block);
    expect(entries[0]).toEqual({ key: 'location', inline: false });
    expect(entries[1].inline).toBe(true);
    expect(entries[1].optional).toBe(true);
  });

  it('does not mistake property names inside a nested Elem block for top-level entries', () => {
    const block = `{
      "outer": {
        Type: pluginsdk.TypeList,
        Optional: true,
        Elem: &pluginsdk.Resource{
          Schema: map[string]*pluginsdk.Schema{
            "inner": {
              Type: pluginsdk.TypeString,
              Required: true,
            },
          },
        },
      },
    }`;
    const entries = __internal.extractSchemaEntriesFromBlock(block);
    expect(entries.map(e => e.key)).toEqual(['outer']);
    expect(entries[0].optional).toBe(true);
  });

  it('does NOT inherit a nested entry\'s flags into the outer (regression: rubber-duck v6)', () => {
    const block = `{
      "outer": {
        Type: pluginsdk.TypeList,
        Required: true,
        Elem: &pluginsdk.Resource{
          Schema: map[string]*pluginsdk.Schema{
            "inner": {
              Type: pluginsdk.TypeString,
              Optional: true,
              Default: "x",
            },
          },
        },
      },
    }`;
    const entries = __internal.extractSchemaEntriesFromBlock(block);
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe('outer');
    expect(entries[0].required).toBe(true);
    expect(entries[0].optional).toBe(false);
    expect(entries[0].hasDefault).toBe(false);
  });

  it('treats DefaultFunc as a default (Get() is safe)', () => {
    const block = `{
      "tag": {
        Type: pluginsdk.TypeString,
        Optional: true,
        DefaultFunc: schema.EnvDefaultFunc("MY_VAR", "fallback"),
      },
    }`;
    const entries = __internal.extractSchemaEntriesFromBlock(block);
    expect(entries[0].optional).toBe(true);
    expect(entries[0].hasDefault).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B-Extend: checkSchemaOptionalGet
// ---------------------------------------------------------------------------

describe('checkSchemaOptionalGet (B-Extend)', () => {
  it('flags Get() on Optional field without Default → medium', () => {
    const findings = __internal.checkSchemaOptionalGet(FIXTURE_OPT_GET_BAD);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('schema-optional-get');
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].message).toMatch(/GetOk/);
  });

  it('does not flag GetOk() on Optional field', () => {
    expect(__internal.checkSchemaOptionalGet(FIXTURE_OPT_GET_OK_GETOK)).toEqual([]);
  });

  it('does not flag Get() on Optional field WITH Default', () => {
    expect(__internal.checkSchemaOptionalGet(FIXTURE_OPT_GET_WITH_DEFAULT)).toEqual([]);
  });

  it('does not flag Get() on Optional+Computed field', () => {
    expect(__internal.checkSchemaOptionalGet(FIXTURE_OPT_COMPUTED_GET)).toEqual([]);
  });

  it('does not flag Get() on Required field', () => {
    expect(__internal.checkSchemaOptionalGet(FIXTURE_REQUIRED_GET)).toEqual([]);
  });

  it('does not flag Get() on entry built via helper function (opaque)', () => {
    expect(__internal.checkSchemaOptionalGet(FIXTURE_OPT_GET_HELPER_FN)).toEqual([]);
  });

  it('does not flag Get() on dot-navigation key', () => {
    const code = `
      package foo
      func resourceFoo() *pluginsdk.Resource {
        return &pluginsdk.Resource{
          Schema: map[string]*pluginsdk.Schema{
            "outer": {Optional: true, Type: pluginsdk.TypeList},
          },
        }
      }
      func r(d *pluginsdk.ResourceData) {
        _ = d.Get("outer.0.field")
      }
    `;
    expect(__internal.checkSchemaOptionalGet(code)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B-Extend: findGoFunctionBodies / findEnclosingFunction
// ---------------------------------------------------------------------------

describe('findGoFunctionBodies / findEnclosingFunction (B-Extend)', () => {
  it('finds top-level function bodies', () => {
    const code = `package x\nfunc foo() {\n  return\n}\nfunc bar(a int) (int, error) {\n  return 0, nil\n}`;
    const funcs = __internal.findGoFunctionBodies(code);
    expect(funcs).toHaveLength(2);
    expect(code[funcs[0].bodyStart]).toBe('{');
    expect(code[funcs[0].bodyEnd]).toBe('}');
  });

  it('finds methods with receiver', () => {
    const code = `package x\nfunc (r *Resource) Foo() {\n  return\n}`;
    const funcs = __internal.findGoFunctionBodies(code);
    expect(funcs).toHaveLength(1);
  });

  it('finds function literals (closures)', () => {
    const code = `package x\nfunc outer() {\n  fn := func(a int) {\n    return\n  }\n  _ = fn\n}`;
    const funcs = __internal.findGoFunctionBodies(code);
    expect(funcs).toHaveLength(2);
  });

  it('findEnclosingFunction returns smallest containing function', () => {
    const code = `package x\nfunc outer() {\n  fn := func() { /*INNER*/ }\n  _ = fn\n}`;
    const funcs = __internal.findGoFunctionBodies(code);
    const innerOffset = code.indexOf('INNER');
    const enclosing = __internal.findEnclosingFunction(funcs, innerOffset);
    expect(enclosing).toBeTruthy();
    expect(enclosing.bodyEnd - enclosing.bodyStart).toBeLessThan(
      Math.max(...funcs.map(f => f.bodyEnd - f.bodyStart))
    );
  });

  it('returns null for offset outside any function (top-level code)', () => {
    const code = `package x\nvar x = 1\nfunc foo() {}\n`;
    const funcs = __internal.findGoFunctionBodies(code);
    const topOffset = code.indexOf('var');
    expect(__internal.findEnclosingFunction(funcs, topOffset)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B-Extend: checkPointerFromForFile
// ---------------------------------------------------------------------------

describe('checkPointerFromForFile (B-Extend)', () => {
  it('flags pointer.From with unchecked 3-level chain → warning', () => {
    const findings = __internal.checkPointerFromForFile(FIXTURE_NIL_UNCHECKED);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('pointer-from-unchecked-chain');
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toMatch(/resp\.Model/);
  });

  it('does not flag when both intermediates are nil-checked via ||', () => {
    expect(__internal.checkPointerFromForFile(FIXTURE_NIL_CHECKED)).toEqual([]);
  });

  it('does not flag when both intermediates are nil-checked via &&', () => {
    expect(__internal.checkPointerFromForFile(FIXTURE_NIL_GUARDED_AND)).toEqual([]);
  });

  it('still flags when only outer is checked (Properties unchecked)', () => {
    const findings = __internal.checkPointerFromForFile(FIXTURE_NIL_PARTIAL);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toMatch(/resp\.Model\.Properties/);
  });

  it('does not flag short chain (resp.Foo, only 1 access level)', () => {
    expect(__internal.checkPointerFromForFile(FIXTURE_NIL_SHORT_CHAIN)).toEqual([]);
  });

  it('does not flag pointer.From with function-call argument', () => {
    expect(__internal.checkPointerFromForFile(FIXTURE_NIL_FUNC_CALL_ARG)).toEqual([]);
  });

  it('checks nil-safety per function (helperA clean, helperB flagged)', () => {
    const findings = __internal.checkPointerFromForFile(FIXTURE_NIL_TWO_FUNCS);
    expect(findings).toHaveLength(1);
    // Only helperB's call should fire
    const helperBOffset = FIXTURE_NIL_TWO_FUNCS.indexOf('helperB');
    const beforeHelperB = FIXTURE_NIL_TWO_FUNCS.slice(0, helperBOffset);
    const lineOfHelperB = (beforeHelperB.match(/\n/g) || []).length + 1;
    expect(findings[0].line).toBeGreaterThan(lineOfHelperB);
  });
});

// ---------------------------------------------------------------------------
// B-Extend: end-to-end through validateTerraformChanges
// ---------------------------------------------------------------------------

describe('validateTerraformChanges (B-Extend integration)', () => {
  let repo;
  afterEach(() => {
    cleanup(repo);
    repo = null;
  });

  it('surfaces schema-optional-get finding end-to-end', async () => {
    repo = makeRepo({ 'foo_resource.go': FIXTURE_OPT_GET_BAD });
    const res = await validateTerraformChanges({
      repoPath: repo,
      files: ['foo_resource.go'],
    });
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].rule).toBe('schema-optional-get');
    expect(res.findings[0].file).toBe('foo_resource.go');
    expect(res.summary).toMatch(/medium=1/);
  });

  it('surfaces pointer-from-unchecked-chain finding end-to-end', async () => {
    repo = makeRepo({ 'foo_resource.go': FIXTURE_NIL_UNCHECKED });
    const res = await validateTerraformChanges({
      repoPath: repo,
      files: ['foo_resource.go'],
    });
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].rule).toBe('pointer-from-unchecked-chain');
    expect(res.findings[0].severity).toBe('warning');
    expect(res.summary).toMatch(/warning=1/);
  });

  it('reports all rule classes together with correct counts', async () => {
    const combined = `package foo
import "github.com/hashicorp/terraform-provider-azurerm/internal/tf/pluginsdk"
func resourceFoo() *pluginsdk.Resource {
  return &pluginsdk.Resource{
    Schema: map[string]*pluginsdk.Schema{
      "name": {Type: pluginsdk.TypeString, Required: true},
      "tag": {Type: pluginsdk.TypeString, Optional: true},
    },
  }
}
func resourceFooRead(d *pluginsdk.ResourceData) error {
  d.Set("nope", "x")
  v := d.Get("tag").(string)
  _ = v
  d.Set("foo", pointer.From(resp.Model.Properties.Foo))
  return nil
}
`;
    repo = makeRepo({ 'foo_resource.go': combined });
    const res = await validateTerraformChanges({
      repoPath: repo,
      files: ['foo_resource.go'],
    });
    const rules = res.findings.map(f => f.rule).sort();
    expect(rules).toEqual([
      'field-naming-undeclared', // d.Set("nope", ...)
      'field-naming-undeclared', // d.Set("foo", pointer.From(...))
      'pointer-from-unchecked-chain',
      'schema-optional-get',
    ]);
    expect(res.summary).toMatch(/high=2/);
    expect(res.summary).toMatch(/medium=1/);
    expect(res.summary).toMatch(/warning=1/);
  });
});

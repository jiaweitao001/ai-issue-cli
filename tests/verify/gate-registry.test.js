const { getAllGates, UNIT_TEST_REGEX } = require('../../lib/verify/gate-registry');

describe('verify gate-registry', () => {
  it('contains the 13 azurerm PR workflow gates plus fmtcheck prerequisite', () => {
    const gates = getAllGates();
    expect(gates.map(g => g.id).sort()).toEqual([
      'breaking-change-detection',
      'depscheck',
      'enforce-list-resources',
      'fmtcheck',
      'gencheck',
      'golangci-lint',
      'gradually-deprecated',
      'preview-api-version-linter',
      'shellcheck',
      'static-analysis',
      'tflint',
      'unit-test',
      'validate-examples',
      'website-lint'
    ].sort());
  });

  it('uses HashiCorp unit-test regex verbatim to exclude TestAcc', () => {
    expect(UNIT_TEST_REGEX).toBe('^Test[^A]|^TestA[^c]|^TestAc[^c]');
    const unit = getAllGates().find(g => g.id === 'unit-test');
    expect(unit.commands[1].args).toContain(`-run=${UNIT_TEST_REGEX}`);
  });

  it('captures key upstream path filters', () => {
    const unit = getAllGates().find(g => g.id === 'unit-test');
    expect(unit.paths).toEqual(['.github/workflows/unit-test.yaml', 'go.mod', 'vendor/**', '**.go']);
    const preview = getAllGates().find(g => g.id === 'preview-api-version-linter');
    expect(preview.paths).toEqual([
      '.github/workflows/preview-api-version-linter.yaml',
      'internal/tools/preview-api-version-linter/**',
      'vendor/**'
    ]);
  });
});

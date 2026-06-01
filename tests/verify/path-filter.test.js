const {
  matchesPattern,
  shouldRunForPaths
} = require('../../lib/verify/path-filter');

describe('verify path-filter', () => {
  it('matches GitHub Actions glob subset used by azurerm workflows', () => {
    expect(matchesPattern('internal/services/foo/bar_resource.go', 'internal/services/**/*_resource.go')).toBe(true);
    expect(matchesPattern('internal/services/foo_resource.go', 'internal/services/**/*_resource.go')).toBe(true);
    expect(matchesPattern('internal/provider/provider.go', '**.go')).toBe(true);
    expect(matchesPattern('vendor/github.com/x/y/file.go', 'vendor/**')).toBe(true);
    expect(matchesPattern('./scripts/run-gradually-deprecated.sh', './scripts/run-gradually-deprecated.sh')).toBe(true);
  });

  it('runs a gate when any changed file matches any path pattern', () => {
    expect(shouldRunForPaths(['go.mod'], ['.github/workflows/unit-test.yaml', 'go.mod', 'vendor/**', '**.go'])).toBe(true);
    expect(shouldRunForPaths(['README.md'], ['**.go'])).toBe(false);
  });
});

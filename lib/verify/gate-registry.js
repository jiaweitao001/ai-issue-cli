// @ts-check

/**
 * Source of truth:
 * hashicorp/terraform-provider-azurerm/.github/workflows/*.yaml at PR-CI time.
 * Keep paths and command sequences aligned with upstream workflow YAMLs.
 */

/** @typedef {import('../types').VerifyGate} VerifyGate */

const UNIT_TEST_REGEX = "^Test[^A]|^TestA[^c]|^TestAc[^c]";

/** @type {VerifyGate[]} */
const GATES = [
  {
    id: 'fmtcheck',
    sourceWorkflow: 'unit-test.yaml',
    phase: 'A',
    paths: ['.github/workflows/unit-test.yaml', 'go.mod', 'vendor/**', '**.go'],
    commands: [
      { cmd: 'bash', args: ['scripts/gogetcookie.sh'] },
      { cmd: 'make', args: ['fmtcheck'] }
    ],
    guidance: [
      'Run make fmtcheck locally and fix formatting, timeout metadata, or test package issues.',
      'This is a local prerequisite mirrored from the Unit Tests workflow before gotestsum runs.'
    ].join('\n'),
    timeoutSec: 600,
    mutates: false,
    heavy: false
  },
  {
    id: 'depscheck',
    sourceWorkflow: 'depscheck.yaml',
    phase: 'A',
    paths: ['.github/workflows/depscheck.yaml', 'vendor/**', '**.go'],
    commands: [
      { cmd: 'bash', args: ['scripts/gogetcookie.sh'] },
      { cmd: 'make', args: ['depscheck'] }
    ],
    guidance: [
      'Vendor Dependencies Check failed.',
      'Do not modify files in the vendor/ directory directly.',
      "Instead, update dependencies in go.mod and run 'go mod tidy && go mod vendor' to sync the vendor directory.",
      "Then run 'make depscheck' locally to verify before pushing."
    ].join('\n'),
    timeoutSec: 1800,
    mutates: true,
    heavy: true
  },
  {
    id: 'gencheck',
    sourceWorkflow: 'gencheck.yaml',
    phase: 'A',
    paths: ['.github/workflows/gencheck.yaml', '**.go'],
    commands: [
      { cmd: 'bash', args: ['scripts/gogetcookie.sh'] },
      { cmd: 'make', args: ['gencheck'] }
    ],
    guidance: [
      'Generation Check failed.',
      "Run 'make generate' locally to regenerate auto-generated code, then commit the changes.",
      'This check ensures that generated files are up to date with their source definitions.'
    ].join('\n'),
    timeoutSec: 1800,
    mutates: true,
    requiresTools: true,
    heavy: true
  },
  {
    id: 'unit-test',
    sourceWorkflow: 'unit-test.yaml',
    phase: 'B',
    paths: ['.github/workflows/unit-test.yaml', 'go.mod', 'vendor/**', '**.go'],
    commands: [
      { cmd: 'go', args: ['install', 'gotest.tools/gotestsum@v1.13.0'] },
      {
        cmd: 'gotestsum',
        args: [
          '--format', 'pkgname-and-test-fails',
          '--format-hide-empty-pkg', '--',
          '-timeout=30s',
          '-parallel=32',
          `-run=${UNIT_TEST_REGEX}`,
          './...'
        ]
      }
    ],
    guidance: [
      'Unit Tests failed.',
      "Run 'make test' locally to reproduce and fix the failing tests.",
      'If you have added a new resource or data source, ensure you have added the corresponding unit tests.',
      'Check the test output above for details on which tests failed and why.'
    ].join('\n'),
    timeoutSec: 2400,
    mutates: false,
    heavy: true
  },
  {
    id: 'golangci-lint',
    sourceWorkflow: 'golint.yaml',
    phase: 'B',
    paths: ['.github/workflows/golint.yaml', 'vendor/**', '**.go'],
    commands: [{ cmd: 'golangci-lint', args: ['run', '-v', './internal/...'] }],
    guidance: [
      'GoLang Linting failed.',
      'Run the Go linter locally: golangci-lint run -v ./internal/...',
      'Fix any reported issues before pushing. Common issues include unused variables or imports, unchecked errors, and formatting issues.'
    ].join('\n'),
    timeoutSec: 900,
    mutates: false,
    requiresTools: true,
    heavy: true
  },
  {
    id: 'tflint',
    sourceWorkflow: 'tflint.yaml',
    phase: 'B',
    paths: ['.github/workflows/tflint.yaml', 'vendor/**', '**.go'],
    commands: [
      { cmd: 'bash', args: ['scripts/gogetcookie.sh'] },
      { cmd: 'make', args: ['tools'] },
      { cmd: 'make', args: ['tflint'] }
    ],
    guidance: [
      'Terraform Schema Linting failed.',
      "Run 'make tflint' locally to reproduce and fix the errors.",
      'This check validates Terraform schema definitions in resource and data source code.'
    ].join('\n'),
    timeoutSec: 1200,
    mutates: false,
    requiresTools: true,
    heavy: true
  },
  {
    id: 'static-analysis',
    sourceWorkflow: 'static-analysis.yaml',
    phase: 'B',
    paths: ['.github/workflows/static-analysis.yaml', 'vendor/**', 'internal/**.go'],
    commands: [{ cmd: 'bash', args: ['./scripts/run-static-analysis.sh'] }],
    guidance: [
      'Static Analysis failed.',
      "Run 'bash ./scripts/run-static-analysis.sh' locally to reproduce.",
      'This check looks for common code patterns that may indicate bugs or deviations from project conventions.'
    ].join('\n'),
    timeoutSec: 600,
    mutates: false,
    heavy: false
  },
  {
    id: 'website-lint',
    sourceWorkflow: 'website-lint.yaml',
    phase: 'B',
    paths: ['.github/workflows/website-lint.yaml', 'website/**', 'internal/services/**'],
    commands: [
      { cmd: 'bash', args: ['scripts/gogetcookie.sh'] },
      { cmd: 'make', args: ['tools'] },
      { cmd: 'make', args: ['website-lint'] },
      { cmd: 'make', args: ['document-validate'] }
    ],
    guidance: [
      'Website Linting failed.',
      "Run 'make website-lint' and 'make document-validate' locally.",
      'Check documentation files under website/ for formatting or validation issues.'
    ].join('\n'),
    timeoutSec: 1200,
    mutates: false,
    requiresTools: true,
    heavy: false
  },
  {
    id: 'validate-examples',
    sourceWorkflow: 'validate-examples.yaml',
    phase: 'B',
    paths: ['.github/workflows/validate-examples.yaml', 'examples/**'],
    commands: [
      { cmd: 'bash', args: ['scripts/gogetcookie.sh'] },
      { cmd: 'make', args: ['tools'] },
      { cmd: 'make', args: ['validate-examples'] }
    ],
    guidance: [
      'Example Validation failed.',
      "Run 'make validate-examples' locally to check that example Terraform configurations under examples/ are valid.",
      'Ensure all examples use valid HCL syntax and reference existing resources.'
    ].join('\n'),
    timeoutSec: 1800,
    mutates: true,
    requiresTools: true,
    heavy: true
  },
  {
    id: 'shellcheck',
    sourceWorkflow: 'shellcheck.yaml',
    phase: 'B',
    paths: ['.github/workflows/shellcheck.yaml', 'scripts/**'],
    commands: [{ cmd: 'make', args: ['shellcheck'] }],
    guidance: [
      'ShellCheck failed.',
      "Run 'make shellcheck' locally to check shell scripts for issues.",
      'ShellCheck identifies common shell scripting pitfalls and bugs.'
    ].join('\n'),
    timeoutSec: 600,
    mutates: false,
    heavy: false
  },
  {
    id: 'breaking-change-detection',
    sourceWorkflow: 'breaking-change-detection.yaml',
    phase: 'B',
    paths: ['.github/workflows/breaking-change-detection.yaml', 'vendor/**', 'internal/**.go'],
    commands: [{ cmd: 'bash', args: ['./scripts/run-breaking-change-detection.sh'] }],
    guidance: [
      'Breaking Schema Changes detected.',
      'Changes contain breaking schema changes such as removing or renaming a property, changing a type, or making an optional property required.',
      'Breaking changes must be gated behind the appropriate feature flag.'
    ].join('\n'),
    timeoutSec: 600,
    mutates: false,
    heavy: false
  },
  {
    id: 'enforce-list-resources',
    sourceWorkflow: 'enforce-list-resources.yaml',
    phase: 'B',
    paths: ['.github/workflows/enforce-list-resources.yaml', 'scripts/enforce-list-for-new-resources.sh', 'internal/services/**/*_resource.go'],
    commands: [{ cmd: 'bash', args: ['scripts/enforce-list-for-new-resources.sh'] }],
    guidance: [
      'New resource(s) detected without a list implementation.',
      'Every new resource must include a *_resource_list.go file and be registered in the service ListResources() method.',
      "If this resource cannot support listing, explain why in the PR description and a maintainer may apply an allow label."
    ].join('\n'),
    timeoutSec: 600,
    mutates: false,
    heavy: false
  },
  {
    id: 'gradually-deprecated',
    sourceWorkflow: 'gradually-deprecated.yaml',
    phase: 'B',
    paths: ['.github/workflows/gradually-deprecated.yaml', './scripts/run-gradually-deprecated.sh', '**.go'],
    commands: [{ cmd: 'bash', args: ['./scripts/run-gradually-deprecated.sh'] }],
    guidance: [
      'New usage of deprecated functionality detected.',
      'Use the recommended replacement instead. Check the output for details on which deprecated items were referenced.'
    ].join('\n'),
    timeoutSec: 600,
    mutates: false,
    heavy: false
  },
  {
    id: 'preview-api-version-linter',
    sourceWorkflow: 'preview-api-version-linter.yaml',
    phase: 'B',
    paths: ['.github/workflows/preview-api-version-linter.yaml', 'internal/tools/preview-api-version-linter/**', 'vendor/**'],
    commands: [{ cmd: 'go', args: ['run', 'internal/tools/preview-api-version-linter/main.go'] }],
    guidance: [
      'Preview API Version Linter failed.',
      'Your changes reference Azure ARM API versions that are in preview.',
      'Preview API versions should not be used unless explicitly required and approved.'
    ].join('\n'),
    timeoutSec: 600,
    mutates: false,
    heavy: false
  }
];

function getAllGates() {
  return GATES.map(gate => ({
    ...gate,
    paths: [...gate.paths],
    commands: gate.commands.map(command => ({ cmd: command.cmd, args: [...command.args] }))
  }));
}

module.exports = {
  UNIT_TEST_REGEX,
  getAllGates
};

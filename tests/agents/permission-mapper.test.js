const { mapPermissionProfile } = require('../../lib/agents/permission-mapper');

describe('permission-mapper', () => {
  it.each([
    ['read-only', 'copilot', ['--allow-all-tools']],
    ['noninteractive-full-auto', 'copilot', ['--allow-all-tools']],
    ['read-only', 'claude-code', ['--permission-mode', 'plan']],
    ['noninteractive-full-auto', 'claude-code', ['--permission-mode', 'bypassPermissions']]
  ])('maps %s for %s', (profile, agentName, expected) => {
    expect(mapPermissionProfile(profile, agentName)).toEqual(expected);
  });

  it('returns a new flags array each time', () => {
    const first = mapPermissionProfile('read-only', 'copilot');
    first.push('--mutated');

    expect(mapPermissionProfile('read-only', 'copilot')).toEqual(['--allow-all-tools']);
  });

  it('throws for unknown agents', () => {
    expect(() => mapPermissionProfile('read-only', 'unknown')).toThrow('Unknown agent');
  });

  it('throws for unknown profiles', () => {
    expect(() => mapPermissionProfile('invalid', 'copilot')).toThrow('Unknown permission profile');
  });
});

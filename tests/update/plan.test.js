// @ts-check
'use strict';

const path = require('path');
const { mockCreateLogger } = require('../helpers/mock-logger');

jest.mock('../../lib/logger', () => mockCreateLogger());

const mockCheckCliVersion = jest.fn();
jest.mock('../../lib/update/version-check', () => ({
  checkCliVersion: mockCheckCliVersion,
  // not used by plan.js but kept so other consumers still pass-through if needed
  resolveEffectiveChannel: jest.fn(),
  channelReasonOf: jest.fn(),
}));

const {
  buildUpdatePlan,
  detectRefChangesHead,
  detectIsDowngrade,
  extractTargetBranch,
} = require('../../lib/update/plan');

function baseDetected(overrides = {}) {
  return {
    mode: 'link',
    sourceClone: '/repo',
    globalPkg: '/usr/local/lib/node_modules/ai-issue-cli',
    currentBranch: 'main',
    workingTreeDirty: false,
    ...overrides,
  };
}

function baseInfo(overrides = {}) {
  return {
    mode: 'link',
    sourceClone: '/repo',
    globalPkg: '/usr/local/lib/node_modules/ai-issue-cli',
    configuredChannel: 'auto',
    effectiveChannel: 'branch',
    channelReason: 'auto-link',
    fromVersion: '0.9.0',
    fromCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    fromLabel: 'aaaaaaa',
    toCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    toLabel: 'main@bbbbbbb',
    toRef: 'refs/heads/main',
    needsUpdate: true,
    upstreamUrl: 'https://github.com/x/y.git',
    ...overrides,
  };
}

describe('lib/update/plan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('detectRefChangesHead', () => {
    test('returns false in copy mode (irrelevant)', () => {
      expect(detectRefChangesHead({ mode: 'copy', currentBranch: 'main' }, 'refs/tags/v1.0.0')).toBe(false);
    });

    test('returns false on detached HEAD (caller refuses earlier with different message)', () => {
      expect(detectRefChangesHead({ mode: 'link', currentBranch: 'HEAD' }, 'refs/heads/main')).toBe(false);
    });

    test('returns false when target ref equals refs/heads/<currentBranch>', () => {
      expect(detectRefChangesHead({ mode: 'link', currentBranch: 'main' }, 'refs/heads/main')).toBe(false);
    });

    test('returns false when target ref equals bare currentBranch name', () => {
      expect(detectRefChangesHead({ mode: 'link', currentBranch: 'feature-x' }, 'feature-x')).toBe(false);
    });

    test('returns true when target is a tag', () => {
      expect(detectRefChangesHead({ mode: 'link', currentBranch: 'main' }, 'refs/tags/v1.0.0')).toBe(true);
    });

    test('returns true when target is a different branch', () => {
      expect(detectRefChangesHead({ mode: 'link', currentBranch: 'main' }, 'refs/heads/dev')).toBe(true);
    });

    test('returns false when resolvedTargetRef is null', () => {
      expect(detectRefChangesHead({ mode: 'link', currentBranch: 'main' }, null)).toBe(false);
    });
  });

  describe('detectIsDowngrade', () => {
    test('returns false for branch channel (conservative)', () => {
      expect(detectIsDowngrade('branch', '1.0.0', 'main@abc1234', {})).toBe(false);
    });

    test('returns false for pinned with non-semver ref', () => {
      expect(detectIsDowngrade('pinned', '1.0.0', 'feature-x', { ref: 'feature-x' })).toBe(false);
    });

    test('returns true for tag channel from > to', () => {
      expect(detectIsDowngrade('tag', '1.2.0', 'v1.0.0', {})).toBe(true);
      expect(detectIsDowngrade('tag', '1.0.5', 'v1.0.0', {})).toBe(true);
      expect(detectIsDowngrade('tag', '2.0.0', 'v1.99.99', {})).toBe(true);
    });

    test('returns false for tag channel from <= to', () => {
      expect(detectIsDowngrade('tag', '0.9.0', 'v1.0.0', {})).toBe(false);
      expect(detectIsDowngrade('tag', '1.0.0', 'v1.0.0', {})).toBe(false);
    });

    test('returns true for pinned with semver ref smaller than fromVersion', () => {
      expect(detectIsDowngrade('pinned', '1.5.0', 'v1.0.0', { ref: 'v1.0.0' })).toBe(true);
      expect(detectIsDowngrade('pinned', '1.5.0', 'refs/tags/v1.0.0', { ref: 'refs/tags/v1.0.0' })).toBe(true);
    });

    test('returns false when fromVersion is unknown / unparseable', () => {
      expect(detectIsDowngrade('tag', 'unknown', 'v1.0.0', {})).toBe(false);
      expect(detectIsDowngrade('tag', '', 'v1.0.0', {})).toBe(false);
    });

    test('returns false when toLabel is unparseable', () => {
      expect(detectIsDowngrade('tag', '1.0.0', 'main@abc1234', {})).toBe(false);
    });
  });

  describe('extractTargetBranch', () => {
    test('returns null for non-branch channels', () => {
      expect(extractTargetBranch('refs/tags/v1.0.0', { currentBranch: 'main' }, 'tag')).toBeNull();
      expect(extractTargetBranch('v1.0.0', { currentBranch: 'main' }, 'pinned')).toBeNull();
    });

    test('extracts branch from refs/heads/<name>', () => {
      expect(extractTargetBranch('refs/heads/dev', { currentBranch: 'main' }, 'branch')).toBe('dev');
    });

    test('falls back to detected.currentBranch when ref is not a refs/heads/...', () => {
      expect(extractTargetBranch(null, { currentBranch: 'main' }, 'branch')).toBe('main');
    });

    test('returns null when current branch is HEAD or absent', () => {
      expect(extractTargetBranch(null, { currentBranch: 'HEAD' }, 'branch')).toBeNull();
      expect(extractTargetBranch(null, {}, 'branch')).toBeNull();
    });
  });

  describe('buildUpdatePlan integration', () => {
    test('happy path: link mode, branch channel, target == current branch', async () => {
      mockCheckCliVersion.mockResolvedValue(baseInfo());
      const plan = await buildUpdatePlan({
        detected: baseDetected(),
        effectiveChannel: 'branch',
        options: {},
        config: { updateChannel: 'auto' },
        state: null,
      });
      expect(plan.mode).toBe('link');
      expect(plan.sourceClone).toBe('/repo');
      expect(plan.currentBranch).toBe('main');
      expect(plan.workingTreeDirty).toBe(false);
      expect(plan.effectiveChannel).toBe('branch');
      expect(plan.channelReason).toBe('auto-link');
      expect(plan.resolvedTargetRef).toBe('refs/heads/main');
      expect(plan.targetBranch).toBe('main');
      expect(plan.needsUpdate).toBe(true);
      expect(plan.refChangesHead).toBe(false);
      expect(plan.isDowngrade).toBe(false);
      expect(plan.upstreamUrl).toBe('https://github.com/x/y.git');
    });

    test('link mode + tag channel triggers refChangesHead (and includes the 3 required fields)', async () => {
      mockCheckCliVersion.mockResolvedValue(baseInfo({
        configuredChannel: 'tag',
        effectiveChannel: 'tag',
        channelReason: 'explicit',
        toRef: 'refs/tags/v1.0.0',
        toLabel: 'v1.0.0',
        fromVersion: '0.9.0',
      }));
      const plan = await buildUpdatePlan({
        detected: baseDetected(),
        effectiveChannel: 'tag',
        options: {},
        config: { updateChannel: 'tag' },
        state: null,
      });
      expect(plan.refChangesHead).toBe(true);
      expect(plan.resolvedTargetRef).toBe('refs/tags/v1.0.0');
      expect(plan.currentBranch).toBe('main');
      expect(plan.channelReason).toBe('explicit');
    });

    test('link mode on feature branch + branch channel does NOT trigger refChangesHead', async () => {
      mockCheckCliVersion.mockResolvedValue(baseInfo({
        toRef: 'refs/heads/feature-x',
        toLabel: 'feature-x@bbbbbbb',
      }));
      const plan = await buildUpdatePlan({
        detected: baseDetected({ currentBranch: 'feature-x' }),
        effectiveChannel: 'branch',
        options: {},
        config: { updateChannel: 'auto' },
        state: null,
      });
      expect(plan.refChangesHead).toBe(false);
      expect(plan.targetBranch).toBe('feature-x');
    });

    test('downgrade flag set when --ref points to a smaller semver tag', async () => {
      mockCheckCliVersion.mockResolvedValue(baseInfo({
        configuredChannel: 'auto',
        effectiveChannel: 'pinned',
        channelReason: 'pinned',
        fromVersion: '1.5.0',
        toRef: 'refs/tags/v1.0.0',
        toLabel: 'v1.0.0',
      }));
      const plan = await buildUpdatePlan({
        detected: baseDetected({ mode: 'copy', sourceClone: null }),
        effectiveChannel: 'pinned',
        options: { ref: 'refs/tags/v1.0.0' },
        config: { updateChannel: 'auto' },
        state: null,
      });
      expect(plan.isDowngrade).toBe(true);
    });

    test('working tree dirty flag is propagated from detected', async () => {
      mockCheckCliVersion.mockResolvedValue(baseInfo());
      const plan = await buildUpdatePlan({
        detected: baseDetected({ workingTreeDirty: true }),
        effectiveChannel: 'branch',
        options: {},
        config: {},
        state: null,
      });
      expect(plan.workingTreeDirty).toBe(true);
    });

    test('skipSkills option flows into plan', async () => {
      mockCheckCliVersion.mockResolvedValue(baseInfo());
      const plan = await buildUpdatePlan({
        detected: baseDetected(),
        effectiveChannel: 'branch',
        options: { skipSkills: true },
        config: {},
        state: null,
      });
      expect(plan.skipSkills).toBe(true);
    });

    test('passes config + state through to checkCliVersion', async () => {
      mockCheckCliVersion.mockResolvedValue(baseInfo());
      const config = { updateChannel: 'tag' };
      const state = { commit: 'aaaaaaa', mode: 'link', sourceClone: '/repo' };
      await buildUpdatePlan({
        detected: baseDetected(),
        effectiveChannel: 'tag',
        options: { ref: 'v1.0.0' },
        config,
        state,
      });
      expect(mockCheckCliVersion).toHaveBeenCalledWith(
        baseDetected(),
        'tag',
        { ref: 'v1.0.0' },
        { config, state }
      );
    });
  });
});

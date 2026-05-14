const { reduceTaskEvent } = require('../../lib/ui/events');

describe('lib/ui/events', () => {
  it('start marks a task running and records order', () => {
    const state = reduceTaskEvent(null, {
      type: 'task:start',
      taskId: 'phase1',
      label: 'Phase 1',
      startedAt: 100
    });

    expect(state.order).toEqual(['phase1']);
    expect(state.tasks.phase1).toMatchObject({
      taskId: 'phase1',
      label: 'Phase 1',
      status: 'running',
      startedAt: 100
    });
  });

  it('finish success marks task success with duration', () => {
    const running = reduceTaskEvent(null, {
      type: 'task:start',
      taskId: 'phase1',
      label: 'Phase 1',
      startedAt: 100
    });
    const done = reduceTaskEvent(running, {
      type: 'task:finish',
      taskId: 'phase1',
      label: 'Phase 1',
      endedAt: 250,
      success: true
    });

    expect(done.tasks.phase1.status).toBe('success');
    expect(done.tasks.phase1.durationMs).toBe(150);
  });

  it('finish failure marks task failure', () => {
    const state = reduceTaskEvent(null, {
      type: 'task:finish',
      taskId: 'phase2',
      label: 'Phase 2',
      success: false,
      durationMs: 10
    });

    expect(state.tasks.phase2.status).toBe('failure');
    expect(state.order).toEqual(['phase2']);
  });

  it('duplicate start is idempotent for order', () => {
    const first = reduceTaskEvent(null, { type: 'task:start', taskId: 'phase1' });
    const second = reduceTaskEvent(first, { type: 'task:start', taskId: 'phase1' });

    expect(second.order).toEqual(['phase1']);
  });
});

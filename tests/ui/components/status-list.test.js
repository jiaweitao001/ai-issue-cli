const {
  statusIcon,
  formatStatusLine,
  splitHelpLines
} = require('../../../lib/ui/components/status-list');

describe('lib/ui/components/status-list', () => {
  it.each([
    ['ok', '✅'],
    ['fail', '❌'],
    ['warn', '⚠️ '],
    ['skip', '⏭ '],
    ['unknown', '•']
  ])('maps %s to %s', (status, expected) => {
    expect(statusIcon(status)).toBe(expected);
  });

  it('formats indexed status lines with optional detail', () => {
    expect(formatStatusLine(3, {
      status: 'warn',
      name: 'Service Reachability',
      detail: 'serviceUrl not configured'
    })).toBe('3. ⚠️  Service Reachability    [serviceUrl not configured]');
  });

  it('splits multiline help and drops empty lines', () => {
    expect(splitHelpLines('one\n\ntwo\r\nthree')).toEqual(['one', 'two', 'three']);
  });
});

const {
  filterTableRows,
  paginateTableRows,
  renderDetailLines,
  renderTablePage
} = require('../../../lib/ui/components/table');

describe('lib/ui/components/table', () => {
  it('paginates rows with safe bounds', () => {
    const rows = Array.from({ length: 50 }, (_v, i) => [`row-${i + 1}`]);

    expect(paginateTableRows(rows, 1, 20).rows[0]).toEqual(['row-1']);
    expect(paginateTableRows(rows, 2, 20).rows[0]).toEqual(['row-21']);
    expect(paginateTableRows(rows, 99, 20).page).toBe(3);
  });

  it('filters rows case-insensitively', () => {
    expect(filterTableRows([
      ['#1', 'Queued'],
      ['#2', 'Solved']
    ], 'sol')).toEqual([['#2', 'Solved']]);
  });

  it('renders a page with footer and detail pane lines', () => {
    const rendered = renderTablePage(
      [
        ['#1', 'queued', 'first'],
        ['#2', 'solved', 'second']
      ],
      [
        { header: 'Issue', width: 6 },
        { header: 'Status', width: 8 },
        { header: 'Title', width: 6 }
      ],
      { page: 1, pageSize: 1, detailIndex: 0 }
    );

    expect(rendered.lines).toEqual([
      'Issue  Status   Title ',
      '────── ──────── ──────',
      '#1     queued   first ',
      'Page 1/2  Rows 2'
    ]);
    expect(rendered.detailLines).toEqual([
      'Issue: #1',
      'Status: queued',
      'Title: first'
    ]);
  });
});

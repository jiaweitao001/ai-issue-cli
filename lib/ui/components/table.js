// @ts-check

/**
 * @typedef {{ header: string, width?: number }} TableColumn
 */

/**
 * @typedef {{ page?: number, pageSize?: number, filter?: string, detailIndex?: number, showFooter?: boolean }} TableOptions
 */

/**
 * @param {Array<Array<string|number|null|undefined>>} rows
 * @param {string} filter
 * @returns {Array<Array<string|number|null|undefined>>}
 */
function filterTableRows(rows, filter) {
  if (!Array.isArray(rows)) return [];
  const needle = String(filter || '').trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => (row || []).some((cell) => String(cell == null ? '' : cell).toLowerCase().includes(needle)));
}

/**
 * @param {Array<Array<string|number|null|undefined>>} rows
 * @param {number} page
 * @param {number} pageSize
 * @returns {{ rows: Array<Array<string|number|null|undefined>>, page: number, totalPages: number, totalRows: number }}
 */
function paginateTableRows(rows, page, pageSize) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 20;
  const totalPages = Math.max(1, Math.ceil(safeRows.length / safePageSize));
  const safePage = Math.min(Math.max(1, Math.floor(page || 1)), totalPages);
  const start = (safePage - 1) * safePageSize;
  return {
    rows: safeRows.slice(start, start + safePageSize),
    page: safePage,
    totalPages,
    totalRows: safeRows.length
  };
}

/**
 * @param {Array<Array<string|number|null|undefined>>} rows
 * @param {TableColumn[]} columns
 * @returns {number[]}
 */
function computeWidths(rows, columns) {
  return columns.map((column, index) => {
    const headerLen = String(column.header || '').length;
    let max = column.width || headerLen;
    for (const row of rows || []) {
      const len = String(row && row[index] != null ? row[index] : '').length;
      if (len > max) max = len;
    }
    return max;
  });
}

/**
 * @param {Array<string|number|null|undefined>} row
 * @param {TableColumn[]} columns
 * @returns {string[]}
 */
function renderDetailLines(row, columns) {
  if (!row || !Array.isArray(columns)) return [];
  return columns.map((column, index) => `${column.header || index}: ${row[index] == null ? '' : row[index]}`);
}

/**
 * @param {Array<Array<string|number|null|undefined>>} rows
 * @param {TableColumn[]} columns
 * @param {TableOptions} [options]
 * @returns {{ lines: string[], page: number, totalPages: number, totalRows: number, filteredRows: number, detailLines: string[] }}
 */
function renderTablePage(rows, columns, options) {
  const opts = options || {};
  const safeColumns = Array.isArray(columns) ? columns : [];
  if (safeColumns.length === 0) {
    return { lines: [], page: 1, totalPages: 1, totalRows: 0, filteredRows: 0, detailLines: [] };
  }

  const filtered = filterTableRows(rows, opts.filter || '');
  const page = paginateTableRows(filtered, opts.page || 1, opts.pageSize || 20);
  const widths = computeWidths(page.rows, safeColumns);
  const header = safeColumns.map((column, index) => String(column.header || '').padEnd(widths[index])).join(' ');
  const rule = widths.map((width) => '─'.repeat(width)).join(' ');
  const body = page.rows.map((row) => safeColumns
    .map((_column, index) => String(row && row[index] != null ? row[index] : '').padEnd(widths[index]))
    .join(' '));
  const footer = `Page ${page.page}/${page.totalPages}  Rows ${page.totalRows}${opts.filter ? `  Filter: ${opts.filter}` : ''}`;
  const detailIndex = typeof opts.detailIndex === 'number' ? opts.detailIndex : undefined;
  const detailLines = detailIndex == null ? [] : renderDetailLines(page.rows[detailIndex], safeColumns);

  return {
    lines: opts.showFooter === false ? [header, rule, ...body] : [header, rule, ...body, footer],
    page: page.page,
    totalPages: page.totalPages,
    totalRows: Array.isArray(rows) ? rows.length : 0,
    filteredRows: page.totalRows,
    detailLines
  };
}

module.exports = {
  filterTableRows,
  paginateTableRows,
  renderDetailLines,
  renderTablePage
};

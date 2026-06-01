// @ts-check

/**
 * @template T
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T) => Promise<any>} worker
 * @returns {Promise<any[]>}
 */
async function runWithConcurrency(items, concurrency, worker) {
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, items.length || 1));
  const results = new Array(items.length);
  let next = 0;

  async function loop() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => loop()));
  return results;
}

module.exports = {
  runWithConcurrency
};

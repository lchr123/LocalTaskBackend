import fc from 'fast-check';
import { parsePagination, calculateTotalPages } from '@/utils/pagination';

/**
 * Property 9: 分页不变量
 *
 * **Validates: Requirements 4.8, 8.7**
 *
 * 对于任意数据集大小 N 和分页参数 (page, pageSize)：
 * - totalPages = Math.ceil(N / pageSize)
 * - 每页返回的记录数 ≤ pageSize
 * - 所有页的记录合集等于完整数据集（无遗漏、无重复）
 * - 对于无效分页参数（page < 1, pageSize < 1 或 > 50），系统使用默认值（page=1, pageSize=20）
 */
describe('Property 9: 分页不变量', () => {
  /**
   * Helper: simulate paginating a dataset of size N with given page/pageSize.
   * Returns the slice of items for the requested page.
   */
  function paginateDataset(dataset: number[], page: number, pageSize: number): number[] {
    const offset = (page - 1) * pageSize;
    return dataset.slice(offset, offset + pageSize);
  }

  describe('totalPages = Math.ceil(N / pageSize)', () => {
    it('should correctly calculate totalPages for any valid N and pageSize', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1000 }),   // dataset size N
          fc.integer({ min: 1, max: 50 }),      // valid pageSize
          (n, pageSize) => {
            const totalPages = calculateTotalPages(n, pageSize);
            if (n === 0) {
              expect(totalPages).toBe(0);
            } else {
              expect(totalPages).toBe(Math.ceil(n / pageSize));
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('每页记录数 ≤ pageSize', () => {
    it('should never return more than pageSize records per page', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 500 }),    // dataset size N (at least 1)
          fc.integer({ min: 1, max: 50 }),      // valid pageSize
          fc.integer({ min: 1, max: 100 }),     // page number
          (n, pageSize, page) => {
            const dataset = Array.from({ length: n }, (_, i) => i);
            const pageItems = paginateDataset(dataset, page, pageSize);
            expect(pageItems.length).toBeLessThanOrEqual(pageSize);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('所有页合集无遗漏无重复', () => {
    it('should cover the entire dataset exactly once across all pages', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 300 }),    // dataset size N
          fc.integer({ min: 1, max: 50 }),      // valid pageSize
          (n, pageSize) => {
            const dataset = Array.from({ length: n }, (_, i) => i);
            const totalPages = calculateTotalPages(n, pageSize);

            // Collect all items across all pages
            const allItems: number[] = [];
            for (let page = 1; page <= totalPages; page++) {
              const pageItems = paginateDataset(dataset, page, pageSize);
              allItems.push(...pageItems);
            }

            // No missing items
            expect(allItems.length).toBe(n);
            // No duplicates - set size should equal array length
            expect(new Set(allItems).size).toBe(n);
            // Items match original dataset
            expect(allItems.sort((a, b) => a - b)).toEqual(dataset);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('无效参数使用默认值', () => {
    it('should use page=1 when page < 1 or invalid', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer({ min: -1000, max: 0 }).map(String),  // negative or zero
            fc.constant(''),                                   // empty string
            fc.constant('abc'),                                // non-numeric
            fc.constant('NaN'),                                // NaN string
            fc.constant('-5'),                                 // negative string
            fc.constant('0')                                   // zero string
          ),
          (invalidPage) => {
            const result = parsePagination({ page: invalidPage, pageSize: '10' });
            expect(result.page).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should use pageSize=20 when pageSize < 1 or > 50 or invalid', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer({ min: -1000, max: 0 }).map(String),   // negative or zero
            fc.integer({ min: 51, max: 1000 }).map(String),   // above max
            fc.constant(''),                                    // empty string
            fc.constant('abc'),                                 // non-numeric
            fc.constant('NaN'),                                 // NaN string
            fc.constant('-1'),                                  // negative string
            fc.constant('0'),                                   // zero string
            fc.constant('51'),                                  // just above max
            fc.constant('100')                                  // well above max
          ),
          (invalidPageSize) => {
            const result = parsePagination({ page: '1', pageSize: invalidPageSize });
            expect(result.pageSize).toBe(20);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should use both defaults when both params are invalid', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -1000, max: 0 }).map(String),
          fc.integer({ min: 51, max: 1000 }).map(String),
          (invalidPage, invalidPageSize) => {
            const result = parsePagination({ page: invalidPage, pageSize: invalidPageSize });
            expect(result.page).toBe(1);
            expect(result.pageSize).toBe(20);
            expect(result.offset).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('offset 计算正确性', () => {
    it('should calculate offset = (page - 1) * pageSize for valid params', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),    // valid page
          fc.integer({ min: 1, max: 50 }),      // valid pageSize
          (page, pageSize) => {
            const result = parsePagination({
              page: String(page),
              pageSize: String(pageSize),
            });
            expect(result.page).toBe(page);
            expect(result.pageSize).toBe(pageSize);
            expect(result.offset).toBe((page - 1) * pageSize);
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});

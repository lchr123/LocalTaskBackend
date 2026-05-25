export interface PaginationParams {
  page: number;
  pageSize: number;
  offset: number;
}

/**
 * Parse and validate pagination parameters from query string.
 *
 * - page: minimum 1, default 1
 * - pageSize: minimum 1, maximum 50, default 20
 * - offset: calculated as (page - 1) * pageSize
 *
 * Invalid or out-of-range values are clamped to defaults.
 */
export function parsePagination(query: { page?: string; pageSize?: string }): PaginationParams {
  let page = parseInt(query.page || '', 10);
  let pageSize = parseInt(query.pageSize || '', 10);

  // Apply defaults for NaN or out-of-range values
  if (isNaN(page) || page < 1) {
    page = 1;
  }

  if (isNaN(pageSize) || pageSize < 1 || pageSize > 50) {
    pageSize = 20;
  }

  const offset = (page - 1) * pageSize;

  return { page, pageSize, offset };
}

/**
 * Calculate total number of pages from totalCount and pageSize.
 * Returns at least 1 page even for empty datasets.
 */
export function calculateTotalPages(totalCount: number, pageSize: number): number {
  if (totalCount <= 0) {
    return 0;
  }
  return Math.ceil(totalCount / pageSize);
}

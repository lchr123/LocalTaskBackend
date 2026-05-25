import { parsePagination, calculateTotalPages } from '../../../src/utils/pagination';

describe('parsePagination', () => {
  it('should return defaults when no params provided', () => {
    const result = parsePagination({});
    expect(result).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });

  it('should parse valid page and pageSize', () => {
    const result = parsePagination({ page: '3', pageSize: '10' });
    expect(result).toEqual({ page: 3, pageSize: 10, offset: 20 });
  });

  it('should use default page=1 when page is less than 1', () => {
    const result = parsePagination({ page: '0', pageSize: '10' });
    expect(result).toEqual({ page: 1, pageSize: 10, offset: 0 });
  });

  it('should use default page=1 when page is negative', () => {
    const result = parsePagination({ page: '-5', pageSize: '10' });
    expect(result).toEqual({ page: 1, pageSize: 10, offset: 0 });
  });

  it('should use default pageSize=20 when pageSize is less than 1', () => {
    const result = parsePagination({ page: '1', pageSize: '0' });
    expect(result).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });

  it('should use default pageSize=20 when pageSize exceeds 50', () => {
    const result = parsePagination({ page: '1', pageSize: '100' });
    expect(result).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });

  it('should use default when page is not a number', () => {
    const result = parsePagination({ page: 'abc', pageSize: '10' });
    expect(result).toEqual({ page: 1, pageSize: 10, offset: 0 });
  });

  it('should use default when pageSize is not a number', () => {
    const result = parsePagination({ page: '2', pageSize: 'xyz' });
    expect(result).toEqual({ page: 2, pageSize: 20, offset: 20 });
  });

  it('should calculate correct offset for page 2 with pageSize 20', () => {
    const result = parsePagination({ page: '2', pageSize: '20' });
    expect(result.offset).toBe(20);
  });

  it('should accept pageSize at boundary value 50', () => {
    const result = parsePagination({ page: '1', pageSize: '50' });
    expect(result).toEqual({ page: 1, pageSize: 50, offset: 0 });
  });

  it('should accept pageSize at boundary value 1', () => {
    const result = parsePagination({ page: '1', pageSize: '1' });
    expect(result).toEqual({ page: 1, pageSize: 1, offset: 0 });
  });
});

describe('calculateTotalPages', () => {
  it('should return 0 for empty dataset', () => {
    expect(calculateTotalPages(0, 20)).toBe(0);
  });

  it('should return 1 when totalCount equals pageSize', () => {
    expect(calculateTotalPages(20, 20)).toBe(1);
  });

  it('should return 1 when totalCount is less than pageSize', () => {
    expect(calculateTotalPages(5, 20)).toBe(1);
  });

  it('should round up for partial pages', () => {
    expect(calculateTotalPages(21, 20)).toBe(2);
  });

  it('should calculate correctly for large datasets', () => {
    expect(calculateTotalPages(100, 20)).toBe(5);
    expect(calculateTotalPages(101, 20)).toBe(6);
  });

  it('should return 0 for negative totalCount', () => {
    expect(calculateTotalPages(-1, 20)).toBe(0);
  });
});

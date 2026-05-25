import { logger, requestLogger } from '../../../src/utils/logger';
import { Request, Response } from 'express';

describe('logger', () => {
  let writeSpy: jest.SpyInstance;

  beforeEach(() => {
    writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('should output JSON with timestamp, level, and message for info', () => {
    logger.info('test message');
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(writeSpy.mock.calls[0][0].replace('\n', ''));
    expect(output.level).toBe('info');
    expect(output.message).toBe('test message');
    expect(output.timestamp).toBeDefined();
    expect(new Date(output.timestamp).toISOString()).toBe(output.timestamp);
  });

  it('should output JSON with metadata', () => {
    logger.info('request', { requestId: '123', method: 'GET' });
    const output = JSON.parse(writeSpy.mock.calls[0][0].replace('\n', ''));
    expect(output.requestId).toBe('123');
    expect(output.method).toBe('GET');
  });

  it('should output warn level', () => {
    logger.warn('warning message');
    const output = JSON.parse(writeSpy.mock.calls[0][0].replace('\n', ''));
    expect(output.level).toBe('warn');
  });

  it('should output error level', () => {
    logger.error('error message');
    const output = JSON.parse(writeSpy.mock.calls[0][0].replace('\n', ''));
    expect(output.level).toBe('error');
  });

  it('should output debug level in non-production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    logger.debug('debug message');
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(writeSpy.mock.calls[0][0].replace('\n', ''));
    expect(output.level).toBe('debug');
    process.env.NODE_ENV = originalEnv;
  });

  it('should not output debug level in production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    logger.debug('debug message');
    expect(writeSpy).not.toHaveBeenCalled();
    process.env.NODE_ENV = originalEnv;
  });
});

describe('requestLogger middleware', () => {
  let writeSpy: jest.SpyInstance;

  beforeEach(() => {
    writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('should set X-Request-Id header on response', () => {
    const req = {
      headers: {},
      method: 'GET',
      originalUrl: '/tasks',
    } as unknown as Request;

    const setHeaderMock = jest.fn();
    const onMock = jest.fn();
    const res = {
      setHeader: setHeaderMock,
      on: onMock,
      statusCode: 200,
    } as unknown as Response;

    const next = jest.fn();

    requestLogger(req, res, next);

    expect(setHeaderMock).toHaveBeenCalledWith('X-Request-Id', expect.any(String));
    expect(next).toHaveBeenCalled();
  });

  it('should reuse existing X-Request-Id from request headers', () => {
    const req = {
      headers: { 'x-request-id': 'existing-id-123' },
      method: 'GET',
      originalUrl: '/tasks',
    } as unknown as Request;

    const setHeaderMock = jest.fn();
    const onMock = jest.fn();
    const res = {
      setHeader: setHeaderMock,
      on: onMock,
      statusCode: 200,
    } as unknown as Response;

    const next = jest.fn();

    requestLogger(req, res, next);

    expect(setHeaderMock).toHaveBeenCalledWith('X-Request-Id', 'existing-id-123');
  });

  it('should log request details on response finish', () => {
    const req = {
      headers: { 'x-request-id': 'test-req-id' },
      method: 'POST',
      originalUrl: '/tasks',
    } as unknown as Request;

    let finishCallback: () => void = () => {};
    const res = {
      setHeader: jest.fn(),
      on: jest.fn((event: string, cb: () => void) => {
        if (event === 'finish') finishCallback = cb;
      }),
      statusCode: 201,
    } as unknown as Response;

    const next = jest.fn();

    requestLogger(req, res, next);
    finishCallback();

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(writeSpy.mock.calls[0][0].replace('\n', ''));
    expect(output.requestId).toBe('test-req-id');
    expect(output.method).toBe('POST');
    expect(output.path).toBe('/tasks');
    expect(output.statusCode).toBe(201);
    expect(output.responseTimeMs).toBeGreaterThanOrEqual(0);
  });
});

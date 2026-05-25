import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../../../src/middleware/auth';
import { AuthenticatedRequest } from '../../../src/types/common';

// Mock dependencies
jest.mock('../../../src/config/cognito', () => ({
  jwksRsaClient: {
    getSigningKey: jest.fn(),
  },
}));

jest.mock('../../../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../../../src/config', () => ({
  config: {
    cognito: {
      userPoolId: 'ap-northeast-1_TestPool',
      region: 'ap-northeast-1',
      issuer: 'https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_TestPool',
    },
  },
}));

import { jwksRsaClient } from '../../../src/config/cognito';
import { query } from '../../../src/config/database';

const mockGetSigningKey = jwksRsaClient.getSigningKey as jest.Mock;
const mockQuery = query as jest.Mock;

// Test RSA key pair for signing JWTs
const crypto = require('crypto');
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function createMockRequest(authHeader?: string): AuthenticatedRequest {
  return {
    headers: {
      authorization: authHeader,
    },
  } as unknown as AuthenticatedRequest;
}

function createMockResponse(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function createMockNext(): NextFunction {
  return jest.fn();
}

function createValidToken(payload: Record<string, unknown> = {}): string {
  const defaultPayload = {
    sub: 'test-cognito-sub-123',
    email: 'test@example.com',
    phone_number: '+81901234567',
    iss: 'https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_TestPool',
    token_use: 'id',
    ...payload,
  };
  return jwt.sign(defaultPayload, privateKey, {
    algorithm: 'RS256',
    expiresIn: '1h',
    header: { alg: 'RS256', kid: 'test-kid-123' },
  });
}

describe('authMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Setup default mock for getSigningKey
    mockGetSigningKey.mockImplementation((_kid: string, callback: Function) => {
      callback(null, { getPublicKey: () => publicKey });
    });
  });

  describe('Token extraction', () => {
    it('should return 401 when Authorization header is missing', async () => {
      const req = createMockRequest(undefined);
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        message: '认证令牌缺失或格式无效',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when Authorization header has no Bearer prefix', async () => {
      const req = createMockRequest('Basic some-token');
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        message: '认证令牌缺失或格式无效',
      });
    });

    it('should return 401 when Bearer token is empty', async () => {
      const req = createMockRequest('Bearer ');
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        message: '认证令牌缺失或格式无效',
      });
    });

    it('should return 401 when Authorization header has extra parts', async () => {
      const req = createMockRequest('Bearer token extra');
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        message: '认证令牌缺失或格式无效',
      });
    });
  });

  describe('Token verification', () => {
    it('should return 401 with token_expired when token signature is invalid', async () => {
      // Sign with a different key
      const otherKey = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      const badToken = jwt.sign(
        { sub: 'test', iss: 'https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_TestPool' },
        otherKey.privateKey,
        { algorithm: 'RS256', header: { alg: 'RS256', kid: 'test-kid-123' } }
      );

      const req = createMockRequest(`Bearer ${badToken}`);
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'token_expired',
        message: '认证令牌已过期，请重新登录',
      });
    });

    it('should return 401 with token_expired when token is expired', async () => {
      const expiredToken = jwt.sign(
        {
          sub: 'test-sub',
          email: 'test@example.com',
          iss: 'https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_TestPool',
        },
        privateKey,
        { algorithm: 'RS256', expiresIn: '-1h', header: { alg: 'RS256', kid: 'test-kid-123' } }
      );

      const req = createMockRequest(`Bearer ${expiredToken}`);
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'token_expired',
        message: '认证令牌已过期，请重新登录',
      });
    });

    it('should return 401 with token_expired when issuer does not match', async () => {
      const wrongIssuerToken = jwt.sign(
        {
          sub: 'test-sub',
          email: 'test@example.com',
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_WrongPool',
        },
        privateKey,
        { algorithm: 'RS256', expiresIn: '1h', header: { alg: 'RS256', kid: 'test-kid-123' } }
      );

      const req = createMockRequest(`Bearer ${wrongIssuerToken}`);
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'token_expired',
        message: '认证令牌已过期，请重新登录',
      });
    });

    it('should return 401 with token_expired when JWKS key retrieval fails', async () => {
      mockGetSigningKey.mockImplementation((_kid: string, callback: Function) => {
        callback(new Error('Key not found'));
      });

      const token = createValidToken();
      const req = createMockRequest(`Bearer ${token}`);
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'token_expired',
        message: '认证令牌已过期，请重新登录',
      });
    });
  });

  describe('User lookup and creation', () => {
    it('should find existing user and inject req.user', async () => {
      const token = createValidToken();
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'existing-user-uuid' }],
      });

      const req = createMockRequest(`Bearer ${token}`);
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toEqual({
        sub: 'test-cognito-sub-123',
        email: 'test@example.com',
        phone: '+81901234567',
        userId: 'existing-user-uuid',
      });
      // Should only query once (SELECT)
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT id FROM users WHERE cognito_sub = $1',
        ['test-cognito-sub-123']
      );
    });

    it('should create new user when cognito_sub does not exist', async () => {
      const token = createValidToken();
      // First query: user not found
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // Second query: INSERT returns new user
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'new-user-uuid' }],
      });

      const req = createMockRequest(`Bearer ${token}`);
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toEqual({
        sub: 'test-cognito-sub-123',
        email: 'test@example.com',
        phone: '+81901234567',
        userId: 'new-user-uuid',
      });
      expect(mockQuery).toHaveBeenCalledTimes(2);
      // Second call should be the INSERT
      expect(mockQuery.mock.calls[1][0]).toContain('INSERT INTO users');
      expect(mockQuery.mock.calls[1][1]).toEqual([
        'test-cognito-sub-123',
        'test@example.com',
        '+81901234567',
      ]);
    });

    it('should handle user without phone number', async () => {
      const token = createValidToken({ phone_number: undefined });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'new-user-uuid' }],
      });

      const req = createMockRequest(`Bearer ${token}`);
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user?.phone).toBeUndefined();
      // INSERT should pass null for phone
      expect(mockQuery.mock.calls[1][1]).toEqual([
        'test-cognito-sub-123',
        'test@example.com',
        null,
      ]);
    });
  });

  describe('Error handling', () => {
    it('should pass database errors to next()', async () => {
      const token = createValidToken();
      const dbError = new Error('Connection refused');
      mockQuery.mockRejectedValueOnce(dbError);

      const req = createMockRequest(`Bearer ${token}`);
      const res = createMockResponse();
      const next = createMockNext();

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalledWith(dbError);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});

import jwksClient from 'jwks-rsa';
import { config } from './index';

export const jwksRsaClient = jwksClient({
  jwksUri: config.cognito.jwksUri,
  cache: true,
  cacheMaxAge: 3600000, // 1 hour
  rateLimit: true,
});

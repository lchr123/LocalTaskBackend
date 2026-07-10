export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  database: {
    url: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/localtask',
    maxConnections: 20,
    idleTimeoutMs: 30000,
  },
  cognito: {
    userPoolId: process.env.COGNITO_USER_POOL_ID || '',
    clientId: process.env.COGNITO_CLIENT_ID || '',
    region: process.env.COGNITO_REGION || 'ap-northeast-1',
    get issuer(): string {
      return `https://cognito-idp.${this.region}.amazonaws.com/${this.userPoolId}`;
    },
    get jwksUri(): string {
      return `${this.issuer}/.well-known/jwks.json`;
    },
  },
  s3: {
    bucket: process.env.AWS_S3_BUCKET || '',
    region: process.env.AWS_S3_REGION || 'ap-northeast-1',
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    fromEmail: process.env.FROM_EMAIL || 'no-reply@locallyhelper.com',
  },
  digest: {
    secret: process.env.DIGEST_SECRET || '',
    unsubscribeSecret: process.env.UNSUBSCRIBE_SECRET || '',
    /** App site root, e.g. https://locallyhelper.com — used for the "view in app" button */
    appUrl: (process.env.APP_PUBLIC_URL || '').replace(/\/$/, ''),
    /** Backend API base, e.g. https://locallyhelper.com/api — used for the unsubscribe link */
    apiUrl: (process.env.API_PUBLIC_URL || '').replace(/\/$/, ''),
  },
  unreadReminder: {
    /** Only remind about sessions whose last message is at least this stale. */
    staleMinutes: parseInt(process.env.UNREAD_REMINDER_STALE_MINUTES || '30', 10),
    /** Max recipients claimed per scan; keeps sends well under the provider's daily quota. */
    dailyCap: parseInt(process.env.UNREAD_REMINDER_DAILY_CAP || '80', 10),
  },
  rateLimit: {
    auth: parseInt(process.env.RATE_LIMIT_AUTH || '10', 10),
    api: parseInt(process.env.RATE_LIMIT_API || '60', 10),
    upload: parseInt(process.env.RATE_LIMIT_UPLOAD || '5', 10),
  },
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:19006',
  },
};

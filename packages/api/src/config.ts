import { randomBytes } from 'node:crypto';

const DEFAULT_JWT_SECRET = 'blather-dev-secret-change-in-production';
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_JWT_SECRET)) {
  console.error('[FATAL] JWT_SECRET must be set in production. Exiting.');
  process.exit(1);
}

export const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

if (JWT_SECRET === DEFAULT_JWT_SECRET) {
  console.warn('[WARN] Using default JWT_SECRET — set JWT_SECRET env var in production');
}

export function generateJwtSecret(): string {
  return randomBytes(32).toString('hex');
}


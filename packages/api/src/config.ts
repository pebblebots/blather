const DEFAULT_JWT_SECRET = 'blather-dev-secret-change-in-production';

export const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

if (JWT_SECRET === DEFAULT_JWT_SECRET) {
  console.warn('[WARN] Using default JWT_SECRET — set JWT_SECRET env var in production');
}

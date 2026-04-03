import { randomBytes } from 'node:crypto';
import { loadSecrets, type AppConfig } from './secrets.js';

// Global config loaded once at startup
let appConfig: AppConfig | null = null;

/**
 * Initialize configuration - call this once at application startup
 */
export async function initializeConfig(): Promise<AppConfig> {
  if (appConfig) {
    return appConfig;
  }
  
  appConfig = await loadSecrets();
  return appConfig;
}

/**
 * Get the current configuration (must call initializeConfig first)
 */
export function getConfig(): AppConfig {
  if (!appConfig) {
    throw new Error('Configuration not initialized. Call initializeConfig() first.');
  }
  return appConfig;
}

// Backward compatibility - remove this once all code is updated
export const JWT_SECRET = process.env.JWT_SECRET || 'blather-dev-secret-change-in-production';

export function generateJwtSecret(): string {
  return randomBytes(32).toString('hex');
}


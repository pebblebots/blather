import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

/**
 * GCP Secret Manager client for secure credential management
 */
class SecretManager {
  private client: SecretManagerServiceClient | null = null;
  private projectId: string;
  private enabled: boolean;

  constructor() {
    // Check if we're in a GCP environment or have credentials configured
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '';
    this.enabled = !!(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_PROJECT);
    
    if (this.enabled) {
      try {
        this.client = new SecretManagerServiceClient();
        console.log('[INFO] GCP Secret Manager initialized for project:', this.projectId);
      } catch (error) {
        console.warn('[WARN] Failed to initialize GCP Secret Manager:', error);
        this.enabled = false;
      }
    } else {
      console.log('[INFO] GCP Secret Manager disabled - using environment variables only');
    }
  }

  /**
   * Get a secret from GCP Secret Manager
   */
  async getSecret(secretName: string): Promise<string> {
    if (!this.enabled || !this.client) {
      throw new Error('Secret Manager not available');
    }

    try {
      const name = `projects/${this.projectId}/secrets/${secretName}/versions/latest`;
      const [version] = await this.client.accessSecretVersion({ name });
      const payload = version.payload?.data?.toString();
      
      if (!payload) {
        throw new Error(`Secret ${secretName} has no data`);
      }
      
      return payload;
    } catch (error) {
      console.error(`Failed to access secret ${secretName}:`, error);
      throw error;
    }
  }

  /**
   * Get secret from GCP Secret Manager with environment variable fallback
   * This allows gradual migration to Secret Manager
   */
  async getSecretOrFallback(secretName: string, fallbackEnvVar: string): Promise<string> {
    // First try environment variable for immediate availability
    const envValue = process.env[fallbackEnvVar];
    if (envValue) {
      return envValue;
    }

    // Then try Secret Manager if available
    if (this.enabled) {
      try {
        return await this.getSecret(secretName);
      } catch (error) {
        console.warn(`Failed to get secret ${secretName}, no fallback available:`, error);
      }
    }

    // Return empty string if neither source has the secret
    return '';
  }

  /**
   * Get secret with strict requirement (throws if not found)
   */
  async getRequiredSecret(secretName: string, fallbackEnvVar: string): Promise<string> {
    const value = await this.getSecretOrFallback(secretName, fallbackEnvVar);
    if (!value) {
      throw new Error(`Required secret ${secretName} (env: ${fallbackEnvVar}) is not available`);
    }
    return value;
  }

  /**
   * Check if Secret Manager is available and configured
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance
export const secretManager = new SecretManager();

/**
 * Load application configuration with secret management
 */
export async function loadSecrets() {
  try {
    const config = {
      // JWT secret (required in production)
      jwtSecret: await secretManager.getSecretOrFallback('jwt-secret', 'JWT_SECRET'),
      
      // Email service
      resendApiKey: await secretManager.getSecretOrFallback('resend-api-key', 'RESEND_API_KEY'),
      resendFrom: process.env.RESEND_FROM || 'Blather <noreply@localhost>',
      
      // OAuth (for future integrations)
      oauthClientId: await secretManager.getSecretOrFallback('oauth-client-id', 'OAUTH_CLIENT_ID'),
      oauthClientSecret: await secretManager.getSecretOrFallback('oauth-client-secret', 'OAUTH_CLIENT_SECRET'),
      
      // TTS services
      openaiApiKey: await secretManager.getSecretOrFallback('openai-api-key', 'OPENAI_API_KEY'),
      elevenlabsApiKey: await secretManager.getSecretOrFallback('elevenlabs-api-key', 'ELEVENLABS_API_KEY'),
      
      // Database (keep using env vars for now as it's less sensitive)
      databaseUrl: process.env.DATABASE_URL || '',
      
      // Other config
      agentEmailDomain: process.env.AGENT_EMAIL_DOMAIN || 'system.blather',
      allowedEmails: process.env.BLA_ALLOWED_EMAILS || '',
      nodeEnv: process.env.NODE_ENV || 'development',
    };

    // Validate required secrets in production
    const isProduction = config.nodeEnv === 'production';
    if (isProduction) {
      if (!config.jwtSecret || config.jwtSecret === 'blather-dev-secret-change-in-production') {
        throw new Error('JWT_SECRET must be set in production');
      }
      if (!config.databaseUrl) {
        throw new Error('DATABASE_URL must be set');
      }
    }

    // Provide default JWT secret in development
    if (!config.jwtSecret && !isProduction) {
      config.jwtSecret = 'blather-dev-secret-change-in-production';
      console.warn('[WARN] Using default JWT_SECRET in development');
    }

    return config;
  } catch (error) {
    console.error('[FATAL] Failed to load configuration:', error);
    throw error;
  }
}

export type AppConfig = Awaited<ReturnType<typeof loadSecrets>>;
# GCP Secret Manager Setup for Blather

This document outlines the setup and migration to Google Cloud Secret Manager for secure credential management in the Blather platform.

## Overview

GCP Secret Manager provides a centralized, secure way to store and manage sensitive configuration like API keys, OAuth secrets, and database passwords. This eliminates the need for manual credential hand-offs and enables self-service secret management.

## Prerequisites

- GCP project with billing enabled
- `gcloud` CLI installed and authenticated
- Project admin or Secret Manager admin permissions

## Setup Steps

### 1. Enable the Secret Manager API

```bash
gcloud services enable secretmanager.googleapis.com
```

### 2. Set up IAM permissions

Create a service account for the application:
```bash
gcloud iam service-accounts create blather-secrets \
    --display-name="Blather Secret Manager Service Account" \
    --description="Service account for accessing secrets in Blather application"
```

Grant necessary permissions:
```bash
# Allow the service account to access secrets
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
    --member="serviceAccount:blather-secrets@$(gcloud config get-value project).iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"

# Allow admins to manage secrets
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
    --member="user:boss@example.com" \
    --role="roles/secretmanager.admin"
```

### 3. Generate service account key

```bash
gcloud iam service-accounts keys create ./blather-secrets-key.json \
    --iam-account=blather-secrets@$(gcloud config get-value project).iam.gserviceaccount.com
```

Store this key securely and reference it in your deployment configuration.

## Secret Migration

### Existing Secrets to Migrate

1. **Resend API Key** (`RESEND_API_KEY`)
2. **OAuth Client ID and Secret** (for third-party integrations)
3. **Database passwords** (if using external databases)
4. **JWT signing secrets** (`JWT_SECRET`)
5. **OpenAI/ElevenLabs API keys** (for TTS)

### Migration Script

Create secrets in GCP Secret Manager:

```bash
#!/bin/bash

PROJECT_ID=$(gcloud config get-value project)

# Resend API key
echo -n "YOUR_RESEND_KEY" | gcloud secrets create resend-api-key --data-file=-

# JWT Secret
echo -n "$(openssl rand -base64 32)" | gcloud secrets create jwt-secret --data-file=-

# OAuth secrets (example)
echo -n "YOUR_OAUTH_CLIENT_ID" | gcloud secrets create oauth-client-id --data-file=-
echo -n "YOUR_OAUTH_CLIENT_SECRET" | gcloud secrets create oauth-client-secret --data-file=-

# TTS API keys
echo -n "YOUR_OPENAI_KEY" | gcloud secrets create openai-api-key --data-file=-
echo -n "YOUR_ELEVENLABS_KEY" | gcloud secrets create elevenlabs-api-key --data-file=-
```

## Application Integration

### Environment Setup

Set the service account key path:
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/blather-secrets-key.json"
```

### Code Integration

Add to `packages/api/src/config.ts`:

```typescript
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

class SecretManager {
  private client: SecretManagerServiceClient;
  private projectId: string;

  constructor() {
    this.client = new SecretManagerServiceClient();
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT || '';
  }

  async getSecret(secretName: string): Promise<string> {
    try {
      const name = `projects/${this.projectId}/secrets/${secretName}/versions/latest`;
      const [version] = await this.client.accessSecretVersion({ name });
      return version.payload?.data?.toString() || '';
    } catch (error) {
      console.error(`Failed to access secret ${secretName}:`, error);
      throw error;
    }
  }

  async getSecretOrFallback(secretName: string, fallbackEnvVar: string): Promise<string> {
    try {
      return await this.getSecret(secretName);
    } catch {
      return process.env[fallbackEnvVar] || '';
    }
  }
}

export const secretManager = new SecretManager();

// Usage in config loading
export async function loadConfig() {
  return {
    resendApiKey: await secretManager.getSecretOrFallback('resend-api-key', 'RESEND_API_KEY'),
    jwtSecret: await secretManager.getSecretOrFallback('jwt-secret', 'JWT_SECRET'),
    openaiApiKey: await secretManager.getSecretOrFallback('openai-api-key', 'OPENAI_API_KEY'),
    // ... other config
  };
}
```

### Package Dependencies

Add to `packages/api/package.json`:
```json
{
  "dependencies": {
    "@google-cloud/secret-manager": "^5.0.0"
  }
}
```

## Self-Service Workflow

### Adding New Secrets

1. **Create the secret:**
   ```bash
   echo -n "NEW_SECRET_VALUE" | gcloud secrets create new-service-api-key --data-file=-
   ```

2. **Update the application code** to reference the new secret

3. **Deploy** the updated application

### Rotating Secrets

1. **Create new version:**
   ```bash
   echo -n "NEW_SECRET_VALUE" | gcloud secrets versions add secret-name --data-file=-
   ```

2. **Application automatically uses latest version** (no restart needed)

3. **Clean up old versions** after validation:
   ```bash
   gcloud secrets versions destroy VERSION_NUMBER --secret=secret-name
   ```

## Security Best Practices

1. **Principle of least privilege** - Only grant necessary permissions
2. **Audit access** - Enable Cloud Audit Logs for secret access
3. **Rotate secrets regularly** - Set up automated rotation where possible
4. **Monitor usage** - Set up alerts for unexpected secret access patterns
5. **Use separate secrets per environment** (dev/staging/prod)

## Monitoring and Alerts

Set up Cloud Monitoring alerts for:
- Failed secret access attempts
- Unusual access patterns
- Secret version changes

Example alert policy:
```bash
gcloud alpha monitoring policies create \
    --policy-from-file=secret-access-alerts.yaml
```

## Troubleshooting

### Common Issues

1. **Permission denied errors:**
   - Verify service account has `secretmanager.secretAccessor` role
   - Check that `GOOGLE_APPLICATION_CREDENTIALS` is set correctly

2. **Secret not found:**
   - Verify secret exists: `gcloud secrets list`
   - Check project ID is correct

3. **Authentication failures:**
   - Ensure service account key is valid and accessible
   - Check IAM bindings: `gcloud projects get-iam-policy PROJECT_ID`

### Debugging Commands

```bash
# List all secrets
gcloud secrets list

# View secret metadata
gcloud secrets describe SECRET_NAME

# Test access with service account
gcloud auth activate-service-account --key-file=blather-secrets-key.json
gcloud secrets versions access latest --secret=SECRET_NAME
```

## Migration Checklist

- [ ] Enable Secret Manager API
- [ ] Create service account and IAM bindings
- [ ] Generate and securely store service account key
- [ ] Migrate existing secrets to Secret Manager
- [ ] Update application code to use Secret Manager client
- [ ] Test secret access in development environment
- [ ] Deploy to staging and validate
- [ ] Deploy to production
- [ ] Remove old environment variables
- [ ] Document new secret management process
- [ ] Set up monitoring and alerts

## Cost Considerations

Secret Manager pricing:
- $0.06 per 10,000 API calls
- $0.03 per active secret version per month

For typical usage, costs should be minimal (< $5/month for most applications).
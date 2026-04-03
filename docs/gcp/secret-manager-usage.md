# Secret Manager Usage Guide

This guide covers day-to-day usage of GCP Secret Manager for Blather developers and operators.

## Quick Commands

### List all secrets
```bash
gcloud secrets list --filter="labels.app=blather"
```

### View secret metadata
```bash
gcloud secrets describe SECRET_NAME
```

### Access a secret value
```bash
gcloud secrets versions access latest --secret=SECRET_NAME
```

### Create a new secret
```bash
echo -n "SECRET_VALUE" | gcloud secrets create SECRET_NAME --data-file=-
```

### Update an existing secret
```bash
echo -n "NEW_VALUE" | gcloud secrets versions add SECRET_NAME --data-file=-
```

### Delete a secret (be careful!)
```bash
gcloud secrets delete SECRET_NAME
```

## Common Workflows

### Adding a New Integration Secret

1. **Create the secret:**
   ```bash
   echo -n "your-api-key-here" | gcloud secrets create new-service-api-key \
       --data-file=- \
       --labels=app=blather,service=new-service
   ```

2. **Update the application code** in `packages/api/src/secrets.ts`:
   ```typescript
   // Add to loadSecrets function
   newServiceApiKey: await secretManager.getSecretOrFallback('new-service-api-key', 'NEW_SERVICE_API_KEY'),
   ```

3. **Use in your code:**
   ```typescript
   import { getConfig } from './config.js';
   
   const config = getConfig();
   const apiKey = config.newServiceApiKey;
   ```

4. **Test and deploy**

### Rotating an API Key

1. **Create new version with rotated key:**
   ```bash
   echo -n "new-rotated-key" | gcloud secrets versions add SECRET_NAME --data-file=-
   ```

2. **Application automatically picks up the new version** (no restart needed)

3. **Test that everything works**

4. **Disable old version** (optional, for audit purposes):
   ```bash
   gcloud secrets versions disable VERSION_NUMBER --secret=SECRET_NAME
   ```

5. **Clean up old version** after you're confident:
   ```bash
   gcloud secrets versions destroy VERSION_NUMBER --secret=SECRET_NAME
   ```

### Emergency Secret Rollback

If a new secret version breaks something:

1. **Check version history:**
   ```bash
   gcloud secrets versions list SECRET_NAME
   ```

2. **Disable the problematic version:**
   ```bash
   gcloud secrets versions disable LATEST_VERSION --secret=SECRET_NAME
   ```

3. **Enable the previous working version:**
   ```bash
   gcloud secrets versions enable PREVIOUS_VERSION --secret=SECRET_NAME
   ```

Note: The application will automatically use the latest enabled version.

## Environment-Specific Secrets

For different environments (dev/staging/prod), use prefixed secret names:

```bash
# Development
gcloud secrets create dev-stripe-api-key --data-file=-

# Staging  
gcloud secrets create staging-stripe-api-key --data-file=-

# Production
gcloud secrets create prod-stripe-api-key --data-file=-
```

Then in your application code:
```typescript
const env = process.env.NODE_ENV || 'development';
const secretName = `${env}-stripe-api-key`;
const apiKey = await secretManager.getSecret(secretName);
```

## Debugging

### Check if Secret Manager is working
```bash
# Test with a simple secret
echo -n "test-value" | gcloud secrets create debug-test --data-file=-
gcloud secrets versions access latest --secret=debug-test
gcloud secrets delete debug-test
```

### Common Error Messages

**"Permission denied"**
```bash
# Check your authentication
gcloud auth list
# Make sure you have the right role
gcloud projects get-iam-policy PROJECT_ID
```

**"Secret not found"**
```bash
# List all secrets to see what exists
gcloud secrets list
# Check if you're using the right project
gcloud config get-value project
```

**"Access token scope insufficient"**
```bash
# Re-authenticate with broader scopes
gcloud auth login --scopes=https://www.googleapis.com/auth/cloud-platform
```

### Verify Application Access

Test that your service account can access secrets:
```bash
# Activate service account
gcloud auth activate-service-account --key-file=config/blather-secrets-key.json

# Test secret access
gcloud secrets versions access latest --secret=jwt-secret

# Switch back to your user account
gcloud auth login
```

## Monitoring and Alerts

### View secret access logs
```bash
gcloud logging read 'resource.type="secret_manager_secret" AND protoPayload.methodName="google.cloud.secretmanager.v1.SecretManagerService.AccessSecretVersion"' --limit=50 --format=json
```

### Set up monitoring dashboard
1. Go to Cloud Monitoring in GCP Console
2. Create a new dashboard
3. Add charts for:
   - Secret access frequency
   - Failed access attempts
   - Secret version changes

### Create alerts for unusual activity
```bash
# Example: Alert on high number of failed secret accesses
gcloud alpha monitoring policies create --policy-file=secret-access-alerts.yaml
```

Where `secret-access-alerts.yaml` contains:
```yaml
displayName: "High Secret Manager Error Rate"
conditions:
  - displayName: "Secret access failures"
    conditionThreshold:
      filter: 'resource.type="secret_manager_secret" AND severity=ERROR'
      comparison: COMPARISON_GREATER_THAN
      thresholdValue: 10
      duration: "300s"
notificationChannels: ["projects/PROJECT_ID/notificationChannels/CHANNEL_ID"]
```

## Best Practices

### Secret Naming
- Use kebab-case: `stripe-api-key` not `STRIPE_API_KEY`
- Include service/purpose: `resend-api-key`, `oauth-client-secret`  
- Environment prefix if needed: `prod-database-password`

### Labels for Organization
Always add labels when creating secrets:
```bash
gcloud secrets create api-key \
    --labels=app=blather,service=stripe,env=production \
    --data-file=-
```

### Access Patterns
- **Read secrets at startup**, not on every request (cache configuration)
- **Use environment variable fallbacks** for gradual migration
- **Don't log secret values** (even in debug mode)

### Security
- **Principle of least privilege** - only grant access to secrets that are needed
- **Regular rotation** - especially for high-privilege keys
- **Monitor access patterns** - unusual access might indicate a security issue
- **Use separate secrets per environment** - avoid sharing prod secrets in dev

## Troubleshooting Checklist

When secrets aren't working:

- [ ] Is the GCP project correct? (`gcloud config get-value project`)
- [ ] Is the secret name spelled correctly?
- [ ] Does the service account have `secretmanager.secretAccessor` role?
- [ ] Is `GOOGLE_APPLICATION_CREDENTIALS` pointing to the right key file?
- [ ] Is the key file readable by the application process?
- [ ] Is Secret Manager API enabled? (`gcloud services list --enabled`)
- [ ] Does the secret exist and have an enabled version?
- [ ] Check application logs for specific error messages

## Cost Optimization

- **Clean up unused secrets** regularly
- **Destroy old secret versions** after confirming new ones work
- **Use environment variables for non-sensitive config** (less API calls)
- **Cache secrets in application memory** (don't fetch on every request)

Current usage and costs:
```bash
# List all secrets and versions
gcloud secrets list --format="table(name,labels,createTime)"

# Check version count per secret
for secret in $(gcloud secrets list --format="value(name)"); do
  echo "$secret: $(gcloud secrets versions list $secret --format="value(name)" | wc -l) versions"
done
```
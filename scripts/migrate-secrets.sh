#!/bin/bash

# Migration script to move existing environment variables to GCP Secret Manager
# Run this after setup-secret-manager.sh to migrate your existing secrets

set -e

PROJECT_ID=$(gcloud config get-value project)
if [ -z "$PROJECT_ID" ]; then
    echo "Error: No GCP project is configured. Run 'gcloud config set project PROJECT_ID' first."
    exit 1
fi

echo "Migrating existing secrets to GCP Secret Manager for project: $PROJECT_ID"

# Source the current .env file if it exists
if [ -f ".env" ]; then
    echo "Found .env file, sourcing for migration..."
    set -a
    source .env
    set +a
else
    echo "No .env file found. You'll need to manually provide secret values."
fi

# Function to create or update secret
create_or_update_secret() {
    local secret_name=$1
    local env_var_name=$2
    local description=$3
    local secret_value="${!env_var_name}"
    
    if [ -z "$secret_value" ]; then
        echo "⚠️  $env_var_name is not set, skipping $secret_name"
        return
    fi
    
    if gcloud secrets describe $secret_name >/dev/null 2>&1; then
        echo "Updating existing secret: $secret_name"
        echo -n "$secret_value" | gcloud secrets versions add $secret_name --data-file=-
    else
        echo "Creating new secret: $secret_name"
        echo -n "$secret_value" | gcloud secrets create $secret_name \
            --data-file=- \
            --labels=app=blather,migrated=true \
            --quiet
    fi
    echo "✅ $secret_name updated"
}

echo ""
echo "Migrating secrets from environment variables..."
echo ""

# Migrate common secrets
create_or_update_secret "resend-api-key" "RESEND_API_KEY" "Resend email service API key"
create_or_update_secret "openai-api-key" "OPENAI_API_KEY" "OpenAI API key for TTS"
create_or_update_secret "elevenlabs-api-key" "ELEVENLABS_API_KEY" "ElevenLabs API key for TTS"
create_or_update_secret "oauth-client-id" "OAUTH_CLIENT_ID" "OAuth client ID"
create_or_update_secret "oauth-client-secret" "OAUTH_CLIENT_SECRET" "OAuth client secret"

# Handle JWT secret specially - generate new one if not set
if [ -n "$JWT_SECRET" ]; then
    create_or_update_secret "jwt-secret" "JWT_SECRET" "JWT signing secret"
else
    echo "JWT_SECRET not found in environment, using the one created during setup"
fi

echo ""
echo "✅ Secret migration complete!"
echo ""
echo "Next steps:"
echo "1. Test your application with Secret Manager integration"
echo "2. Once confirmed working, remove secrets from .env file:"
echo "   - RESEND_API_KEY"
echo "   - OPENAI_API_KEY"  
echo "   - ELEVENLABS_API_KEY"
echo "   - OAUTH_CLIENT_ID"
echo "   - OAUTH_CLIENT_SECRET"
echo "   - JWT_SECRET"
echo "3. Keep DATABASE_URL in .env (less sensitive, easier to manage locally)"
echo ""
echo "To verify secrets were created:"
echo "gcloud secrets list --filter=\"labels.app=blather\""
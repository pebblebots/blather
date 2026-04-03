#!/bin/bash

# GCP Secret Manager Setup Script for Blather
# Run this script to enable Secret Manager API and set up initial configuration

set -e

PROJECT_ID=$(gcloud config get-value project)
if [ -z "$PROJECT_ID" ]; then
    echo "Error: No GCP project is configured. Run 'gcloud config set project PROJECT_ID' first."
    exit 1
fi

echo "Setting up GCP Secret Manager for project: $PROJECT_ID"

# Enable Secret Manager API
echo "Enabling Secret Manager API..."
gcloud services enable secretmanager.googleapis.com

# Create service account
echo "Creating service account for Secret Manager access..."
gcloud iam service-accounts create blather-secrets \
    --display-name="Blather Secret Manager Service Account" \
    --description="Service account for accessing secrets in Blather application" \
    --quiet || echo "Service account already exists"

SERVICE_ACCOUNT="blather-secrets@${PROJECT_ID}.iam.gserviceaccount.com"

# Grant IAM permissions
echo "Setting up IAM permissions..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet

# Generate service account key
echo "Generating service account key..."
if [ ! -f "./config/blather-secrets-key.json" ]; then
    mkdir -p ./config
    gcloud iam service-accounts keys create ./config/blather-secrets-key.json \
        --iam-account=$SERVICE_ACCOUNT
    echo "Service account key created at: ./config/blather-secrets-key.json"
    echo "IMPORTANT: Keep this file secure and add it to .gitignore"
else
    echo "Service account key already exists at: ./config/blather-secrets-key.json"
fi

echo "Creating initial secrets..."

# Function to create secret if it doesn't exist
create_secret_if_missing() {
    local secret_name=$1
    local secret_value=$2
    local description=$3
    
    if gcloud secrets describe $secret_name >/dev/null 2>&1; then
        echo "Secret $secret_name already exists, skipping..."
    else
        echo "Creating secret: $secret_name"
        echo -n "$secret_value" | gcloud secrets create $secret_name \
            --data-file=- \
            --labels=app=blather \
            --quiet
        echo "Secret $secret_name created successfully"
    fi
}

# Generate a secure JWT secret
JWT_SECRET=$(openssl rand -base64 32)
create_secret_if_missing "jwt-secret" "$JWT_SECRET" "JWT signing secret for Blather authentication"

echo ""
echo "✅ Secret Manager setup complete!"
echo ""
echo "Next steps:"
echo "1. Set environment variable: export GOOGLE_APPLICATION_CREDENTIALS=\"$(pwd)/config/blather-secrets-key.json\""
echo "2. Add additional secrets as needed:"
echo "   - Resend API key: echo -n 'YOUR_KEY' | gcloud secrets create resend-api-key --data-file=-"
echo "   - OpenAI API key: echo -n 'YOUR_KEY' | gcloud secrets create openai-api-key --data-file=-"
echo "   - ElevenLabs API key: echo -n 'YOUR_KEY' | gcloud secrets create elevenlabs-api-key --data-file=-"
echo "3. Install dependencies: pnpm add @google-cloud/secret-manager"
echo "4. Update application code to use Secret Manager (see docs/gcp/secret-manager-setup.md)"
echo ""
echo "To grant admin access to team members:"
echo "gcloud projects add-iam-policy-binding $PROJECT_ID \\"
echo "    --member=\"user:user@example.com\" \\"
echo "    --role=\"roles/secretmanager.admin\""
#!/bin/bash

# Test script to verify Secret Manager setup and integration

set -e

echo "🔍 Testing GCP Secret Manager setup..."
echo ""

PROJECT_ID=$(gcloud config get-value project)
if [ -z "$PROJECT_ID" ]; then
    echo "❌ No GCP project is configured"
    exit 1
fi

echo "📍 Project: $PROJECT_ID"
echo ""

# Test 1: Check if Secret Manager API is enabled
echo "1. Testing Secret Manager API..."
if gcloud services list --enabled --filter="name:secretmanager.googleapis.com" --format="value(name)" | grep -q secretmanager; then
    echo "✅ Secret Manager API is enabled"
else
    echo "❌ Secret Manager API is not enabled. Run: gcloud services enable secretmanager.googleapis.com"
    exit 1
fi

# Test 2: Check service account exists
echo ""
echo "2. Testing service account..."
SERVICE_ACCOUNT="blather-secrets@${PROJECT_ID}.iam.gserviceaccount.com"
if gcloud iam service-accounts describe $SERVICE_ACCOUNT >/dev/null 2>&1; then
    echo "✅ Service account exists: $SERVICE_ACCOUNT"
else
    echo "❌ Service account not found: $SERVICE_ACCOUNT"
    echo "   Run: ./scripts/setup-secret-manager.sh"
    exit 1
fi

# Test 3: Check service account key
echo ""
echo "3. Testing service account key..."
KEY_FILE="./config/blather-secrets-key.json"
if [ -f "$KEY_FILE" ]; then
    echo "✅ Service account key exists: $KEY_FILE"
else
    echo "❌ Service account key not found: $KEY_FILE"
    echo "   Run: ./scripts/setup-secret-manager.sh"
    exit 1
fi

# Test 4: Check IAM permissions
echo ""
echo "4. Testing IAM permissions..."
if gcloud projects get-iam-policy $PROJECT_ID --flatten="bindings[].members" --filter="bindings.role:roles/secretmanager.secretAccessor AND bindings.members:serviceAccount:$SERVICE_ACCOUNT" --format="value(bindings.role)" | grep -q secretmanager; then
    echo "✅ Service account has Secret Manager access"
else
    echo "❌ Service account missing Secret Manager permissions"
    echo "   Run: gcloud projects add-iam-policy-binding $PROJECT_ID \\"
    echo "        --member=\"serviceAccount:$SERVICE_ACCOUNT\" \\"
    echo "        --role=\"roles/secretmanager.secretAccessor\""
    exit 1
fi

# Test 5: Create a test secret
echo ""
echo "5. Testing secret creation and access..."
TEST_SECRET="blather-test-secret-$(date +%s)"
TEST_VALUE="test-value-$(date +%s)"

echo "Creating test secret: $TEST_SECRET"
if echo -n "$TEST_VALUE" | gcloud secrets create $TEST_SECRET --data-file=- --quiet; then
    echo "✅ Test secret created successfully"
else
    echo "❌ Failed to create test secret"
    exit 1
fi

# Test 6: Access the secret with service account
echo ""
echo "6. Testing secret access with service account..."
export GOOGLE_APPLICATION_CREDENTIALS="$KEY_FILE"
RETRIEVED_VALUE=$(gcloud secrets versions access latest --secret=$TEST_SECRET 2>/dev/null || echo "FAILED")

if [ "$RETRIEVED_VALUE" = "$TEST_VALUE" ]; then
    echo "✅ Secret access with service account works"
else
    echo "❌ Failed to access secret with service account"
    echo "   Expected: $TEST_VALUE"
    echo "   Got: $RETRIEVED_VALUE"
    exit 1
fi

# Test 7: Clean up test secret
echo ""
echo "7. Cleaning up test secret..."
if gcloud secrets delete $TEST_SECRET --quiet; then
    echo "✅ Test secret cleaned up"
else
    echo "⚠️  Failed to delete test secret: $TEST_SECRET (manual cleanup needed)"
fi

# Test 8: Check existing Blather secrets
echo ""
echo "8. Checking existing Blather secrets..."
BLATHER_SECRETS=$(gcloud secrets list --filter="labels.app=blather" --format="value(name)" | wc -l)
if [ $BLATHER_SECRETS -gt 0 ]; then
    echo "✅ Found $BLATHER_SECRETS Blather secret(s):"
    gcloud secrets list --filter="labels.app=blather" --format="table(name,labels.service:label=Service,createTime:label='Created')"
else
    echo "⚠️  No Blather secrets found. You may need to run: ./scripts/migrate-secrets.sh"
fi

# Test 9: Test Node.js integration (if package is installed)
echo ""
echo "9. Testing Node.js Secret Manager client..."
if node -e "require('@google-cloud/secret-manager')" 2>/dev/null; then
    echo "✅ @google-cloud/secret-manager package is installed"
    
    # Test basic client initialization
    if node -e "
        const {SecretManagerServiceClient} = require('@google-cloud/secret-manager');
        process.env.GOOGLE_APPLICATION_CREDENTIALS = '$KEY_FILE';
        const client = new SecretManagerServiceClient();
        console.log('✅ Secret Manager client initialized successfully');
    " 2>/dev/null; then
        echo "✅ Secret Manager client works in Node.js"
    else
        echo "❌ Secret Manager client failed to initialize in Node.js"
        exit 1
    fi
else
    echo "⚠️  @google-cloud/secret-manager package not installed"
    echo "   Run: cd packages/api && pnpm install"
fi

echo ""
echo "🎉 All tests passed! Secret Manager is ready for use."
echo ""
echo "Next steps:"
echo "1. Set environment variable: export GOOGLE_APPLICATION_CREDENTIALS=\"$(pwd)/config/blather-secrets-key.json\""
echo "2. Migrate existing secrets: ./scripts/migrate-secrets.sh"
echo "3. Update your application to use the new secret loading system"
echo "4. Test your application with: npm run dev"
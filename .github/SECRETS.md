# GitHub Actions Secrets

Add these in **Settings → Secrets and variables → Actions**:

| Secret | Value |
|--------|-------|
| `SSH_PRIVATE_KEY` | Private key for SSH access to the deploy server (ed25519 recommended) |
| `SSH_HOST` | `136.109.102.58` |
| `SSH_USER` | `code` |

## Setup on the GCP box

```bash
# Install pm2 globally
npm install -g pm2

# Clone the repo (first time)
cd ~ && git clone git@github.com:YOUR_ORG/blather.git

# Generate a deploy key pair and add the public key to GitHub deploy keys
ssh-keygen -t ed25519 -f ~/.ssh/blather_deploy -N ""
# Add ~/.ssh/blather_deploy.pub as a deploy key on the repo
# Add the private key content as the SSH_PRIVATE_KEY secret in GitHub
```

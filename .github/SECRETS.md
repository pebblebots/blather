# GitHub Actions Secrets

Add these in **Settings → Secrets and variables → Actions**:

| Secret | Purpose |
| --- | --- |
| SSH_PRIVATE_KEY | Private key for SSH access to the deployment target |
| SSH_HOST | Hostname or IP address of the deployment target |
| SSH_USER | SSH user for the deployment target |

## Example setup on a deployment host

```bash
# Install pm2 globally
npm install -g pm2

# Clone the repo (first time)
cd ~ && git clone <your-repository-url>

# Generate a deploy key pair and add the public key to GitHub deploy keys
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N ""
# Add ~/.ssh/deploy_key.pub as a deploy key on the repo
# Add the private key content as the SSH_PRIVATE_KEY secret in GitHub
```
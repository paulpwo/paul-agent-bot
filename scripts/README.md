# scripts/

## deploy.sh

SSH-based deploy script. Pulls a new Docker image from ECR and restarts the app containers on the EC2 instance without downtime for Redis.

### Usage

```bash
# Deploy :latest (reads EC2 host from terraform output)
./scripts/deploy.sh

# Deploy to a specific IP
./scripts/deploy.sh 1.2.3.4

# Deploy a specific image tag
./scripts/deploy.sh 1.2.3.4 sha-abc123def456
```

### Requirements

- Terraform state must be accessible locally (for host + ECR URL resolution)
- SSH key for EC2 must be configured (`~/.ssh/id_ed25519` or via `ssh-agent`)
- AWS credentials configured locally (`aws configure` or env vars)

### What it does

1. Resolves EC2 host and ECR URL from `terraform output`
2. SSHs into the instance
3. Logs Docker into ECR using instance IAM role
4. Updates `PAULAGENTBOT_IMAGE` in `.env`
5. Pulls the new image
6. Restarts `paulagentbot` and `paulagentbot-worker` containers (Redis stays up)

### First deploy

On a fresh instance, the docker-compose stack is not running yet. After filling in `.env`:

```bash
ssh ubuntu@<elastic-ip>
cd ~/paulagentbot
sudo systemctl start paulagentbot
docker compose logs -f
```

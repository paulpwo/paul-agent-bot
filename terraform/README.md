# PaulBot — Terraform Infrastructure

Single EC2 instance running Docker Compose (Redis + SQLite on EBS).

## Architecture

```
Internet → Caddy (HTTPS/TLS) → paulbot:3000  (Next.js + webhooks)
                                paulbot-worker (BullMQ agent runner)
                                redis          (queues + pub/sub)

Data on EBS volume (/data):
  /data/paulbot.db    ← SQLite database (survives deploys)
  /data/workspaces/   ← cloned repos (survives deploys)
  /data/caddy/        ← TLS certificates (survives deploys)
```

## What Terraform provisions

| Resource | Purpose |
|----------|---------|
| EC2 instance (Ubuntu 22.04) | Runs the full stack via Docker Compose |
| EBS data volume (separate) | SQLite DB + workspaces + Caddy certs — `delete_on_termination = false` |
| Elastic IP | Static public IP — point your DNS A record here |
| Security group | Allows 22 (SSH), 80 (HTTP), 443 (HTTPS) |
| IAM instance profile | Allows EC2 to pull images from ECR |
| ECR repository | Docker image registry |
| EventBridge Scheduler | Start/stop EC2 on schedule to save money |
| GitHub Actions OIDC role | Allows CI to push images to ECR without long-lived keys |

## Prerequisites

1. **AWS CLI configured:**
   ```bash
   aws configure --profile paulbot
   ```

2. **S3 + DynamoDB for Terraform state** — create once before `terraform init`:
   ```bash
   PROFILE=paulbot
   REGION=us-east-1

   aws s3api create-bucket \
     --bucket paulbot-terraform-state \
     --region $REGION --profile $PROFILE

   aws s3api put-bucket-versioning \
     --bucket paulbot-terraform-state \
     --versioning-configuration Status=Enabled \
     --profile $PROFILE

   aws s3api put-bucket-encryption \
     --bucket paulbot-terraform-state \
     --server-side-encryption-configuration \
       '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' \
     --profile $PROFILE

   aws dynamodb create-table \
     --table-name paulbot-terraform-locks \
     --attribute-definitions AttributeName=LockID,AttributeType=S \
     --key-schema AttributeName=LockID,KeyType=HASH \
     --billing-mode PAY_PER_REQUEST \
     --region $REGION --profile $PROFILE
   ```

3. **SSH key pair** — the public key is uploaded to EC2:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519
   ```

## First deploy

```bash
# 1. Copy and fill in your variables
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
# Edit terraform.tfvars — set domain_name, github_repo, etc.

# 2. Init
cd terraform/
terraform init

# 3. Plan
terraform plan -var-file=terraform.tfvars

# 4. Apply
terraform apply -var-file=terraform.tfvars
```

## After first apply

```bash
# Get outputs
terraform output

# SSH into the instance
$(terraform output -raw ssh_command)

# Fill in secrets
nano ~/paulbot/.env

# Start the stack
sudo systemctl start paulbot

# Verify
docker compose -f ~/paulbot/docker-compose.yml ps
docker compose -f ~/paulbot/docker-compose.yml logs -f
```

## DNS setup

Point your domain's **A record** to the Elastic IP:

```bash
terraform output elastic_ip
# → 1.2.3.4
# Create A record: paulbot.yourdomain.com → 1.2.3.4
```

Caddy handles TLS automatically via Let's Encrypt — no ACM needed.

## GitHub Actions setup

After apply, set these secrets in your GitHub repository:

| Secret | Value |
|--------|-------|
| `AWS_ROLE_TO_ASSUME` | `terraform output -raw github_actions_role_arn` |
| `ECR_REGISTRY` | `terraform output -raw ecr_repository_url \| cut -d/ -f1` |

## Subsequent deploys

```bash
# From your local machine (reads host + ECR URL from terraform output)
./scripts/deploy.sh

# Or with a specific image tag
./scripts/deploy.sh 1.2.3.4 sha-abc123
```

## Debugging

```bash
# SSH
ssh ubuntu@$(cd terraform && terraform output -raw elastic_ip)

# Container logs
docker compose -f ~/paulbot/docker-compose.yml logs -f paulbot
docker compose -f ~/paulbot/docker-compose.yml logs -f paulbot-worker

# Restart a service
docker compose -f ~/paulbot/docker-compose.yml restart paulbot
```

## If the instance is replaced

The EBS data volume has `prevent_destroy = true` and `delete_on_termination = false`. If you need to replace the EC2 instance:

1. Note the data volume ID: `terraform output data_volume_id`
2. Destroy and recreate the instance (not the volume)
3. Reattach the volume — Terraform handles this via `aws_volume_attachment`

Your database and workspaces are safe.

## Cost estimate (us-east-1, 2025 pricing)

| Resource | Monthly est. |
|----------|-------------|
| EC2 t3.small | ~$15 |
| EBS 20 GB gp3 (data) | ~$1.60 |
| EBS 20 GB gp3 (root) | ~$1.60 |
| Elastic IP (attached) | free |
| ECR storage | ~$0.50 |
| EventBridge Scheduler | ~$0 |
| **Total** | **~$19/mo** |

> With the EventBridge scheduler (stop at 22:30, start at 07:00 Mon–Sat):
> ~65% uptime → **~$12/mo** effective cost.

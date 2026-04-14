# PaulBot — Terraform Infrastructure

AWS ECS Fargate infrastructure for PaulBot (Next.js + BullMQ workers).

## Architecture

```
Internet → ALB (HTTPS) → ECS Fargate
                           ├── paulbot-web  (Next.js + webhook receivers, port 3000)
                           └── paulbot-worker (BullMQ agent runner, no port)
                                      ↓
                               RDS PostgreSQL 16
                               ElastiCache Redis 7
                               S3 (workspace data)
                               Secrets Manager (credentials)
```

## Prerequisites

1. **AWS profile** — create a dedicated profile (NOT `default` — that is TalentPitch):
   ```bash
   aws configure --profile paulbot
   ```

2. **Bootstrap state backend** — create these manually once before `terraform init`:
   ```bash
   # S3 state bucket
   aws s3api create-bucket \
     --bucket paulbot-terraform-state \
     --region us-east-1 \
     --profile paulbot

   aws s3api put-bucket-versioning \
     --bucket paulbot-terraform-state \
     --versioning-configuration Status=Enabled \
     --profile paulbot

   aws s3api put-bucket-encryption \
     --bucket paulbot-terraform-state \
     --server-side-encryption-configuration \
       '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' \
     --profile paulbot

   # DynamoDB lock table
   aws dynamodb create-table \
     --table-name paulbot-terraform-locks \
     --attribute-definitions AttributeName=LockID,AttributeType=S \
     --key-schema AttributeName=LockID,KeyType=HASH \
     --billing-mode PAY_PER_REQUEST \
     --region us-east-1 \
     --profile paulbot
   ```

## First deploy

```bash
cd terraform/

# 1. Init
terraform init

# 2. Plan (prod)
terraform plan -var-file=environments/prod.tfvars \
  -var="domain_name=paulbot.yourdomain.com" \
  -var="github_repo=yourusername/paulbot"

# 3. Apply
terraform apply -var-file=environments/prod.tfvars \
  -var="domain_name=paulbot.yourdomain.com" \
  -var="github_repo=yourusername/paulbot"
```

## After first apply — populate secrets

The apply creates Secrets Manager secrets with **no value**. Populate them before
deploying the container:

```bash
PROFILE=paulbot
ENV=prod

# DB password (pick a strong one — also needs to match what you set in AWS)
aws secretsmanager put-secret-value \
  --secret-id "paulbot/$ENV/db-password" \
  --secret-string "$(openssl rand -base64 32)" \
  --profile $PROFILE

# NextAuth secret
aws secretsmanager put-secret-value \
  --secret-id "paulbot/$ENV/nextauth-secret" \
  --secret-string "$(openssl rand -base64 32)" \
  --profile $PROFILE

# Encryption key (32-byte hex for AES-256)
aws secretsmanager put-secret-value \
  --secret-id "paulbot/$ENV/encryption-key" \
  --secret-string "$(openssl rand -hex 32)" \
  --profile $PROFILE

# GitHub App credentials
aws secretsmanager put-secret-value \
  --secret-id "paulbot/$ENV/github-app-id" \
  --secret-string "YOUR_GITHUB_APP_ID" \
  --profile $PROFILE

aws secretsmanager put-secret-value \
  --secret-id "paulbot/$ENV/github-app-private-key" \
  --secret-string "$(cat path/to/your-app.private-key.pem)" \
  --profile $PROFILE

aws secretsmanager put-secret-value \
  --secret-id "paulbot/$ENV/github-app-webhook-secret" \
  --secret-string "YOUR_WEBHOOK_SECRET" \
  --profile $PROFILE

# Telegram Bot token
aws secretsmanager put-secret-value \
  --secret-id "paulbot/$ENV/telegram-bot-token" \
  --secret-string "YOUR_TELEGRAM_BOT_TOKEN" \
  --profile $PROFILE
```

## DNS setup

If you set `route53_zone_id`, DNS records are created automatically.

If using an external DNS provider (Cloudflare, etc.):
```bash
# Get the ALB DNS name after apply
terraform output alb_dns_name
# Create a CNAME record: paulbot.yourdomain.com → <alb-dns-name>
```

**ACM cert validation**: if Route53 is not managed here, you must manually add the
DNS validation records shown in `aws_acm_certificate.domain_validation_options` before
the certificate can be issued.

## GitHub Actions setup

After apply, set these secrets in your GitHub repository:

| Secret | Value |
|--------|-------|
| `AWS_ROLE_TO_ASSUME` | `terraform output github_actions_role_arn` |
| `ECR_REGISTRY` | `terraform output ecr_repository_url \| cut -d/ -f1` |

The OIDC provider and IAM role are created by Terraform — no AWS access keys needed.

## Prisma migrations

The web container runs `node server.js` directly. To run migrations before deployment,
wrap the CMD in your Dockerfile or create a separate one-off ECS task:

```bash
# Run migrations as a one-off ECS task (after first apply, before first deploy)
aws ecs run-task \
  --cluster paulbot-prod \
  --task-definition paulbot-prod-web \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$(terraform output -raw private_subnet_ids | tr -d '[]"' | tr ',' ' ')],securityGroups=[...]}" \
  --overrides '{"containerOverrides":[{"name":"web","command":["npx","prisma","migrate","deploy"]}]}' \
  --profile paulbot
```

## ECS Exec (debugging)

SSH into a running container:
```bash
aws ecs execute-command \
  --cluster paulbot-prod \
  --task <task-id> \
  --container web \
  --command "/bin/sh" \
  --interactive \
  --profile paulbot
```

## Module overview

| Module | What it provisions |
|--------|--------------------|
| `networking` | VPC, public/private subnets, IGW, NAT gateway(s), 4 security groups |
| `ecr` | ECR repository + lifecycle policy (keep 10 tagged, expire untagged after 7d) |
| `alb` | ALB, target group, HTTP→HTTPS redirect, HTTPS listener, ACM cert, optional Route53 |
| `data` | RDS PostgreSQL 16, ElastiCache Redis 7, subnet groups |
| `ecs` | ECS cluster, two task definitions (web + worker), two services, IAM roles |

## Cost estimate (prod, us-east-1, ~2025 pricing)

| Resource | Monthly est. |
|----------|-------------|
| ECS Fargate web (0.5 vCPU, 1 GB, ~720h) | ~$15 |
| ECS Fargate worker (1 vCPU, 2 GB, ~720h) | ~$30 |
| RDS db.t3.micro | ~$15 |
| ElastiCache cache.t3.micro | ~$13 |
| ALB | ~$16 |
| NAT gateway (2x) | ~$65 |
| S3 + ECR storage | ~$2 |
| **Total** | **~$156/mo** |

> To save ~$65/mo: set `single_nat_gateway = true` (loses NAT HA).
> For dev: single AZ + single NAT brings it to ~$70/mo.

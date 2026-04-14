#!/bin/bash
# deploy.sh — SSH-based deploy to EC2
#
# Usage:
#   ./scripts/deploy.sh                        # reads host from terraform output, uses :latest
#   ./scripts/deploy.sh 1.2.3.4                # deploy :latest to specific IP
#   ./scripts/deploy.sh 1.2.3.4 sha-abc123     # deploy specific image tag
#
# Requirements:
#   - terraform state accessible (for auto-resolving host + ECR URL)
#   - SSH key for EC2 must be configured (~/.ssh/id_ed25519 or ssh-agent)
#   - AWS credentials configured locally (for ECR URL lookup)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$SCRIPT_DIR/../terraform"

# ── Resolve EC2 host ──────────────────────────────────────────────────────────
EC2_HOST="${1:-}"
if [ -z "$EC2_HOST" ]; then
  echo "Resolving host from terraform output..."
  EC2_HOST=$(terraform -chdir="$TF_DIR" output -raw elastic_ip 2>/dev/null) || {
    echo "ERROR: Could not get elastic_ip from terraform output."
    echo "Pass the EC2 IP as the first argument: ./scripts/deploy.sh <IP> [TAG]"
    exit 1
  }
fi

# ── Resolve ECR URL ───────────────────────────────────────────────────────────
ECR_URL=$(terraform -chdir="$TF_DIR" output -raw ecr_repository_url 2>/dev/null) || {
  echo "ERROR: Could not get ecr_repository_url from terraform output."
  exit 1
}

IMAGE_TAG="${2:-latest}"
PAULAGENTBOT_IMAGE="${ECR_URL}:${IMAGE_TAG}"
AWS_REGION="${AWS_REGION:-us-east-1}"

echo "=============================="
echo "  PaulAgentBot Deploy"
echo "  Host:  $EC2_HOST"
echo "  Image: $PAULAGENTBOT_IMAGE"
echo "=============================="
echo ""

ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 ubuntu@"$EC2_HOST" \
  bash -s -- "$ECR_URL" "$PAULAGENTBOT_IMAGE" "$AWS_REGION" << 'REMOTE_EOF'
set -euo pipefail
ECR_URL="$1"
PAULAGENTBOT_IMAGE="$2"
AWS_REGION="$3"

cd ~/paulagentbot

echo "--- [1/4] ECR login..."
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_URL"

echo "--- [2/4] Updating PAULAGENTBOT_IMAGE in .env..."
if grep -q "^PAULAGENTBOT_IMAGE=" .env; then
  sed -i "s|^PAULAGENTBOT_IMAGE=.*|PAULAGENTBOT_IMAGE=$PAULAGENTBOT_IMAGE|" .env
else
  echo "PAULAGENTBOT_IMAGE=$PAULAGENTBOT_IMAGE" >> .env
fi

echo "--- [3/4] Pulling new images..."
PAULAGENTBOT_IMAGE="$PAULAGENTBOT_IMAGE" docker compose pull paulagentbot paulagentbot-worker

echo "--- [4/4] Restarting app containers (redis stays up)..."
PAULAGENTBOT_IMAGE="$PAULAGENTBOT_IMAGE" docker compose up -d --no-deps paulagentbot paulagentbot-worker

echo ""
echo "Deploy complete. Status:"
docker compose ps
REMOTE_EOF

echo ""
echo "Done."

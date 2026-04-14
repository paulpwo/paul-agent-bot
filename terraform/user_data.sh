#!/bin/bash
# PaulBot EC2 bootstrap script
# Runs once on first instance launch via cloud-init.
# Terraform templatefile variables: ecr_repo_url, aws_region, domain
set -euo pipefail
exec > >(tee /var/log/user-data.log | logger -t user-data -s 2>/dev/console) 2>&1

echo ">>> [1/8] System update"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -yq \
  -o Dpkg::Options::="--force-confdef" \
  -o Dpkg::Options::="--force-confold"

echo ">>> [2/8] Base packages"
apt-get install -y \
  git curl wget ca-certificates gnupg software-properties-common \
  apt-transport-https jq ufw fail2ban unzip

# AWS CLI v2
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp
/tmp/aws/install
rm -rf /tmp/aws /tmp/awscliv2.zip

echo ">>> [3/8] Firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   comment "SSH"
ufw allow 80/tcp   comment "HTTP"
ufw allow 443/tcp  comment "HTTPS"
ufw --force enable
systemctl enable fail2ban
systemctl start fail2ban

echo ">>> [4/8] Docker"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $$(lsb_release -cs) stable" \
  | tee /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y \
  docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
usermod -aG docker ubuntu
systemctl enable docker
systemctl start docker

echo ">>> [5/8] EBS data volume mount"
# Nitro-based instances (t3.*) expose /dev/xvdf as /dev/nvme1n1
# Try both device paths — retry once if neither is found yet
for attempt in 1 2; do
  if   [ -b /dev/xvdf    ]; then DEVICE=/dev/xvdf;    break
  elif [ -b /dev/nvme1n1 ]; then DEVICE=/dev/nvme1n1; break
  else
    echo "Data device not found (attempt $${attempt}/2), waiting 15s..."
    sleep 15
  fi
done
if [ -z "$${DEVICE:-}" ]; then
  echo "ERROR: data EBS device not found after retries"; exit 1
fi

# Format only if not already formatted (idempotent on re-runs)
if ! blkid "$${DEVICE}" &>/dev/null; then
  echo "Formatting $${DEVICE} as ext4..."
  mkfs.ext4 -L paulbot-data "$${DEVICE}"
fi

mkdir -p /data
if ! grep -q "paulbot-data" /etc/fstab; then
  echo "LABEL=paulbot-data /data ext4 defaults,nofail 0 2" >> /etc/fstab
fi
mount -a

# Directories expected by docker-compose.yml
mkdir -p /data/workspaces /data/caddy
# Pre-create SQLite file so Docker bind mount doesn't create it as a directory
touch /data/paulbot.db
chown -R ubuntu:ubuntu /data

echo ">>> [6/8] App directory"
APP_DIR=/home/ubuntu/paulbot
mkdir -p "$${APP_DIR}"

# Placeholder docker-compose.yml — real one should be deployed via git or deploy.sh
cat > "$${APP_DIR}/docker-compose.yml" << 'COMPOSE_EOF'
# Placeholder — replace with the real docker-compose.yml from the repository
# or copy it here via your deploy script.
COMPOSE_EOF

# Caddyfile — matches the one in the repository
cat > "$${APP_DIR}/Caddyfile" << 'CADDY_EOF'
{$PAULBOT_DOMAIN} {
    reverse_proxy paulbot:3000
    encode gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
CADDY_EOF

# .env template — operator must fill in secrets before first start
cat > "$${APP_DIR}/.env" << ENV_EOF
# PaulBot environment — fill in all values before starting
# See .env.example in the repository for documentation.

PAULBOT_IMAGE=${ecr_repo_url}:latest
PAULBOT_DOMAIN=${domain}

NEXTAUTH_SECRET=CHANGE_ME
NEXTAUTH_URL=https://${domain}
ENCRYPTION_KEY=CHANGE_ME

GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_APP_WEBHOOK_SECRET=
GITHUB_APP_BOT_USERNAME=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

TELEGRAM_BOT_TOKEN=

REDIS_URL=redis://redis:6379
DATABASE_URL=file:/data/paulbot.db
CLAUDE_AUTH_DIR=/home/ubuntu/.claude
ENV_EOF

chown -R ubuntu:ubuntu "$${APP_DIR}"

echo ">>> [7/8] Systemd service"
cat > /etc/systemd/system/paulbot.service << 'SERVICE_EOF'
[Unit]
Description=PaulBot Docker Compose Stack
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/ubuntu/paulbot
ExecStartPre=/bin/bash -c 'aws ecr get-login-password --region AWS_REGION | docker login --username AWS --password-stdin ECR_REPO_URL'
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
User=ubuntu
Group=ubuntu

[Install]
WantedBy=multi-user.target
SERVICE_EOF

# Substitute Terraform template values into the systemd unit
sed -i "s|AWS_REGION|${aws_region}|g" /etc/systemd/system/paulbot.service
sed -i "s|ECR_REPO_URL|${ecr_repo_url}|g" /etc/systemd/system/paulbot.service

systemctl daemon-reload
systemctl enable paulbot
# Do NOT start — operator must fill in .env secrets first

echo ">>> [8/8] Bootstrap complete"
PUBLIC_IP=$$(curl -sf http://169.254.169.254/latest/meta-data/public-ipv4 || echo "unknown")
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  PaulBot bootstrap complete                                  ║"
echo "║  Fill in /home/ubuntu/paulbot/.env before starting          ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  SSH:   ssh ubuntu@$${PUBLIC_IP}"
echo "  Edit:  nano /home/ubuntu/paulbot/.env"
echo "  Start: sudo systemctl start paulbot"
echo "  Logs:  docker compose -f /home/ubuntu/paulbot/docker-compose.yml logs -f"

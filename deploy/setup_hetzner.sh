#!/usr/bin/env bash
# AkisCFD — Hetzner Cloud first-boot setup script
# Run once as root on a fresh Ubuntu 22.04 server:
#   curl -sL https://raw.githubusercontent.com/fthmtzkl/akiscfd/main/deploy/setup_hetzner.sh | bash

set -euo pipefail
echo "=== AkisCFD Hetzner Setup ==="

# ── 1. System update ─────────────────────────────────────────────────────────
apt-get update && apt-get upgrade -y
apt-get install -y curl git ufw fail2ban

# ── 2. Docker ────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker "$SUDO_USER" 2>/dev/null || true
fi

# Docker Compose plugin
docker compose version || apt-get install -y docker-compose-plugin

# ── 3. Firewall ──────────────────────────────────────────────────────────────
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # HTTP
ufw allow 443/tcp    # HTTPS
ufw --force enable
echo "Firewall configured"

# ── 4. Fail2ban ──────────────────────────────────────────────────────────────
systemctl enable fail2ban
systemctl start fail2ban

# ── 5. App directory ─────────────────────────────────────────────────────────
mkdir -p /opt/akiscfd/{nginx,frontend/dist,simulations}
cd /opt/akiscfd

# ── 6. Certbot (Let's Encrypt) ───────────────────────────────────────────────
apt-get install -y certbot
echo ""
echo "=== SSL Setup ==="
echo "Run after DNS is pointing to this server:"
echo "  certbot certonly --standalone -d akiscfd.com -d www.akiscfd.com"
echo "Then uncomment the HTTPS block in nginx/nginx.conf"
echo ""

# ── 7. .env.prod template ────────────────────────────────────────────────────
if [ ! -f /opt/akiscfd/.env.prod ]; then
  cat > /opt/akiscfd/.env.prod <<'ENV'
SECRET_KEY=CHANGE_THIS_TO_A_RANDOM_64_CHAR_STRING
CORS_ORIGINS=https://akiscfd.com,https://www.akiscfd.com
FLOWER_AUTH=admin:CHANGE_THIS_PASSWORD
IMAGE_TAG=latest
ENV
  echo ".env.prod template created — fill in SECRET_KEY before starting!"
fi

echo ""
echo "=== Setup complete! ==="
echo "Next steps:"
echo "  1. Fill in /opt/akiscfd/.env.prod"
echo "  2. Add GitHub secrets: HETZNER_HOST, HETZNER_USER, HETZNER_SSH_KEY"
echo "  3. Push to main branch — GitHub Actions will auto-deploy"
echo "  4. (Optional) Run certbot for SSL"

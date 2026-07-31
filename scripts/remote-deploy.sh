#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

: "${ADMIN_PASS:?ADMIN_PASS required}"

echo "==> swap"
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1024
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> packages"
apt-get update -qq
apt-get install -y -qq curl git nginx

echo "==> node"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
node -v
npm -v

echo "==> pm2"
npm install -g pm2

echo "==> app"
mkdir -p /var/www
if [ -d /var/www/navicert/.git ]; then
  cd /var/www/navicert
  git pull --ff-only
else
  git clone https://github.com/Ragnoboy94/navicert.git /var/www/navicert
  cd /var/www/navicert
fi

cat > .env.local <<EOF
ADMIN_PASSWORD=${ADMIN_PASS}
NEXT_PUBLIC_SITE_URL=https://navicert.pro
EOF
chmod 600 .env.local

echo "==> build"
export NODE_OPTIONS=--max-old-space-size=1536
npm ci
npm run build

echo "==> pm2"
pm2 delete navicert 2>/dev/null || true
pm2 start npm --name navicert -- start
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash || true
pm2 save

echo "==> nginx"
cat > /etc/nginx/sites-available/navicert <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name navicert.pro www.navicert.pro 89.22.238.194 _;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/navicert /etc/nginx/sites-enabled/navicert
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx

echo "==> health"
sleep 3
curl -s -o /dev/null -w 'app %{http_code}\n' http://127.0.0.1:3000/
curl -s -o /dev/null -w 'nginx %{http_code}\n' http://127.0.0.1/
echo DEPLOY_OK

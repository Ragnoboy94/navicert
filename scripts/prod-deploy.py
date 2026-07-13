#!/usr/bin/env python3
"""Safe production deploy: preserve content/data/.env.local, add outreach env."""
from __future__ import annotations

import json
import os
import re
import secrets
import sys
import textwrap
from pathlib import Path

try:
    import paramiko
except ImportError:
    print("Installing paramiko...")
    os.system(f"{sys.executable} -m pip install paramiko -q")
    import paramiko

HOST = os.environ.get("DEPLOY_HOST", "89.22.238.194")
USER = os.environ.get("DEPLOY_USER", "root")
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")
APP_DIR = "/var/www/navicert"

# Outreach keys to ensure on prod (values from local .env.local if missing on server)
OUTREACH_DEFAULTS = {
    "OUTREACH_SMTP_HOST": "smtp.yandex.ru",
    "OUTREACH_SMTP_PORT": "587",
    "OUTREACH_SMTP_USER": "a.gromov@navicert-info.ru",
    "OUTREACH_SMTP_FROM": "a.gromov@navicert-info.ru",
    "OUTREACH_TEST_MODE": "false",
    "OUTREACH_TEST_EMAIL": "still-1994@mail.ru",
    "OUTREACH_SENDER_NAME": "Экспертный центр сертификации Нависерт",
    "OUTREACH_FROM_NAME": "Андрей Громов",
    "OUTREACH_SEND_DELAY_MS": "3000",
    "OUTREACH_RECIPIENT_COOLDOWN_DAYS": "7",
    "OUTREACH_ENRICH_BATCH": "50",
    "OUTREACH_CARD_BATCH": "8",
    "OUTREACH_CERT_DURATION": "до 2 месяцев",
    "NEXT_PUBLIC_SITE_URL": "https://navicert.pro",
}


def load_local_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for name in (".env.local", ".env"):
        path = Path.cwd() / name
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def parse_env(text: str) -> tuple[list[str], dict[str, str]]:
    lines = text.splitlines()
    values: dict[str, str] = {}
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        val = value.strip()
        if len(val) >= 2 and val[0] == val[-1] == '"':
            val = val[1:-1].replace('\\"', '"').replace("\\\\", "\\")
        values[key.strip()] = val
    return lines, values


def format_env_value(value: str) -> str:
    if re.search(r'[\s#"\\]', value):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return value


def merge_env(existing: str, local: dict[str, str]) -> str:
    lines, values = parse_env(existing)
    changed = False

    def set_key(key: str, value: str, force: bool = False) -> None:
        nonlocal changed
        if not value:
            return
        if key in values and values[key] and not force:
            return
        if values.get(key) != value:
            values[key] = value
            changed = True

    # Never overwrite prod secrets if already set
    for key, default in OUTREACH_DEFAULTS.items():
        set_key(key, local.get(key) or default)

    # Секреты и прод-only ключи: дописываем с локали только если на сервере пусто.
    # OUTREACH_FSA_PROXY сюда НЕ входит — на проде (Стокгольм) прокси обязателен и
    # настраивается только на сервере (setup-proxy6 / refresh-fsa-proxy). Локально (РФ) — не задавать.
    for key in (
        "OUTREACH_SMTP_PASS",
        "OUTREACH_UNSUBSCRIBE_SECRET",
        "OUTREACH_CRON_SECRET",
        "OUTREACH_SMTP_PROXY",
        "PROXY6_API_KEY",
        "FSA_BEARER_TOKEN",
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_CHAT_ID",
        "SMTP_PASS",
        "ADMIN_PASSWORD",
        "NEXT_PUBLIC_CHAPORT_APP_ID",
    ):
        if local.get(key):
            set_key(key, local[key])

    set_key("NEXT_PUBLIC_SITE_URL", "https://navicert.pro", force=True)

    if not values.get("OUTREACH_UNSUBSCRIBE_SECRET"):
        set_key("OUTREACH_UNSUBSCRIBE_SECRET", secrets.token_hex(24), force=True)

    if not values.get("OUTREACH_CRON_SECRET"):
        set_key("OUTREACH_CRON_SECRET", secrets.token_urlsafe(32), force=True)

    if not changed:
        return existing

    preserved_comments: list[str] = []
    seen: set[str] = set()
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#"):
            preserved_comments.append(line)
            continue
        if "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in values:
                seen.add(key)

    out: list[str] = []
    out.extend(preserved_comments)
    if preserved_comments:
        out.append("")
    out.append("# --- managed keys (deploy merge) ---")
    for key in sorted(values):
        out.append(f"{key}={format_env_value(values[key])}")
    return "\n".join(out).rstrip() + "\n"


def safe_print(text: str) -> None:
    sys.stdout.buffer.write((text.rstrip() + "\n").encode("utf-8", errors="replace"))


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str, str]:
    print(f"\n$ {cmd[:120]}{'...' if len(cmd) > 120 else ''}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out.strip():
        safe_print(out)
    if err.strip():
        sys.stderr.buffer.write(err.rstrip().encode("utf-8", errors="replace") + b"\n")
    return code, out, err


def main() -> int:
    local = load_local_env()
    password = os.environ.get("DEPLOY_PASSWORD", "") or local.get("DEPLOY_PASSWORD", "")
    if not password:
        print("Set DEPLOY_PASSWORD env var", file=sys.stderr)
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {HOST}...")
    client.connect(HOST, username=USER, password=password, timeout=30)

    code, out, _ = run(client, f"test -d {APP_DIR} && echo OK || echo MISSING")
    if "MISSING" in out:
        print("App directory missing", file=sys.stderr)
        return 1

    deploy_script = textwrap.dedent(
        f"""
        set -euo pipefail
        cd {APP_DIR}
        BK="/var/backups/navicert-$(date -u +%Y%m%d-%H%M%S)"
        PERSIST="/var/www/navicert-persist"
        mkdir -p "$BK" "$PERSIST/content" "$PERSIST/images/uploads" "$PERSIST/images/articles"

        # Пользовательский контент вне git (CONTENT_DIR на проде)
        mkdir -p "$PERSIST/content"
        if [ -L content ]; then
          cp -a "$(readlink -f content)/." "$BK/content/"
        elif [ -d content ]; then
          mkdir -p "$BK/content"
          cp -a content/. "$BK/content/"
          rsync -a content/ "$PERSIST/content/"
        fi
        test -f data/leads.json && cp -a data/leads.json "$BK/" || true
        test -d data && cp -a data "$BK/data-snapshot" || true
        test -d public/images/uploads && cp -a public/images/uploads "$BK/" || true
        test -d public/images/articles && cp -a public/images/articles "$BK/article-images" || true
        cp -a .env.local "$BK/"
        echo "backup: $BK"

        python3 -c "import json, pathlib
for name in ('services.json', 'categories.json', 'site.json'):
    p = pathlib.Path('content') / name
    if p.exists():
        data = json.loads(p.read_text(encoding='utf-8'))
        count = len(data) if isinstance(data, list) else 1
        print('%s\\t%s' % (name, count))
" > "$BK/counts.txt"
        cat "$BK/counts.txt"

        # content/ и leads — только из бэкапа, не трогаем git checkout (теряются правки с прода)
        rm -f scripts/prod-deploy.py src/lib/outreach/fsa-network.ts src/lib/outreach/fsa-proxy-shared.ts src/lib/outreach/smtp-transport.ts 2>/dev/null || true
        rm -f scripts/outreach/fsa-proxy-shared.mjs scripts/outreach/test-fsa-access.ts scripts/outreach/test-fsa-access.mjs 2>/dev/null || true
        git fetch origin main
        git reset --hard origin/main
        git pull --ff-only origin main

        # git pull — content/ из репо только для сборки; runtime читает CONTENT_DIR
        rm -rf content
        git checkout HEAD -- content/ 2>/dev/null || true
        mkdir -p "$PERSIST/content"
        cp -a "$BK/content/." "$PERSIST/content/"
        rsync -a "$PERSIST/content/" content/
        test -f content/articles.json || printf '[]\\n' > content/articles.json
        cp -a content/articles.json "$PERSIST/content/articles.json" 2>/dev/null || true
        cp -a "$BK/.env.local" .env.local
        if grep -q '^CONTENT_DIR=' .env.local; then
          sed -i "s|^CONTENT_DIR=.*|CONTENT_DIR=$PERSIST/content|" .env.local
        else
          echo "CONTENT_DIR=$PERSIST/content" >> .env.local
        fi
        test -f "$BK/leads.json" && cp -a "$BK/leads.json" data/leads.json || true
        if [ -d "$BK/data-snapshot" ]; then
          mkdir -p data
          for f in outreach-sent.json outreach-unsubscribed.json outreach-schedule.json outreach-queue.json fsa-token.json; do
            test -f "$BK/data-snapshot/$f" && cp -a "$BK/data-snapshot/$f" "data/$f" || true
          done
        fi
        if [ -d "$BK/uploads" ]; then
          mkdir -p "$PERSIST/images/uploads"
          cp -a "$BK/uploads/." "$PERSIST/images/uploads/"
        fi
        if [ -d "$BK/article-images" ]; then
          mkdir -p "$PERSIST/images/articles"
          cp -a "$BK/article-images/." "$PERSIST/images/articles/"
        fi
        mkdir -p public/images
        for sub in uploads articles; do
          if [ -d "public/images/$sub" ] && [ ! -L "public/images/$sub" ]; then
            rsync -a "public/images/$sub/" "$PERSIST/images/$sub/" 2>/dev/null || true
            rm -rf "public/images/$sub"
          fi
          if [ ! -e "public/images/$sub" ]; then
            ln -sfn "$PERSIST/images/$sub" "public/images/$sub"
          fi
        done
        chmod -R u+rwX "$PERSIST/images"

        python3 -c "import json, pathlib, sys
bk = pathlib.Path('$BK')
counts_path = bk / 'counts.txt'
if not counts_path.exists():
    print('skip content verify: no counts.txt')
else:
    before = dict(line.split('\\t') for line in counts_path.read_text().strip().splitlines())
    ok = True
    for name, count in before.items():
        p = pathlib.Path('content') / name
        raw = json.loads(p.read_text(encoding='utf-8'))
        now = len(raw) if isinstance(raw, list) else 1
        print('%s: backup %s -> now %s' % (name, count, now))
        if str(now) != count:
            ok = False
            print('RESTORE_MISMATCH %s backup=%s now=%s' % (name, count, now), file=sys.stderr)
    if not ok:
        sys.exit(1)
    print('content restore OK')
"

        export NODE_OPTIONS=--max-old-space-size=1536
        npm ci
        npm run outreach:setup
        npm run build
        pm2 restart navicert --update-env
        pm2 save
        echo "DEPLOY_OK $(git log -1 --oneline)"
        """
    ).strip()

    sftp = client.open_sftp()
    remote_script = "/tmp/navicert-deploy.sh"
    with sftp.file(remote_script, "w") as f:
        f.write(deploy_script)
    sftp.chmod(remote_script, 0o755)
    sftp.close()

    # Read prod env, merge, upload
    sftp = client.open_sftp()
    remote_env = f"{APP_DIR}/.env.local"
    try:
        with sftp.file(remote_env, "r") as f:
            prod_env = f.read().decode("utf-8")
    except FileNotFoundError:
        prod_env = ""
    merged = merge_env(prod_env, local)
    with sftp.file(remote_env, "w") as f:
        f.write(merged)
    sftp.chmod(remote_env, 0o600)
    sftp.close()
    print("Merged .env.local (preserved existing secrets)")

    code, out, err = run(client, f"bash {remote_script}", timeout=900)
    if code != 0:
        print("Deploy failed", file=sys.stderr)
        return code

    run(client, "curl -s -o /dev/null -w 'local:%{http_code}\\n' http://127.0.0.1:3000/")
    run(client, "curl -s -o /dev/null -w 'nginx:%{http_code}\\n' http://127.0.0.1/")
    run(
        client,
        f"grep -E '^OUTREACH_FSA_PROXY=.+' {APP_DIR}/.env.local >/dev/null && echo 'FSA proxy: set (prod)' || echo 'WARNING: OUTREACH_FSA_PROXY missing on prod — FSA will fail from Stockholm'",
    )

    nginx_patch = textwrap.dedent(
        """
        NGINX=/etc/nginx/sites-available/navicert
        if [ -f "$NGINX" ] && ! grep -q 'client_max_body_size' "$NGINX"; then
          sed -i '/server_name /a\\    client_max_body_size 10m;' "$NGINX"
          nginx -t && systemctl reload nginx
          echo "nginx: client_max_body_size 10m added"
        elif [ -f "$NGINX" ]; then
          echo "nginx: client_max_body_size already set"
        else
          echo "nginx: site config missing"
        fi
        """
    ).strip()
    run(client, nginx_patch)

    cron_wrapper = textwrap.dedent(
        f"""
        cat > /usr/local/bin/navicert-outreach-cron <<'EOF'
        #!/bin/bash
        set -euo pipefail
        ENV_FILE="{APP_DIR}/.env.local"
        SECRET=$(grep -E '^OUTREACH_CRON_SECRET=' "$ENV_FILE" | cut -d= -f2- || true)
        if [ -z "$SECRET" ]; then exit 0; fi
        curl -fsS -X POST -H "Authorization: Bearer $SECRET" http://127.0.0.1:3000/api/outreach/cron >/dev/null
        EOF
        chmod +x /usr/local/bin/navicert-outreach-cron

        cat > /usr/local/bin/navicert-refresh-fsa-proxy <<'EOF'
        #!/bin/bash
        set -euo pipefail
        cd {APP_DIR}
        export OUTREACH_ENV_FILE="{APP_DIR}/.env.local"
        LOG=/var/log/navicert-refresh-proxy.log
        node scripts/outreach/refresh-fsa-proxy.mjs >>"$LOG" 2>&1 || {{
          code=$?
          if [ "$code" -eq 2 ]; then
            pm2 restart navicert --update-env >>"$LOG" 2>&1
          elif [ "$code" -ne 0 ]; then
            exit "$code"
          fi
        }}
        EOF
        chmod +x /usr/local/bin/navicert-refresh-fsa-proxy

        (crontab -l 2>/dev/null | grep -v navicert-outreach-cron | grep -v navicert-refresh-fsa-proxy; \\
         echo '*/20 * * * * /usr/local/bin/navicert-outreach-cron # navicert-outreach-cron'; \\
         echo '15 4 * * * /usr/local/bin/navicert-refresh-fsa-proxy # navicert-refresh-fsa-proxy') | crontab -
        crontab -l | grep -E 'navicert-outreach-cron|navicert-refresh-fsa-proxy' || true
        """
    ).strip()
    run(client, cron_wrapper)

    client.close()
    print("\nProduction deploy finished.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

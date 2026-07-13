#!/usr/bin/env python3
import os, sys
try:
    import paramiko
except ImportError:
    os.system(f"{sys.executable} -m pip install paramiko -q")
    import paramiko

PWD = os.environ.get("DEPLOY_PASSWORD", "")
cmds = [
    "grep -r 'marketpleysov\\|sertifikatsiya-tovarov\\|novaya-statya' /var/www/navicert-persist /var/www/navicert/content /var/backups/navicert-20260713-* 2>/dev/null | head -30",
    "find /var/www/navicert -name 'articles.json' -exec ls -la {} \\; 2>/dev/null",
    "for f in /var/backups/navicert-20260713-*/content/articles.json; do echo === $f ===; wc -c $f; cat $f; done 2>/dev/null",
    "pm2 logs navicert --lines 200 --nostream 2>&1 | grep -iE 'articles|content|PUT|save' | tail -30",
    "ls -la /var/www/navicert-persist/content/",
]
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("89.22.238.194", username="root", password=PWD, timeout=30)
for cmd in cmds:
    print("\n$", cmd[:80])
    _, o, e = c.exec_command(cmd, timeout=60)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    if out: print(out)
    if err: print(err)
c.close()

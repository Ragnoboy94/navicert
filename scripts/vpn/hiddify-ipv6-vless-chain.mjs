#!/usr/bin/env node
/**
 * sing-box config: IPv6 Proxy6 SOCKS5 → VLESS REALITY (x-ui on AEZA).
 * Import in Hiddify: Settings → Custom config / sing-box JSON.
 *
 * Env overrides:
 *   IPV6_PROXY_HOST, IPV6_PROXY_PORT, IPV6_PROXY_USER, IPV6_PROXY_PASS
 *   VLESS_SERVER (default AEZA IPv4), VLESS_PORT, VLESS_UUID, VLESS_PBK, VLESS_SID, VLESS_SNI
 */
const proxyHost = process.env.IPV6_PROXY_HOST?.trim();
const proxyPort = Number(process.env.IPV6_PROXY_PORT || 10768);
const proxyUser = process.env.IPV6_PROXY_USER?.trim();
const proxyPass = process.env.IPV6_PROXY_PASS?.trim();

if (!proxyHost || !proxyUser || !proxyPass) {
  console.error(
    "Set IPV6_PROXY_HOST, IPV6_PROXY_USER, IPV6_PROXY_PASS (and optionally IPV6_PROXY_PORT)"
  );
  process.exit(1);
}

const vlessServer = process.env.VLESS_SERVER || "89.22.238.194";
const vlessPort = Number(process.env.VLESS_PORT || 39832);
const vlessUuid = process.env.VLESS_UUID || "8b470ab5-21c2-424a-b29c-7a052efa54d5";
const vlessPbk = process.env.VLESS_PBK || "f1WpnQJin2Z7TxyXvem8dUOQgA7D1KNMWNuBc5wZBl0";
const vlessSid = process.env.VLESS_SID || "eb70e8f342e1";
const vlessSni = process.env.VLESS_SNI || "web.max.ru";

const config = {
  log: { level: "warn" },
  dns: {
    servers: [
      { type: "udp", tag: "dns-remote", server: "1.1.1.1", detour: "proxy" },
      { type: "local", tag: "dns-direct" },
    ],
    rules: [{ outbound: "any", server: "dns-direct" }],
    final: "dns-remote",
  },
  inbounds: [
    {
      type: "mixed",
      tag: "mixed-in",
      listen: "127.0.0.1",
      listen_port: 10808,
    },
  ],
  outbounds: [
    {
      type: "socks",
      tag: "ipv6-gw",
      server: proxyHost,
      server_port: proxyPort,
      version: "5",
      username: proxyUser,
      password: proxyPass,
    },
    {
      type: "vless",
      tag: "proxy",
      server: vlessServer,
      server_port: vlessPort,
      uuid: vlessUuid,
      packet_encoding: "xudp",
      tls: {
        enabled: true,
        server_name: vlessSni,
        utls: { enabled: true, fingerprint: "chrome" },
        reality: {
          enabled: true,
          public_key: vlessPbk,
          short_id: vlessSid,
        },
      },
      detour: "ipv6-gw",
    },
    { type: "direct", tag: "direct" },
    { type: "block", tag: "block" },
  ],
  route: {
    rules: [{ ip_is_private: true, outbound: "direct" }],
    final: "proxy",
  },
};

process.stdout.write(JSON.stringify(config, null, 2));

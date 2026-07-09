#!/usr/bin/env node
/**
 * Minimal vless:// → sing-box config (SOCKS 127.0.0.1:10808 → VLESS outbound).
 * Usage: OUTREACH_VLESS_URI='vless://...' node scripts/outreach/vless-uri-to-singbox.mjs > outreach.json
 */
const uri = process.env.OUTREACH_VLESS_URI?.trim();
if (!uri?.startsWith("vless://")) {
  console.error("OUTREACH_VLESS_URI must start with vless://");
  process.exit(1);
}

const u = new URL(uri);
const uuid = decodeURIComponent(u.username);
const server = u.hostname;
const server_port = Number(u.port || 443);
const p = u.searchParams;
const name = decodeURIComponent(u.hash.replace(/^#/, "") || "vless");

const security = p.get("security") || "none";
const network = p.get("type") || "tcp";
const flow = p.get("flow") || "";

const outbound = {
  type: "vless",
  tag: "proxy",
  server,
  server_port,
  uuid,
};

if (flow) outbound.flow = flow;

if (network === "ws") {
  outbound.transport = {
    type: "ws",
    path: p.get("path") || "/",
    headers: p.get("host") ? { Host: p.get("host") } : undefined,
  };
} else if (network === "grpc") {
  outbound.transport = {
    type: "grpc",
    service_name: p.get("serviceName") || p.get("path") || "",
  };
}

if (security === "tls" || security === "reality") {
  outbound.tls = {
    enabled: true,
    server_name: p.get("sni") || server,
    utls: { enabled: true, fingerprint: p.get("fp") || "chrome" },
  };
  if (security === "reality") {
    outbound.tls.reality = {
      enabled: true,
      public_key: p.get("pbk") || "",
      short_id: p.get("sid") || "",
    };
  }
}

const config = {
  log: { level: "warn" },
  inbounds: [
    {
      type: "mixed",
      tag: "mixed-in",
      listen: "127.0.0.1",
      listen_port: 10808,
    },
  ],
  outbounds: [
    outbound,
    { type: "direct", tag: "direct" },
    { type: "block", tag: "block" },
  ],
  route: {
    final: "proxy",
  },
};

process.stdout.write(JSON.stringify(config, null, 2));

#!/usr/bin/env node
import { readFileSync } from "fs";
import { resolve } from "path";
import { SocksClient } from "socks";
import tls from "tls";

function env(name) {
  const text = readFileSync(resolve(import.meta.dirname, "../../.env.local"), "utf8");
  const m = text.match(new RegExp(`^${name}=(.+)$`, "m"));
  return m?.[1]?.trim();
}

const proxyRaw = env("OUTREACH_SMTP_PROXY");
const proxyUrl = new URL(proxyRaw.includes("://") ? proxyRaw : `socks5://${proxyRaw}`);

const { socket } = await SocksClient.createConnection({
  proxy: { host: proxyUrl.hostname, port: Number(proxyUrl.port || "1080"), type: 5 },
  command: "connect",
  destination: { host: "smtp.yandex.ru", port: 587 },
  timeout: 20_000,
});

socket.setEncoding("utf8");
let buf = "";
socket.on("data", (d) => { buf += d; console.log("data:", JSON.stringify(d.slice(0, 120))); });
await new Promise((r) => setTimeout(r, 2000));
console.log("greeting:", buf.slice(0, 200));

socket.write("EHLO navicert.test\r\n");
await new Promise((r) => setTimeout(r, 2000));
console.log("after ehlo:", buf.slice(0, 400));

const secure = tls.connect({ socket, servername: "smtp.yandex.ru", minVersion: "TLSv1.2" });
secure.setEncoding("utf8");
secure.on("data", (d) => console.log("tls:", JSON.stringify(d.slice(0, 120))));
await new Promise((resolve, reject) => {
  secure.once("secureConnect", resolve);
  secure.once("error", reject);
  setTimeout(() => reject(new Error("tls timeout")), 15000);
});
console.log("tls ok");
secure.write("EHLO navicert.test\r\n");
await new Promise((r) => setTimeout(r, 2000));
socket.end();

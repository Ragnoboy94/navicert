#!/usr/bin/env node
/**
 * Настройка OUTREACH_FSA_PROXY через Proxy6 (IPv4 RU).
 * Нужны: PROXY6_API_KEY в .env.local и баланс на proxy6.net
 *
 * Run: node scripts/outreach/setup-proxy6.mjs
 */
import { config } from "dotenv";
import fs from "fs";
import path from "path";

config({ path: path.join(process.cwd(), ".env.local") });
config({ path: path.join(process.cwd(), ".env") });

const API_KEY = process.env.PROXY6_API_KEY?.trim();
const DESCR = "navicert-fsa";
const API = "https://px6.link/api";

if (!API_KEY) {
  console.error("Задайте PROXY6_API_KEY в .env.local (proxy6.net → API)");
  process.exit(1);
}

async function api(method, params = {}) {
  const url = new URL(`${API}/${API_KEY}/${method}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url);
  const json = await response.json();
  if (json.status !== "yes") {
    throw new Error(json.error || json.error_id || `Proxy6 ${method} failed`);
  }
  return json;
}

function proxyUrl(entry) {
  const host = entry.host || entry.ip;
  const port = entry.port;
  const user = entry.user;
  const pass = entry.pass;
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
}

function upsertEnv(key, value) {
  const envPath = path.join(process.cwd(), ".env.local");
  let lines = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf-8").split(/\r?\n/)
    : [];
  let found = false;
  lines = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) lines.push(`${key}=${value}`);
  fs.writeFileSync(envPath, lines.join("\n").replace(/\n?$/, "\n"));
}

const existing = await api("getproxy", { descr: DESCR });
let list = Object.values(existing.list || {});

if (!list.length) {
  const price = await api("getprice", {
    count: 1,
    period: 30,
    country: "ru",
    version: 4,
  });
  console.log(`Покупаем IPv4 RU на 30 дней: ${price.price} ${price.currency || "RUB"}`);
  const bought = await api("buy", {
    count: 1,
    period: 30,
    country: "ru",
    version: 4,
    descr: DESCR,
    auto_prolong: "",
  });
  list = Object.values(bought.list || {});
}

const active = list.find((item) => Number(item.active) === 1) || list[0];
if (!active) {
  console.error("Proxy6 не вернул активный прокси");
  process.exit(1);
}

const url = proxyUrl(active);
upsertEnv("OUTREACH_FSA_PROXY", url);
console.log("OUTREACH_FSA_PROXY записан в .env.local");
console.log(`host: ${active.host}:${active.port}, id: ${active.id}`);

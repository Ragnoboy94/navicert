/**
 * Офлайн-проверка парсеров на сохранённом HTML (без сети).
 * Запуск: npm run outreach:test-checko-offline
 */
import fs from "fs";
import path from "path";
import {
  parseCheckoCompanyPage,
  parseCheckoSearchPage,
} from "../../src/lib/outreach/checko";

const fixtures = path.join(
  process.cwd(),
  "scripts",
  "outreach",
  "fixtures",
  "checko"
);

function mustRead(file: string) {
  const full = path.join(fixtures, file);
  if (!fs.existsSync(full)) throw new Error(`Нет фикстуры: ${full}`);
  return fs.readFileSync(full, "utf8");
}

const listHtml = mustRead("search-advanced.html");
const coHtml = mustRead("company-tsp-msk.html");

const page = parseCheckoSearchPage(listHtml, 1);
console.log("list", {
  total: page.total,
  from: page.from,
  to: page.to,
  items: page.items.length,
  first: page.items[0],
});
if (page.total < 1000 || page.items.length < 10) {
  throw new Error("list parse failed");
}

const co = parseCheckoCompanyPage(coHtml, "/company/tsp-msk-1267700215441");
console.log("company", {
  ogrn: co.ogrn,
  inn: co.inn,
  name: co.shortName,
  email: co.email,
  emails: co.emails,
  reg: co.registrationDateRu,
  okved: co.okved,
});
if (co.ogrn !== "1267700215441") throw new Error("ogrn");
if (co.email !== "mischenko.mv@kpugs.ru") throw new Error("email");
if (!co.shortName) throw new Error("name");
if (
  co.okved !==
  "71.12.2 — Деятельность заказчика-застройщика, генерального подрядчика"
) {
  throw new Error(`okved: ${co.okved}`);
}
if (/span>|</i.test(co.okved || "")) throw new Error("okved has html junk");

const multiHtml = `
<h1 id="cn">ООО ОСФАРМ</h1>
<strong id="copy-ogrn">1261500002796</strong>
<strong id="copy-inn">1500000000</strong>
Электронная почта</strong>
<a class="link" href="mailto:osfarm@minzdrav.alania.gov.ru">a</a>
<a class="link" href="mailto:osfmarmmedtekh@mail.ru">b</a>
<strong class="fw-700 d-block mt-3 mb-1">Веб-сайт
`;
const multi = parseCheckoCompanyPage(
  multiHtml,
  "/company/osfarm-1261500002796"
);
console.log("multi", multi.emails, "first", multi.email);
if (multi.email !== "osfarm@minzdrav.alania.gov.ru") {
  throw new Error("first email");
}
if (multi.emails.length !== 2) throw new Error("emails count");

console.log("offline ok");

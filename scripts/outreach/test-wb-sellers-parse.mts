/**
 * Проверка блоков 4-й рассылки: разбор карточки WB (офлайн) + поиск checko по ИНН.
 * Запуск: npx tsx scripts/outreach/test-wb-sellers-parse.mts
 */
import {
  applyWbSupplierJson,
  parseWbSellerHtml,
  rememberWbSeller,
  wasWbInnSearchedOnChecko,
  wasWbSellerSearched,
  wbSellerToDeclaration,
} from "../../src/lib/outreach/wb-sellers";
import { lookupCheckoCompanyByInn } from "../../src/lib/outreach/checko";
import { parseOutreachCategory } from "../../src/lib/outreach/category";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const htmlWithEmail = `
<h1>ООО ТЕСТМАРКЕТ</h1>
<div>ИНН 7707083893</div>
<div>ОГРН 1027700132195</div>
<a href="mailto:sales@testmarket.example">sales@testmarket.example</a>
<a href="mailto:captcha-support@rwb.ru">skip</a>
`;

const htmlInnOnly = `
<h1>ИП Иванов</h1>
<span>ИНН 7707083893</span>
<p>ОГРН 1027700132195</p>
`;

const withEmail = parseWbSellerHtml(htmlWithEmail, "1418867");
assert(withEmail.name?.includes("ТЕСТМАРКЕТ"), "name from h1");
assert(withEmail.inn === "7707083893", "inn");
assert(withEmail.email === "sales@testmarket.example", "first email, skip wb support");
assert(withEmail.emails.length === 1, "wb support email ignored");

const innOnly = parseWbSellerHtml(htmlInnOnly, "999001");
assert(innOnly.email === undefined, "no email on card");
assert(innOnly.inn === "7707083893", "inn without email");

const fromJson = applyWbSupplierJson(parseWbSellerHtml("<h1>Все товары</h1>", "4007486"), {
  supplierFullName:
    "Индивидуальный предприниматель Шестопалова Татьяна Петровна",
  inn: "744411075501",
  ogrnip: "324745600012882",
  trademark: "SHEGEN",
});
assert(fromJson.name === "ИП Шестопалова Т. П." || fromJson.name?.includes("Шестопалова"), "legal/short name");
assert(fromJson.inn === "744411075501", "inn from supplier json");
assert(fromJson.ogrn === "324745600012882", "ogrnip from supplier json");
assert(
  fromJson.legalName?.includes("Шестопалова"),
  "legal name from supplier json"
);

const doc = wbSellerToDeclaration(withEmail);
assert(doc.applicant.email === "sales@testmarket.example", "declaration email");
assert(doc.number === "1418867", "seller id as number field");
assert(parseOutreachCategory("wb_sellers") === "wb_sellers", "category parser");
assert(parseOutreachCategory("unknown") === "expiring", "unknown stays FSA");

rememberWbSeller({
  sellerId: "1418867",
  inn: "0000000000",
  searchedWbAt: new Date().toISOString(),
  searchedCheckoAt: new Date().toISOString(),
});
assert(wasWbSellerSearched("1418867"), "seen by seller id");
assert(wasWbInnSearchedOnChecko("0000000000"), "seen by inn");

console.log("offline wb parse ok");

if (process.env.WB_SKIP_CHECKO === "1") {
  console.log("skip live checko");
  process.exit(0);
}

const company = await lookupCheckoCompanyByInn("7707083893");
assert(company, "checko by inn returned company");
assert(company.inn === "7707083893", "checko inn");
assert(company.email, "checko email present");
console.log("checko inn lookup ok", {
  name: company.shortName,
  email: company.email,
  url: company.url,
});

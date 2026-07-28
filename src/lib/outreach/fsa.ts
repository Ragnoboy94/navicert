import type { FsaApplicant, FsaDeclaration, OutreachSearchFilter } from "./types";
import { fsaApiRequest } from "./fsa-connection";

const FSA_BASE = "https://pub.fsa.gov.ru";

type JsonRecord = Record<string, unknown>;

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function pickString(
  record: JsonRecord | null | undefined,
  keys: string[]
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return undefined;
}

function formatRuDate(value: unknown): string {
  const raw = asString(value);
  if (!raw) return "";
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) return raw;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

function pickEmailFromContacts(contacts: unknown): string | undefined {
  if (!Array.isArray(contacts)) return undefined;
  for (const entry of contacts) {
    const record = entry as JsonRecord;
    const email = pickString(record, [
      "email",
      "emailAddress",
      "contactEmail",
      "value",
    ]);
    if (email?.includes("@")) return email;
  }
  return undefined;
}

function findEmailDeep(value: unknown, depth = 0): string | undefined {
  if (depth > 8 || value == null) return undefined;

  if (typeof value === "string") {
    const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match?.[0]?.trim().toLowerCase();
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findEmailDeep(entry, depth + 1);
      if (found) return found;
    }
    return undefined;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const [key, nested] of Object.entries(record)) {
      if (/email|mail/i.test(key) && typeof nested === "string" && nested.includes("@")) {
        return nested.trim().toLowerCase();
      }
    }
    for (const nested of Object.values(record)) {
      const found = findEmailDeep(nested, depth + 1);
      if (found) return found;
    }
  }

  return undefined;
}

function applicantFromRecord(record: JsonRecord): FsaApplicant {
  const nested =
    (record.applicant as JsonRecord | undefined) ||
    (record.applicantLegalEntity as JsonRecord | undefined) ||
    (record.declarant as JsonRecord | undefined) ||
    (record.certificateApplicant as JsonRecord | undefined) ||
    (record.certificateHolder as JsonRecord | undefined) ||
    (record.holder as JsonRecord | undefined) ||
    {};

  const emailFromContacts =
    pickEmailFromContacts(nested.responsibleContacts) ||
    pickEmailFromContacts(nested.contacts) ||
    pickEmailFromContacts(record.responsibleContacts);

  return {
    type: pickString(nested, ["applicantType", "type", "declarantType"]),
    ogrn: pickString(nested, ["ogrn", "ogrnUl"]),
    inn: pickString(nested, ["inn", "innUl"]),
    fullName:
      pickString(nested, [
      "fullName",
      "legalEntityFullName",
      "name",
      "applicantName",
      ]) ||
      pickString(record, ["applicantName", "fullName", "declarantName"]),
    shortName:
      pickString(nested, [
      "shortName",
      "legalEntityShortName",
      "shortApplicantName",
      ]) || pickString(record, ["applicantShortName", "shortName"]),
    headLastName: pickString(nested, ["headLastName", "directorLastName"]),
    headFirstName: pickString(nested, ["headFirstName", "directorFirstName"]),
    headPatronymic: pickString(nested, [
      "headPatronymic",
      "directorPatronymic",
    ]),
    headPosition: pickString(nested, ["headPosition", "directorPosition"]),
    address: pickString(nested, ["address", "locationAddress", "legalAddress"]),
    phone:
      pickString(nested, ["phone", "phoneNumber", "contactPhone"]) ||
      pickString(record, ["phone", "phoneNumber", "contactPhone"]),
    email:
      pickString(nested, [
        "email",
        "emailAddress",
        "contactEmail",
        "eMail",
        "mail",
      ]) ||
      pickString(record, ["email", "emailAddress", "contactEmail", "eMail"]) ||
      pickString(record.applicantLegalEntity as JsonRecord | undefined, [
        "email",
        "emailAddress",
        "contactEmail",
      ]) ||
      emailFromContacts ||
      findEmailDeep(nested) ||
      findEmailDeep(record),
  };
}

function declarationFromRecord(record: JsonRecord): FsaDeclaration | null {
  const id = asNumber(record.id ?? record.declarationId);
  if (!id) return null;

  const number =
    pickString(record, [
      "number",
      "declNumber",
      "declarationNumber",
      "declRegNumber",
    ]) || `ID ${id}`;

  const applicant = applicantFromRecord(record);
  const productName =
    pickString(record, [
      "productName",
      "productFullName",
      "productIdentificationName",
      "product",
    ]) || "продукция";

  return {
    id,
    number,
    registrationDate: formatRuDate(
      record.registrationDate ?? record.declDate ?? record.regDate
    ),
    endDate: formatRuDate(
      record.endDate ?? record.declEndDate ?? record.validityEndDate
    ),
    status:
      pickString(record, ["status", "statusName", "declStatus"]) || "unknown",
    applicant,
    productName,
    productGroup: pickString(record, [
      "productGroup",
      "productType",
      "tnvedGroup",
    ]),
    registryUrl: declarationApplicantUrl(id),
  };
}

function extractItems(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload as JsonRecord[];

  const record = payload as JsonRecord;
  const candidates = [
    record.items,
    record.content,
    record.data,
    record.declarations,
    record.certificates,
    record.rows,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as JsonRecord[];
  }

  return [];
}

function certificateFromRecord(record: JsonRecord): FsaDeclaration | null {
  // Считаем структуру карточки сертификата максимально схожей с декларацией:
  // отличия — пути ссылок и возможные ключи для номера/регистрационных дат.
  const id =
    asNumber(
      record.id ??
        record.certificateId ??
        record.certId ??
        record.certificate_number_id ??
        record.certNumberId
    ) ?? null;
  if (!id) return null;

  const number =
    pickString(record, [
      "certificateNumber",
      "certNumber",
      "certRegNumber",
      "certificate_reg_number",
      "number",
      "declNumber",
    ]) || `ID ${id}`;

  const applicant = applicantFromRecord(record);

  const productName =
    pickString(record, [
      "productName",
      "productFullName",
      "productIdentificationName",
      "product",
    ]) || "продукция";

  return {
    id,
    number,
    registrationDate: formatRuDate(
      record.registrationDate ??
        record.certRegistrationDate ??
        record.certificateRegistrationDate ??
        record.regDate
    ),
    endDate: formatRuDate(
      record.endDate ??
        record.certEndDate ??
        record.certificateEndDate ??
        record.validityEndDate ??
        record.declEndDate
    ),
    status:
      pickString(record, ["status", "statusName", "certStatus"]) || "unknown",
    applicant,
    productName,
    productGroup: pickString(record, [
      "productGroup",
      "productType",
      "tnvedGroup",
    ]),
    registryUrl: certificateApplicantUrl(id),
  };
}

export function normalizeDeclaration(declaration: FsaDeclaration): FsaDeclaration {
  return {
    ...declaration,
    applicant: declaration.applicant ?? {},
    registryUrl:
      declaration.registryUrl ||
      `${FSA_BASE}/rds/declaration/view/${declaration.id}/applicant`,
  };
}

export function declarationApplicantUrl(id: number): string {
  return `${FSA_BASE}/rds/declaration/view/${id}/applicant`;
}

export function normalizeCertificate(
  certificate: FsaDeclaration
): FsaDeclaration {
  // Тип технически тот же (общая форма карточки), но ссылки должны вести на сертификат.
  return {
    ...certificate,
    applicant: certificate.applicant ?? {},
    registryUrl:
      certificate.registryUrl ||
      certificateApplicantUrl(certificate.id),
  };
}

export function certificateApplicantUrl(id: number): string {
  // Реестр сертификатов — RSS (не RDS, как у деклараций)
  return `${FSA_BASE}/rss/certificate/view/${id}/applicant`;
}

export async function fetchDeclaration(
  id: number,
  token?: string
): Promise<FsaDeclaration> {
  const payload = await fsaApiRequest<unknown>(
    "GET",
    `/api/v1/rds/common/declarations/${id}`,
    undefined,
    { tokenOverride: token }
  );

  const record =
    (payload as JsonRecord).data && typeof (payload as JsonRecord).data === "object"
      ? ((payload as JsonRecord).data as JsonRecord)
      : (payload as JsonRecord);

  const declaration = declarationFromRecord(record);
  if (!declaration) {
    throw new Error(`Не удалось разобрать декларацию ${id}`);
  }
  return normalizeDeclaration(declaration);
}

export async function searchExpiringDeclarations(
  filter: OutreachSearchFilter,
  token?: string
): Promise<FsaDeclaration[]> {
  const payload = await fsaApiRequest<unknown>(
    "POST",
    "/api/v1/rds/common/declarations/get",
    {
      size: filter.size ?? 50,
      page: filter.page ?? 0,
      filter: {
        endDate: {
          minDate: `${filter.endDateFrom}T00:00:00.000Z`,
          maxDate: `${filter.endDateTo}T23:59:59.999Z`,
        },
      },
      columnsSearch: [],
      sort: filter.sort?.length ? filter.sort : ["endDate"],
    },
    {
      tokenOverride: token,
      // Список: короче таймаут, меньше вложенных ретраев — страницы крутит bulkLoadList
      timeoutMs: 25_000,
      fetchRetries: 1,
      maxAttempts: 2,
    }
  );

  return extractItems(payload)
    .map(declarationFromRecord)
    .filter((item): item is FsaDeclaration => Boolean(item))
    .map(normalizeDeclaration);
}

/** Данные тестовой декларации 15978080 — для отладки без токена ФСА */
export function getTestDeclaration(): FsaDeclaration {
  return {
    id: 15978080,
    number: "ЕАЭС N RU Д-RU.РА01.В.42206/21",
    registrationDate: "29.07.2021",
    endDate: "30.07.2026",
    status: "Действует",
    applicant: {
      type: "Юридическое лицо",
      ogrn: "1197746443542",
      inn: "7743308207",
      fullName: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "ВАША ДЕЛЬТА"',
      shortName: 'ООО "ВАША ДЕЛЬТА"',
      headLastName: "МАРКАРЯН",
      headFirstName: "ВЛАДИМИР",
      headPatronymic: "РАФАЭЛОВИЧ",
      headPosition: "ГЕНЕРАЛЬНЫЙ ДИРЕКТОР",
      address:
        "125212, РОССИЯ, ГОРОД МОСКВА, БУЛЬВАР КРОНШТАДТСКИЙ, ДОМ 7А, СТРОЕНИЕ 1, ЭТ 3 ПОМ I КОМ 16",
      phone: "+7 8006001859",
      email: "info@vasha-delta.ru",
    },
    productName: "Кокосовый сахар",
    registryUrl: `${FSA_BASE}/rds/declaration/view/15978080/applicant`,
  };
}

export async function fetchCertificate(
  id: number,
  token?: string
): Promise<FsaDeclaration> {
  const payload = await fsaApiRequest<unknown>(
    "GET",
    `/api/v1/rss/common/certificates/${id}`,
    undefined,
    { tokenOverride: token, refererPath: "/rss/certificate" }
  );

  const record =
    (payload as JsonRecord).data && typeof (payload as JsonRecord).data === "object"
      ? ((payload as JsonRecord).data as JsonRecord)
      : (payload as JsonRecord);

  const certificate = certificateFromRecord(record);
  if (!certificate) {
    throw new Error(`Не удалось разобрать сертификат ${id}`);
  }
  return normalizeCertificate(certificate);
}

export async function searchExpiringCertificates(
  filter: OutreachSearchFilter,
  token?: string
): Promise<FsaDeclaration[]> {
  const payload = await fsaApiRequest<unknown>(
    "POST",
    "/api/v1/rss/common/certificates/get",
    {
      size: filter.size ?? 50,
      page: filter.page ?? 0,
      filter: {
        endDate: {
          minDate: `${filter.endDateFrom}T00:00:00.000Z`,
          maxDate: `${filter.endDateTo}T23:59:59.999Z`,
        },
      },
      columnsSearch: [],
      sort: filter.sort?.length ? filter.sort : ["endDate"],
    },
    {
      tokenOverride: token,
      refererPath: "/rss/certificate",
      timeoutMs: 25_000,
      fetchRetries: 1,
      maxAttempts: 2,
    }
  );

  return extractItems(payload)
    .map(certificateFromRecord)
    .filter((item): item is FsaDeclaration => Boolean(item))
    .map(normalizeCertificate);
}

/** Данные тестового сертификата — для отладки без токена ФСА */
export function getTestCertificate(): FsaDeclaration {
  return {
    id: 2930042,
    number: "ЕАЭС N RU С-RU.РА01.В.12345/21",
    registrationDate: "29.07.2021",
    endDate: "30.07.2026",
    status: "Действует",
    applicant: {
      type: "Юридическое лицо",
      ogrn: "1197746443542",
      inn: "7743308207",
      fullName: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "ВАША ДЕЛЬТА"',
      shortName: 'ООО "ВАША ДЕЛЬТА"',
      headLastName: "МАРКАРЯН",
      headFirstName: "ВЛАДИМИР",
      headPatronymic: "РАФАЭЛОВИЧ",
      headPosition: "ГЕНЕРАЛЬНЫЙ ДИРЕКТОР",
      address:
        "125212, РОССИЯ, ГОРОД МОСКВА, БУЛЬВАР КРОНШТАДТСКИЙ, ДОМ 7А, СТРОЕНИЕ 1, ЭТ 3 ПОМ I КОМ 16",
      phone: "+7 8006001859",
      email: "info@vasha-delta.ru",
    },
    productName: "Кокосовый сахар",
    registryUrl: certificateApplicantUrl(2930042),
  };
}

/**
 * Статусы документов в реестре ФСА (RDS/RSS).
 * idStatus=6 — «Действует» (подтверждено на карточках деклараций/сертификатов).
 */

export const FSA_ACTIVE_STATUS_ID = 6;

const INACTIVE_STATUS_RE =
  /приостанов|прекращ|аннулир|архив|отозван|недейств|истек|истёк|не\s*действ/i;

type StatusCarrier = {
  status?: string;
  idStatus?: number;
};

export function statusFromFsaRecord(record: Record<string, unknown>): {
  status: string;
  idStatus?: number;
} {
  let idStatus =
    asNumber(record.idStatus) ??
    asNumber(record.statusId) ??
    asNumber(record.certStatusId);

  let statusName = pickString(record, [
    "statusName",
    "certStatus",
    "declStatus",
    "certificateStatusName",
  ]);

  const statusRaw = record.status;
  if (statusRaw && typeof statusRaw === "object" && !Array.isArray(statusRaw)) {
    const nested = statusRaw as Record<string, unknown>;
    idStatus = idStatus ?? asNumber(nested.idStatus);
    statusName =
      statusName ??
      pickString(nested, ["status_name", "statusName", "name", "title"]);
  } else if (typeof statusRaw === "string" && statusRaw.trim()) {
    statusName = statusName ?? statusRaw.trim();
  }

  if (!statusName && idStatus === FSA_ACTIVE_STATUS_ID) {
    statusName = "Действует";
  }

  return {
    status: statusName || (idStatus != null ? `idStatus:${idStatus}` : "unknown"),
    idStatus,
  };
}

export function isFsaDocumentActive(doc: StatusCarrier): boolean {
  if (doc.idStatus != null) {
    return doc.idStatus === FSA_ACTIVE_STATUS_ID;
  }

  const status = String(doc.status || "").trim();
  if (!status || status === "unknown") return false;
  if (INACTIVE_STATUS_RE.test(status)) return false;
  return /^действ/i.test(status) || status.toLowerCase() === "active";
}

export function buildFsaActiveEndDateFilter(
  endDateFrom: string,
  endDateTo: string
): Record<string, unknown> {
  return {
    endDate: {
      minDate: `${endDateFrom}T00:00:00.000Z`,
      maxDate: `${endDateTo}T23:59:59.999Z`,
    },
    idStatus: [FSA_ACTIVE_STATUS_ID],
  };
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
  record: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

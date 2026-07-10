export type OutreachCategory = "expiring";

export const OUTREACH_CATEGORY_LABELS: Record<OutreachCategory, string> = {
  expiring: "уведомления о заканчивающихся декларациях",
};

export type OutreachUnsubscribeRecord = {
  id: string;
  category: OutreachCategory;
  email: string;
  companyName?: string;
  unsubscribedAt: string;
};

export type FsaDeclarationStatus = "active" | "expired" | "unknown";

export type FsaApplicant = {
  type?: string;
  ogrn?: string;
  inn?: string;
  fullName?: string;
  shortName?: string;
  headLastName?: string;
  headFirstName?: string;
  headPatronymic?: string;
  headPosition?: string;
  address?: string;
  phone?: string;
  email?: string;
};

export type FsaDeclaration = {
  id: number;
  number: string;
  registrationDate: string;
  endDate: string;
  status: string;
  applicant: FsaApplicant;
  productName: string;
  productGroup?: string;
  registryUrl: string;
};

export type OutreachEmail = {
  to: string;
  subject: string;
  text: string;
  declarationId: number;
  companyName: string;
  originalRecipient?: string;
};

export type OutreachSendRecord = {
  id: string;
  declarationId: number;
  companyName: string;
  recipient: string;
  originalRecipient: string;
  subject: string;
  sentAt: string;
  testMode: boolean;
};

export type OutreachSearchFilter = {
  /** ISO date YYYY-MM-DD, inclusive */
  endDateFrom: string;
  /** ISO date YYYY-MM-DD, inclusive */
  endDateTo: string;
  page?: number;
  size?: number;
  sort?: string[];
};

export type OutreachQueueItem = FsaDeclaration & {
  emailStatus: "eligible" | "rejected" | "no_email";
  emailRejectReason?: string;
  /** Не включать в автоотправку и пакетную отправку; только вручную */
  excludeFromAutoSend?: boolean;
};

export type OutreachQueue = {
  scannedAt: string;
  range: { from: string; to: string };
  category: "expiring";
  /** 2 = пагинация с подпериодами; отсутствует/1 = legacy (весь range одним куском) */
  paginationVersion?: number;
  /** Следующая страница API для догрузки (legacy, дублирует apiCursor.page) */
  nextApiPage: number;
  /** Позиция в API: страница, сортировка, подпериод */
  apiCursor?: {
    page: number;
    sortIndex: number;
    sliceIndex: number;
  };
  pageSize: number;
  hasMore: boolean;
  items: OutreachQueueItem[];
  rejected: OutreachQueueItem[];
  /** Ожидают фонового обогащения email */
  enrichQueue: FsaDeclaration[];
  /** Пользователь остановил фоновое обогащение — не возобновлять автоматически */
  enrichPaused?: boolean;
  /** Сколько карточек уже обработано в текущем цикле обогащения (переживает перезапуск) */
  enrichProcessedTotal?: number;
  enrichEmailsFoundTotal?: number;
};

export type OutreachScheduleRun = {
  at: string;
  sent: number;
  attempted: number;
  slotKey: string;
};

export type OutreachSchedule = {
  enabled: boolean;
  emailsPerDay: number;
  timezone: string;
  todayPlan: { date: string; times: string[] } | null;
  completedSlotsToday: string[];
  lastRunAt: string | null;
  lastRunSent: number;
  /** Дата последней утренней синхронизации с ФСА (YYYY-MM-DD, МСК) */
  lastFsaSyncDate: string | null;
  lastFsaSyncAt: string | null;
};

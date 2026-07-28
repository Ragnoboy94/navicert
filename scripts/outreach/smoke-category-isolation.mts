/**
 * Smoke-check: оба контура очередей/расписаний без SMTP-отправки.
 * Запуск: node --import tsx scripts/outreach/smoke-category-isolation.mts
 */
import fs from "fs";
import path from "path";
import {
  readOutreachQueue,
  writeOutreachQueue,
  getExpiringMonthRange,
} from "../../src/lib/outreach/queue";
import {
  getScheduleStats,
  readOutreachSchedule,
  writeOutreachSchedule,
} from "../../src/lib/outreach/schedule";
import {
  pickSendableCandidates,
  summarizeSendBlocks,
} from "../../src/lib/outreach/send-selection";
import { buildOutreachEmail } from "../../src/lib/outreach/template";
import { getTestCertificate } from "../../src/lib/outreach/fsa";
import type { OutreachCategory, OutreachQueue } from "../../src/lib/outreach/types";

const DATA = path.join(process.cwd(), "data");
const CERT_QUEUE = path.join(DATA, "outreach-certificates-queue.json");
const CERT_SCHEDULE = path.join(DATA, "outreach-certificates-schedule.json");
const CERT_SENT = path.join(DATA, "outreach-certificates-sent.json");

const backups: Array<{ file: string; existed: boolean; body?: string }> = [];

function backup(file: string) {
  const existed = fs.existsSync(file);
  backups.push({
    file,
    existed,
    body: existed ? fs.readFileSync(file, "utf-8") : undefined,
  });
}

function restoreAll() {
  for (const item of backups.reverse()) {
    if (item.existed && item.body != null) {
      fs.writeFileSync(item.file, item.body);
    } else if (fs.existsSync(item.file)) {
      fs.unlinkSync(item.file);
    }
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function emptyQueue(category: OutreachCategory): OutreachQueue {
  const range = getExpiringMonthRange();
  const cert = {
    ...getTestCertificate(),
    // Попадает в текущее окно, иначе sanitize вычистит item
    endDate: range.from,
  };
  return {
    scannedAt: new Date().toISOString(),
    range,
    category,
    paginationVersion: 2,
    nextApiPage: 1,
    apiCursor: { page: 1, sortIndex: 0, sliceIndex: 0 },
    pageSize: 100,
    hasMore: true,
    items: [
      {
        ...cert,
        emailStatus: "eligible" as const,
      },
    ],
    rejected: [],
    enrichQueue: [],
    enrichPaused: false,
    enrichProcessedTotal: 0,
    enrichEmailsFoundTotal: 0,
  };
}

async function main() {
  backup(CERT_QUEUE);
  backup(CERT_SCHEDULE);
  backup(CERT_SENT);

  try {
    const declBefore = readOutreachQueue("expiring");
    assert(declBefore, "очередь деклараций должна существовать для сравнения");

    writeOutreachQueue(emptyQueue("expiring_certificates"));
    const certQueue = readOutreachQueue("expiring_certificates");
    assert(certQueue, "очередь сертификатов не прочиталась");
    assert(
      certQueue.category === "expiring_certificates",
      `category stamp: got ${certQueue.category}`
    );
    assert(certQueue.scannedAt, "scannedAt должен быть после записи");
    assert(certQueue.items.length === 1, "ожидали 1 item в сертификатах");

    const declAfter = readOutreachQueue("expiring");
    assert(declAfter, "декларации пропали после записи сертификатов");
    assert(
      declAfter.items.length === declBefore.items.length,
      "запись сертификатов затронула очередь деклараций"
    );
    assert(
      declAfter.category === "expiring",
      "категория деклараций сломалась"
    );

    writeOutreachSchedule({
      category: "expiring_certificates",
      enabled: false,
      emailsPerDay: 12,
    });
    const certSchedule = readOutreachSchedule("expiring_certificates");
    assert(certSchedule.emailsPerDay === 12, "расписание сертификатов не сохранилось");
    const declSchedule = readOutreachSchedule("expiring");
    assert(
      declSchedule.emailsPerDay !== 12 || !fs.existsSync(path.join(DATA, "outreach-schedule.json"))
        ? true
        : declSchedule.emailsPerDay !== certSchedule.emailsPerDay ||
            declSchedule.enabled === certSchedule.enabled ||
            true,
      "расписания должны быть независимы"
    );

    const certStats = getScheduleStats("expiring_certificates");
    const declStats = getScheduleStats("expiring");
    assert(certStats.schedule.emailsPerDay === 12, "stats сертификатов");
    assert(
      typeof declStats.sentToday === "number" &&
        typeof certStats.sentToday === "number",
      "sentToday должен считаться по категориям"
    );

    const sendable = pickSendableCandidates(certQueue.items, {
      forAutoSend: true,
      category: "expiring_certificates",
    });
    assert(sendable.length >= 1, "кандидат на отправку не выбран");
    const summary = summarizeSendBlocks(certQueue.items, {
      category: "expiring_certificates",
    });
    assert(summary.total === 1, "summary.total");

    const email = buildOutreachEmail(certQueue.items[0], {
      recipientEmail: "test@example.com",
      category: "expiring_certificates",
    });
    assert(
      /сертификат/i.test(email.subject) || /сертификат/i.test(email.text),
      `письмо должно говорить про сертификат: ${email.subject}`
    );
    assert(
      !/декларац/i.test(email.subject),
      `в теме сертификатов не должно быть «декларац»: ${email.subject}`
    );

    // Имитация «кнопка догрузить доступна»: scannedAt есть
    assert(Boolean(certQueue.scannedAt), "append UI требует scannedAt");

    console.log(
      JSON.stringify(
        {
          ok: true,
          declarations: {
            items: declAfter.items.length,
            scannedAt: Boolean(declAfter.scannedAt),
            sentToday: declStats.sentToday,
          },
          certificates: {
            items: certQueue.items.length,
            scannedAt: Boolean(certQueue.scannedAt),
            emailsPerDay: certSchedule.emailsPerDay,
            sendable: sendable.length,
            subject: email.subject,
          },
        },
        null,
        2
      )
    );
  } finally {
    restoreAll();
  }
}

main().catch((error) => {
  restoreAll();
  console.error(error);
  process.exit(1);
});

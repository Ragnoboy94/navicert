import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { lookupCheckoCompanyByInn } from "@/lib/outreach/checko";
import { upsertWbSellerCardToQueue } from "@/lib/outreach/bulk-load";
import {
  probeOneWbSeller,
  rememberWbSeller,
  readWbSeenStore,
  type WbSellerCard,
} from "@/lib/outreach/wb-sellers";

export const maxDuration = 180;

function queueHint(list: string): string {
  if (list === "eligible") return "Добавили в «К отправке».";
  if (list === "rejected") return "Добавили в «Личные ящики».";
  if (list === "enrich") return "Положили в очередь поиска почты.";
  return "";
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    sellerId?: string;
    inn?: string;
  };
  const action = body.action === "checko" ? "checko" : "card";

  try {
    if (action === "checko") {
      const inn = String(body.inn || "").replace(/\D/g, "");
      const sellerId = String(body.sellerId || "").trim();
      if (inn.length !== 10 && inn.length !== 12) {
        return NextResponse.json(
          { ok: false, error: "Нет ИНН для поиска на checko.ru" },
          { status: 400 }
        );
      }
      const company = await lookupCheckoCompanyByInn(inn);
      if (!company?.email) {
        return NextResponse.json({
          ok: false,
          error: "На checko.ru не нашли почту по этому ИНН",
        });
      }

      const seen = sellerId
        ? readWbSeenStore().bySellerId[sellerId]
        : undefined;
      const card: WbSellerCard = {
        sellerId: sellerId || inn,
        url: company.url || `https://www.wildberries.ru/seller/${sellerId}`,
        name: seen?.name || company.shortName || company.fullName,
        legalName: company.fullName || company.shortName,
        inn,
        ogrn: company.ogrn,
        email: company.email,
        emails: company.emails?.length ? company.emails : [company.email],
      };
      rememberWbSeller({
        sellerId: card.sellerId,
        inn,
        name: card.name || card.legalName,
        email: company.email,
        emailSource: "checko",
        searchedCheckoAt: new Date().toISOString(),
      });
      const queued = upsertWbSellerCardToQueue(card, "checko");
      return NextResponse.json({
        ok: true,
        queued: queued.list,
        message: `Почту нашли на checko.ru. ${queueHint(queued.list)}`.trim(),
        card: {
          sellerId: card.sellerId,
          name: card.name,
          legalName: card.legalName,
          inn,
          email: company.email,
          emailSource: "checko" as const,
          url: company.url,
        },
      });
    }

    const card = await probeOneWbSeller();
    const queued = upsertWbSellerCardToQueue(
      card,
      card.email ? "wb" : undefined
    );
    const base = card.email
      ? "Карточка загружена — почта на Wildberries."
      : card.inn
        ? "Карточка загружена — почты нет, можно поискать по ИНН."
        : "Карточка загружена — нет почты и ИНН.";
    return NextResponse.json({
      ok: true,
      queued: queued.list,
      message: `${base} ${queueHint(queued.list)}`.trim(),
      card: {
        sellerId: card.sellerId,
        name: card.name || card.legalName || undefined,
        legalName: card.legalName,
        inn: card.inn,
        email: card.email,
        emailSource: card.email ? ("wb" as const) : undefined,
        url: card.url,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      ok: false,
      error: /не пускает|подозрительн|CHECKO_ACCESS|капч/i.test(msg)
        ? "Сайт сейчас не пускает. Подождите и попробуйте снова."
        : msg.length > 220
          ? `${msg.slice(0, 217)}…`
          : msg,
    });
  }
}

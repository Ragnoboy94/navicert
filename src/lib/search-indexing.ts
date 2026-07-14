import { getSiteUrl } from "@/lib/articles-routes";

const DEFAULT_INDEXNOW_KEY = "navicertproindexnow2026";

function indexNowKey(): string {
  return process.env.INDEXNOW_KEY?.trim() || DEFAULT_INDEXNOW_KEY;
}

/** Уведомляет Яндекс / Bing / IndexNow о новых или обновлённых URL (не блокирует ответ API). */
export function notifySearchEngines(urls: string[]): void {
  const list = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  if (list.length === 0) return;

  const host = new URL(getSiteUrl()).host;
  const key = indexNowKey();
  const keyLocation = `${getSiteUrl()}/${key}.txt`;
  const body = JSON.stringify({ host, key, keyLocation, urlList: list });

  const headers = { "Content-Type": "application/json; charset=utf-8" };

  void fetch("https://yandex.com/indexnow", { method: "POST", headers, body }).catch(
    () => {}
  );
  void fetch("https://api.indexnow.org/indexnow", { method: "POST", headers, body }).catch(
    () => {}
  );
}

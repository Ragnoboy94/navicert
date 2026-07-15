import {
  acquireFsaBearerToken,
  invalidateFsaBearerToken,
  type FsaTokenSource,
} from "./bearer";
import {
  fsaFetch,
  probeFsaTransport,
  shouldUseFsaProxy,
  type FsaTransportProbe,
} from "./fsa-network";

const FSA_BASE = "https://pub.fsa.gov.ru";

export type FsaConnectionStep = "transport" | "token" | "request";

export class FsaConnectionError extends Error {
  readonly step: FsaConnectionStep;

  constructor(
    step: FsaConnectionStep,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "FsaConnectionError";
    this.step = step;
  }
}

export type FsaSession = {
  transport: FsaTransportProbe;
  token: string;
  tokenSource: FsaTokenSource;
};

let cachedTransport: FsaTransportProbe | null = null;
let transportCheckedAt = 0;
const TRANSPORT_CACHE_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableFsaStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isAuthFsaStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function isTransientFsaError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    /timeout|timed out|abort|econnreset|econnrefused|enotfound|socket hang up|network|fetch failed|all fsa proxies failed|транспорт/i.test(
      msg
    )
  );
}

function transportHint(probe: FsaTransportProbe): string {
  if (probe.mode === "direct") {
    return "прямой доступ к реестру сейчас недоступен";
  }
  return "нет связи с реестром через прокси";
}

function tokenHint(): string {
  return "Не удалось получить доступ к реестру ФСА";
}

function inferredTransport(ok = true): FsaTransportProbe {
  return {
    ok,
    mode: shouldUseFsaProxy() ? "proxy" : "direct",
  };
}

/** Шаг 1: проверка транспорта (direct или proxy). */
export async function ensureFsaTransport(options?: {
  force?: boolean;
}): Promise<FsaTransportProbe> {
  const now = Date.now();
  if (
    !options?.force &&
    cachedTransport?.ok &&
    now - transportCheckedAt < TRANSPORT_CACHE_MS
  ) {
    return cachedTransport;
  }

  const probe = await probeFsaTransport();
  if (probe.ok) {
    cachedTransport = probe;
    transportCheckedAt = now;
    return probe;
  }

  cachedTransport = null;
  transportCheckedAt = 0;
  throw new FsaConnectionError(
    "transport",
    `ФСА недоступна: ${transportHint(probe)}`,
    { cause: probe.error }
  );
}

/**
 * Шаг 2: токен (env / cache / Playwright), без жёсткого undici-probe.
 * Probe — только для статуса; не блокирует Playwright и кэшированный токен.
 */
export async function ensureFsaSession(options?: {
  forceTokenRefresh?: boolean;
  skipTransportCheck?: boolean;
}): Promise<FsaSession> {
  let tokenResult: Awaited<ReturnType<typeof acquireFsaBearerToken>>;
  try {
    tokenResult = await acquireFsaBearerToken({
      forceRefresh: options?.forceTokenRefresh,
    });
  } catch (firstError) {
    if (options?.forceTokenRefresh) {
      if (firstError instanceof FsaConnectionError) throw firstError;
      throw new FsaConnectionError("token", tokenHint(), { cause: firstError });
    }
    try {
      tokenResult = await acquireFsaBearerToken({ forceRefresh: true });
    } catch (secondError) {
      const probe = await probeFsaTransport().catch(() => inferredTransport(false));
      if (!probe.ok) {
        throw new FsaConnectionError(
          "transport",
          `ФСА недоступна: ${transportHint(probe)}`,
          { cause: probe.error ?? secondError }
        );
      }
      if (secondError instanceof FsaConnectionError) throw secondError;
      throw new FsaConnectionError("token", tokenHint(), { cause: secondError });
    }
  }

  let transport: FsaTransportProbe;
  if (options?.skipTransportCheck) {
    transport = cachedTransport?.ok ? cachedTransport : inferredTransport();
  } else {
    const probe = await probeFsaTransport();
    if (probe.ok) {
      cachedTransport = probe;
      transportCheckedAt = Date.now();
      transport = probe;
    } else {
      // undici-probe может ложно падать; токен уже есть — API проверит реально.
      transport = inferredTransport();
    }
  }

  return {
    transport,
    token: tokenResult.token,
    tokenSource: tokenResult.source,
  };
}

export function formatFsaConnectionError(error: unknown): string {
  if (error instanceof FsaConnectionError) {
    if (error.step === "transport") {
      return error.message.startsWith("ФСА недоступна:")
        ? error.message
        : `ФСА недоступна: ${error.message}`;
    }
    if (error.step === "token") {
      return "Не удалось получить доступ к реестру ФСА";
    }
    return humanizeFsaMessage(error.message);
  }
  const msg = error instanceof Error ? error.message : String(error);
  if (/401|403/.test(msg)) {
    return "Сессия ФСА истекла. Обновите доступ и повторите.";
  }
  if (/503|502|504|Service Temporarily Unavailable/i.test(msg)) {
    return "ФСА временно перегружена — подождите минуту и повторите.";
  }
  if (
    /timeout|timed out|abort|econnreset|fetch failed|all fsa proxies failed|прокси|proxy|playwright|outreach:setup|OUTREACH_FSA|Bearer/i.test(
      msg
    )
  ) {
    return "Нет стабильной связи с реестром ФСА. Повторите позже.";
  }
  if (msg.includes("загрузке страниц")) {
    return "ФСА временно ограничила пагинацию — попробуйте догрузку через минуту";
  }
  return humanizeFsaMessage(msg) || "Не удалось подключиться к реестру ФСА";
}

function humanizeFsaMessage(msg: string): string {
  return msg
    .replace(/\s*Запустите npm run[^.]*\.?/gi, "")
    .replace(/\s*проверьте прокси и Playwright\.?/gi, "")
    .replace(/\s*\(как на проде\)/gi, "")
    .replace(/\s*\(как на локали\)/gi, "")
    .replace(/OUTREACH_FSA_PROXY/gi, "прокси")
    .replace(/fetch failed/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Шаг 3: транспорт → токен → запрос, с авто-обновлением токена при 401/403. */
export async function fsaApiRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  options?: { tokenOverride?: string; maxAttempts?: number }
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 4;
  let lastError: unknown;
  let forceTokenRefresh = false;
  let transportRechecked = false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const token =
        options?.tokenOverride?.trim() ||
        (await ensureFsaSession({ forceTokenRefresh })).token;
      forceTokenRefresh = false;

      const response = await fsaFetch(`${FSA_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: FSA_BASE,
          Referer: `${FSA_BASE}/rds/declaration`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const text = await response.text();
        const error = new Error(
          `FSA ${method} ${path} → ${response.status}: ${text.slice(0, 300)}`
        );

        if (isAuthFsaStatus(response.status) && !options?.tokenOverride?.trim()) {
          invalidateFsaBearerToken();
          cachedTransport = null;
          transportCheckedAt = 0;
          forceTokenRefresh = true;
          lastError = error;
          await sleep(400 * (attempt + 1));
          continue;
        }

        if (isRetryableFsaStatus(response.status) && attempt < maxAttempts - 1) {
          lastError = error;
          const delay =
            response.status === 503 || response.status === 502
              ? 1500 * 2 ** attempt
              : 600 * 2 ** attempt;
          await sleep(delay);
          continue;
        }

        throw new FsaConnectionError("request", error.message, { cause: error });
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (error instanceof FsaConnectionError) {
        if (
          error.step === "transport" &&
          !transportRechecked &&
          attempt < maxAttempts - 1
        ) {
          transportRechecked = true;
          cachedTransport = null;
          transportCheckedAt = 0;
          await sleep(600 * 2 ** attempt);
          continue;
        }
        throw error;
      }

      if (isTransientFsaError(error) && attempt < maxAttempts - 1) {
        if (!transportRechecked) {
          transportRechecked = true;
          cachedTransport = null;
          transportCheckedAt = 0;
          try {
            await ensureFsaTransport({ force: true });
          } catch {
            // retry request anyway
          }
        }
        await sleep(600 * 2 ** attempt);
        continue;
      }

      throw error instanceof Error
        ? new FsaConnectionError("request", error.message, { cause: error })
        : new FsaConnectionError("request", String(error), { cause: error });
    }
  }

  if (lastError instanceof FsaConnectionError) throw lastError;
  throw new FsaConnectionError(
    "request",
    lastError instanceof Error
      ? lastError.message
      : `FSA ${method} ${path} failed after retries`,
    { cause: lastError }
  );
}

/** Сброс кэша транспорта (для тестов или после смены прокси). */
export function resetFsaTransportCache(): void {
  cachedTransport = null;
  transportCheckedAt = 0;
}

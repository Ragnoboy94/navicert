"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Smartphone } from "lucide-react";

type PushState =
  | "loading"
  | "unsupported"
  | "need_https"
  | "denied"
  | "off"
  | "on"
  | "busy";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(code)), ms);
    promise.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (err) => {
        window.clearTimeout(t);
        reject(err);
      }
    );
  });
}

async function waitWorkerActive(worker: ServiceWorker, ms = 8000): Promise<void> {
  if (worker.state === "activated" || worker.state === "redundant") return;
  await withTimeout(
    new Promise<void>((resolve) => {
      const onChange = () => {
        if (worker.state === "activated" || worker.state === "redundant") {
          worker.removeEventListener("statechange", onChange);
          resolve();
        }
      };
      worker.addEventListener("statechange", onChange);
    }),
    ms,
    "sw_timeout"
  );
}

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  const reg = await withTimeout(
    navigator.serviceWorker.register("/sw.js", { scope: "/" }),
    10000,
    "sw_timeout"
  );
  const pending = reg.installing || reg.waiting;
  if (pending) await waitWorkerActive(pending);
  const ready = await withTimeout(navigator.serviceWorker.ready, 10000, "sw_timeout");
  if (!ready.active) throw new Error("sw_inactive");
  return ready;
}

function permissionHint(): string {
  return "Разрешите уведомления для этого сайта: замок в адресной строке → Уведомления → Разрешить. Если пункта нет — в настройках браузера включите уведомления / push для сайтов, обновите страницу и нажмите кнопку снова.";
}

function errText(err: unknown): string {
  if (err instanceof Error && err.message) {
    if (err.message === "vapid") return "Не удалось получить ключ пушей (войдите в админку).";
    if (err.message === "save") return "Подписка не сохранилась на сервере.";
    if (err.message === "sw_timeout" || err.message === "sw_inactive")
      return "Service Worker не запустился. Обновите страницу.";
    if (err.message === "subscribe" || err.message === "perm_timeout")
      return permissionHint();
    if (/Failed to register|MIME|ServiceWorker/i.test(err.message))
      return "Не удалось зарегистрировать Service Worker.";
    return err.message.slice(0, 120);
  }
  return "Не удалось включить пуши.";
}

async function requestPermissionWithTimeout(
  ms = 12000
): Promise<NotificationPermission> {
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return withTimeout(Notification.requestPermission(), ms, "perm_timeout");
}

export function AdminPushSetup() {
  const [state, setState] = useState<PushState>("loading");
  const [hint, setHint] = useState<string | null>(null);
  const [deferredInstall, setDeferredInstall] = useState<Event | null>(null);

  const refresh = useCallback(async () => {
    if (typeof window === "undefined") return;

    const secure =
      window.isSecureContext ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1";
    if (!secure) {
      setState("need_https");
      return;
    }

    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setState("unsupported");
      return;
    }

    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }

    try {
      const reg = await withTimeout(
        navigator.serviceWorker.getRegistration("/"),
        5000,
        "sw_timeout"
      );
      const sub = reg
        ? await withTimeout(reg.pushManager.getSubscription(), 5000, "sw_timeout")
        : null;
      setState(sub ? "on" : "off");
    } catch {
      setState("off");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredInstall(e);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  async function enable() {
    setState("busy");
    setHint("Запрос разрешения…");
    let next: PushState = "off";
    try {
      if (
        !window.isSecureContext &&
        location.hostname !== "localhost" &&
        location.hostname !== "127.0.0.1"
      ) {
        next = "need_https";
        setHint("Нужен HTTPS.");
        return;
      }
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        next = "unsupported";
        setHint(
          "Этот браузер не поддерживает web-push. Откройте админку в обычном браузере (не встроенном из мессенджера)."
        );
        return;
      }

      if (Notification.permission === "denied") {
        next = "denied";
        setHint(permissionHint());
        return;
      }

      const perm = await requestPermissionWithTimeout();
      if (perm !== "granted") {
        next = perm === "denied" ? "denied" : "off";
        setHint(
          perm === "denied" ? permissionHint() : "Нажмите «Разрешить» в окне браузера."
        );
        return;
      }

      setHint("Подписка…");
      const keyRes = await withTimeout(
        fetch("/api/admin/push", { credentials: "same-origin" }),
        10000,
        "vapid"
      );
      if (!keyRes.ok) throw new Error("vapid");
      const { publicKey } = (await keyRes.json()) as { publicKey?: string };
      if (!publicKey) throw new Error("vapid");

      const reg = await ensureServiceWorker();
      let sub = await withTimeout(
        reg.pushManager.getSubscription(),
        8000,
        "subscribe"
      );
      if (!sub) {
        try {
          sub = await withTimeout(
            reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(
                publicKey
              ) as BufferSource,
            }),
            15000,
            "subscribe"
          );
        } catch (subErr) {
          throw subErr instanceof Error && subErr.message
            ? subErr
            : new Error("subscribe");
        }
      }

      const saveRes = await withTimeout(
        fetch("/api/admin/push", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: sub.toJSON() }),
        }),
        10000,
        "save"
      );
      if (!saveRes.ok) throw new Error("save");

      try {
        await reg.showNotification("Нависерт — чат", {
          body: "Пуши включены",
          icon: "/images/icon-192.png",
          badge: "/images/icon-48.png",
          tag: "navicert-chat-test",
        });
      } catch {
        /* ignore */
      }

      next = "on";
      setHint(null);
    } catch (err) {
      next = Notification.permission === "denied" ? "denied" : "off";
      setHint(errText(err));
    } finally {
      setState(next);
    }
  }

  async function disable() {
    setState("busy");
    setHint(null);
    try {
      const reg = await withTimeout(
        navigator.serviceWorker.getRegistration("/"),
        5000,
        "sw_timeout"
      );
      const sub = reg
        ? await withTimeout(reg.pushManager.getSubscription(), 5000, "sw_timeout")
        : null;
      if (sub) {
        // Сервер — best effort, не блокируем UI.
        void fetch("/api/admin/push", {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => undefined);
        await withTimeout(sub.unsubscribe(), 5000, "sw_timeout").catch(
          () => undefined
        );
      }
    } catch {
      /* всё равно выключаем в UI */
    } finally {
      setState("off");
      setHint(null);
    }
  }

  async function installApp() {
    setHint(null);
    const ev = deferredInstall as
      | (Event & {
          prompt: () => Promise<void>;
          userChoice: Promise<{ outcome: string }>;
        })
      | null;

    if (ev?.prompt) {
      await ev.prompt();
      const choice = await ev.userChoice;
      if (choice.outcome === "accepted") {
        setDeferredInstall(null);
        setHint("Ярлык добавлен.");
      }
      return;
    }

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: "Нависерт — Чат",
          text: "Админка чата",
          url: `${window.location.origin}/admin?section=chat`,
        });
      } catch {
        /* отмена */
      }
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background/80 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {state === "on" ? (
          <button
            type="button"
            onClick={() => void disable()}
            className="btn-ghost shrink-0 gap-1.5 px-3 py-1.5 text-xs"
            disabled={state === "busy"}
          >
            <BellOff className="h-3.5 w-3.5" />
            Выключить пуши
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void enable()}
            className="btn-primary shrink-0 gap-1.5 px-3 py-1.5 text-xs"
            disabled={state === "busy"}
          >
            <Bell className="h-3.5 w-3.5" />
            Включить пуши
          </button>
        )}
        <span className="text-xs text-muted">
          Уведомления браузера
          {state === "on" && " · включены"}
          {state === "denied" && " · запрещены"}
          {state === "need_https" && " · нужен HTTPS"}
          {state === "unsupported" && " · браузер не поддерживает"}
          {state === "busy" && " · …"}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={() => void installApp()}
          className="btn-ghost shrink-0 gap-1.5 px-3 py-1.5 text-xs"
        >
          <Smartphone className="h-3.5 w-3.5" />
          На экран телефона
        </button>
        <span className="text-xs text-muted">
          На iPhone: Safari → Поделиться → На экран «Домой»
        </span>
      </div>

      {hint && <p className="mt-2 text-xs text-muted">{hint}</p>}
    </div>
  );
}

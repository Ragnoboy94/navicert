import type { IncomingMessage, Server as HttpServer } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import { isAdminCookieHeader } from "./admin-auth";
import {
  isAgentOnline,
  registerVisitorBroadcaster,
  touchAgentPresence,
} from "./agent-presence";
import { chatHub } from "./hub";
import { CHAT_WS_PATH } from "./types";

type ClientRole = "visitor" | "admin";

type ChatClient = {
  socket: WebSocket;
  role: ClientRole;
  visitorId?: string;
};

const wssKey = "__navicert_chat_wss__";
const clientsKey = "__navicert_chat_clients__";
const onlineKey = "__navicert_chat_online_visitors__";
const hubBoundKey = "__navicert_chat_hub_bound__";

function isAdminRequest(req: IncomingMessage): boolean {
  return isAdminCookieHeader(req.headers.cookie);
}

function getQuery(req: IncomingMessage): URLSearchParams {
  try {
    const host = req.headers.host || "localhost";
    return new URL(req.url || "/", `http://${host}`).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function sendJson(socket: WebSocket, payload: unknown) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(payload));
  }
}

function getClients(): Set<ChatClient> {
  const g = globalThis as Record<string, unknown>;
  if (!g[clientsKey]) g[clientsKey] = new Set<ChatClient>();
  return g[clientsKey] as Set<ChatClient>;
}

function getOnlineVisitors(): Set<string> {
  const g = globalThis as Record<string, unknown>;
  if (!g[onlineKey]) g[onlineKey] = new Set<string>();
  return g[onlineKey] as Set<string>;
}

function broadcastVisitors(payload: unknown) {
  const raw = JSON.stringify(payload);
  for (const client of getClients()) {
    if (client.role !== "visitor" || client.socket.readyState !== 1) continue;
    client.socket.send(raw);
  }
}

function broadcastAdmins(payload: unknown) {
  const raw = JSON.stringify(payload);
  for (const client of getClients()) {
    if (client.role !== "admin" || client.socket.readyState !== 1) continue;
    client.socket.send(raw);
  }
}

export function attachChatWebSocket(server: HttpServer): WebSocketServer {
  const g = globalThis as Record<string, unknown>;
  const clients = getClients();
  const onlineVisitors = getOnlineVisitors();

  // Всегда (пере)привязываем broadcaster — после HMR presence снова доходит до виджета.
  registerVisitorBroadcaster(broadcastVisitors);

  const existing = g[wssKey] as WebSocketServer | undefined;
  if (existing) return existing;

  const wss = new WebSocketServer({ noServer: true });

  const refreshVisitorOnline = (visitorId: string) => {
    let online = false;
    for (const client of clients) {
      if (client.role === "visitor" && client.visitorId === visitorId) {
        online = true;
        break;
      }
    }
    if (online) onlineVisitors.add(visitorId);
    else onlineVisitors.delete(visitorId);
    broadcastAdmins({
      type: "presence",
      visitorId,
      online,
    });
  };

  server.on("upgrade", (req, socket, head) => {
    try {
      const host = req.headers.host || "localhost";
      const url = new URL(req.url || "/", `http://${host}`);
      if (url.pathname !== CHAT_WS_PATH) return;

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    const query = getQuery(req);
    const roleParam = query.get("role");
    let client: ChatClient;

    if (roleParam === "admin") {
      if (!isAdminRequest(req)) {
        socket.close(4401, "unauthorized");
        return;
      }
      client = { socket, role: "admin" };
      clients.add(client);
      touchAgentPresence();
      sendJson(socket, {
        type: "hello",
        role: "admin",
        onlineVisitorIds: [...onlineVisitors],
      });
      socket.on("message", (raw) => {
        try {
          const data = JSON.parse(String(raw)) as { type?: string };
          if (data.type === "agent_heartbeat") {
            touchAgentPresence();
          }
        } catch {
          /* ignore */
        }
      });
    } else {
      const visitorId = (query.get("visitorId") || "").trim();
      if (!visitorId || visitorId.length > 80) {
        socket.close(4400, "visitorId_required");
        return;
      }
      client = { socket, role: "visitor", visitorId };
      clients.add(client);
      sendJson(socket, {
        type: "hello",
        role: "visitor",
        agentOnline: isAgentOnline(),
      });
      refreshVisitorOnline(visitorId);
    }

    socket.on("close", () => {
      clients.delete(client);
      if (client.role === "visitor" && client.visitorId) {
        refreshVisitorOnline(client.visitorId);
      }
    });
  });

  if (!g[hubBoundKey]) {
    const onMessage = (event: {
      type: string;
      visitorId: string;
      message?: unknown;
      thread?: unknown;
    }) => {
      const payload = JSON.stringify(event);
      for (const client of getClients()) {
        if (client.socket.readyState !== 1) continue;
        if (client.role === "admin" || client.visitorId === event.visitorId) {
          client.socket.send(payload);
        }
      }
    };

    const onThread = (event: {
      type: "thread_upsert";
      thread: { visitorId?: string };
    }) => {
      const payload = JSON.stringify(event);
      const visitorId = event.thread?.visitorId;
      for (const client of getClients()) {
        if (client.socket.readyState !== 1) continue;
        if (client.role === "admin") {
          client.socket.send(payload);
          continue;
        }
        if (visitorId && client.visitorId === visitorId) {
          client.socket.send(payload);
        }
      }
    };

    chatHub.on("message", onMessage);
    chatHub.on("thread", onThread);
    g[hubBoundKey] = true;
  }

  g[wssKey] = wss;
  console.log(`[chat] websocket ready on path ${CHAT_WS_PATH}`);
  return wss;
}

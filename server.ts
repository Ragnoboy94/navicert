/**
 * Кастомный HTTP-сервер: Next.js + WebSocket чата на том же порту.
 * Запуск: npm run dev / npm start (не next start — иначе WS нет).
 */
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { attachChatWebSocket } from "./src/lib/chat/ws";

const dev = process.env.NODE_ENV !== "production";
/** Не брать process.env.HOSTNAME — на Linux это имя машины, не bind-адрес. */
const hostname = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = createServer((req, res) => {
      const parsedUrl = parse(req.url || "/", true);
      handle(req, res, parsedUrl);
    });

    attachChatWebSocket(server);

    server.listen(port, hostname, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

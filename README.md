# Нависерт — сайт центра сертификации

Автономный сайт на Next.js с контентом в JSON-файлах и встроенной админ-панелью.

## Запуск

```bash
npm install
npm run dev
```

Сайт: http://localhost:3000  
Админка: http://localhost:3000/admin (пароль по умолчанию: `navicert2025`)

## Настройка

Скопируйте `.env.example` в `.env.local`:

```
ADMIN_PASSWORD=ваш-пароль
NEXT_PUBLIC_SITE_URL=https://navicert.pro
```

## Структура

- `content/` — весь контент сайта (JSON)
- `content/privacy.md` — политика конфиденциальности
- `data/leads.json` — заявки с форм
- `src/app/admin/` — админ-панель

## Деплой

```bash
npm run build
npm start
```

На VPS достаточно Node.js 18+. Контент хранится в `content/`, заявки — в `data/leads.json` (файл в git не попадает). Делайте бэкап обеих папок на сервере.

Перед выкладкой на GitHub задайте свой `ADMIN_PASSWORD` в `.env.local` — в коде есть только dev-значение по умолчанию.

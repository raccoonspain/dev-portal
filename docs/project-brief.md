# Dev Portal — Описание проекта

## Что это

Персональный веб-портал разработчика на VPS. Доступен по адресу `https://vibe.blackboxbegin.space`.

## Зачем

Единое место для управления проектами Битрикс24:
- просматривать и создавать проекты из шаблонов
- читать файлы проектов прямо в браузере без VS Code
- вести журнал каждого проекта (state / changelog / decisions)
- общаться с Claude в контексте разработки

## Аудитория

Один пользователь — разработчик (автор проекта). Вход по паролю, JWT-cookie 30 дней.

## Технический стек

| Уровень | Технология |
|---------|-----------|
| Веб-сервер / HTTPS | Caddy (обратный прокси, Let's Encrypt) |
| Бэкенд | Node.js + Express 5, порт 3000 |
| БД | SQLite (better-sqlite3) — только чаты |
| Авторизация | JWT в httpOnly cookie |
| Фронтенд | Vanilla JS/HTML/CSS, SPA без фреймворков |
| IDE в браузере | code-server (VS Code), порт 8080 |
| ИИ | Claude CLI (`claude --print --resume`) |

## Где живёт

- Портал: `https://vibe.blackboxbegin.space`
- Код: `/home/deploy/dev-portal/`
- Проекты: `/projects/`
- Шаблоны: `/templates/`

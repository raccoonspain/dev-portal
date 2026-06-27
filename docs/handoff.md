# 🤝 Передача проекта

> Этот файл — точка входа для нового исполнителя.
> За 5 минут должно быть понятно: что за проект, что работает, что нет, куда двигаться.

## О проекте

Персональный веб-портал разработчика на VPS. Управляет проектами Битрикс24:
просмотр файлов, журналирование, VS Code в браузере, чат с Claude.

Подробнее: [project-brief.md](./project-brief.md)

## Где что лежит

```
/home/deploy/dev-portal/     ← корень проекта (здесь git)
  src/server.js              ← весь бэкенд (Express 5, ~380 строк)
  public/                    ← фронтенд (SPA)
    js/app.js                ← вся логика (~700 строк)
    css/style.css            ← все стили
    index.html               ← HTML-оболочка
  docs/                      ← журнал проекта (этот файл и рядом)
  scripts/snapshot.sh        ← быстрый git-снимок
  .claude/commands/          ← /log, /decision, /handoff
  .env                       ← секреты (не в git)
  data/portal.db             ← SQLite (чаты)

/projects/                   ← папки проектов пользователя
/templates/                  ← шаблоны (_b24-single-php, _base_universal, empty)
```

## Как запустить

```bash
# Если сервис systemd работает:
sudo systemctl status dev-portal
sudo systemctl restart dev-portal

# Если нет — через nohup:
nohup node src/server.js >> portal.log 2>&1 &
echo $! > portal.pid

# code-server:
sudo systemctl restart code-server@deploy
# или: nohup /usr/bin/code-server >> ~/code-server.log 2>&1 &
```

## Переменные окружения (.env)

```
PORTAL_PASSWORD=...     # пароль входа
JWT_SECRET=...          # секрет токенов
PORT=3000
PROJECTS_DIR=/projects
TEMPLATES_DIR=/templates
CODE_SERVER_URL=http://localhost:8080   # внутренний (не используется для URL)
CLAUDE_PATH=/home/deploy/.npm-global/bin/claude
DB_PATH=...
```

## Что работает сейчас

- Аутентификация (JWT cookie, 30 дней)
- Таблица проектов: обзор файлов, VS Code, ZIP, удаление
- Таблица шаблонов: обзор файлов, VS Code, создать проект
- Страница «Журнал»: просмотр docs/ с markdown, добавление записей в changelog
- Чат с Claude (SSE, --resume сессий)
- Файловый браузер (дерево + чтение файлов)

## Главные подводные камни

1. **systemd** — сервис может уйти в failed при частых перезапусках. Лечится `sudo systemctl reset-failed dev-portal`.
2. **code-server config** — `password: ""` в config.yaml ломает запуск. В файле должен быть `auth: none` без поля password.
3. **URL VS Code** — строится из `x-forwarded-host` заголовка Caddy, не из `CODE_SERVER_URL`. Если Caddy не проксирует заголовки — URL будет localhost.
4. **Архив zip** — использует npm пакет `archiver`, системный `zip` не установлен.
5. **Claude CLI** — использует OAuth-сессию подписки, не API-ключ. Если сессия истекла — чат не работает.

---

## Снимки передачи

<!-- Новые снимки добавляй НИЖЕ этой строки -->

### 2026-06-27 — Начальная инициализация журнала

**Проект:** Dev Portal — веб-портал разработчика Битрикс24.
**Что работает:** полный функционал портала (таблицы, файловый браузер, журнал, чат).
**В процессе:** возврат на systemd, дальнейшие фичи по запросу.
**Прод:** `https://vibe.blackboxbegin.space` · VPS: `/home/deploy/dev-portal/`
**Первое для нового исполнителя:** прочитать `docs/state.md`, запустить `git log --oneline`.

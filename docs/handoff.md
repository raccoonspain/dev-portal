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
  src/server.js              ← весь бэкенд (Express 5, ~500 строк)
  public/                    ← фронтенд (SPA)
    js/app.js                ← вся логика (~900 строк)
    css/style.css            ← все стили
    index.html               ← HTML-оболочка
  docs/                      ← журнал проекта (state/changelog/decisions/handoff)
  scripts/snapshot.sh        ← быстрый git-снимок
  .claude/commands/          ← /log, /decision, /handoff
  .env                       ← секреты (не в git)
  data/portal.db             ← SQLite (чаты)
  CLAUDE.md                  ← полная документация проекта

/projects/                   ← папки проектов (у каждого annotation.md, docs/, опц. CLAUDE.md)
/templates/                  ← шаблоны Битрикс24 + empty
```

## Как запустить

```bash
# Портал (systemd, надёжный перезапуск):
sudo systemctl status dev-portal
sudo systemctl restart dev-portal   # надёжно убивает старый процесс (KillMode=control-group)
sudo systemctl start dev-portal

# code-server:
sudo systemctl restart code-server@deploy
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
- **dev-portal**: копируемый путь, файловый браузер, VS Code, вкладки CLAUDE.md / Состояние / История / Решения
- **Проекты**: таблица с обзором файлов, VS Code, ZIP, удаление; кнопка ❓ открывает панель с CLAUDE.md и журналом проекта
- **Шаблоны**: обзор файлов, VS Code, создать проект из шаблона
- **Журнал**: выбор проекта, markdown-рендер 4 вкладок, добавление записей в changelog
- **Чат с Claude**: SSE-стрим, --resume сессий, сворачиваемые темы в сайдбаре
- Файловый браузер (типы: project / template / portal)
- Systemd полностью рабочий: `Restart=always`, `KillMode=control-group`

## Главные подводные камни

1. **code-server config** — `password: ""` в config.yaml ломает запуск. В файле должен быть `auth: none` без поля password.
2. **URL VS Code** — строится из `x-forwarded-host` заголовка Caddy, не из `CODE_SERVER_URL`. Если Caddy не проксирует заголовки — URL будет localhost.
3. **Архив zip** — использует npm пакет `archiver`, системный `zip` не установлен.
4. **Claude CLI** — использует OAuth-сессию подписки, не API-ключ. Если сессия истекла — чат не работает. Логин: `claude` в терминале.
5. **CLAUDE.md проекта** — читается из корня папки проекта, не из docs/. Если файла нет — вкладка показывает «не найден» (это нормально).

---

## Снимки передачи

<!-- Новые снимки добавляй НИЖЕ этой строки -->

### 2026-06-27 — Снимок после активной разработки UI

**Проект:** Dev Portal — персональный веб-портал разработчика Битрикс24 на VPS.

**Что работает:**
- Полный цикл работы с проектами: просмотр, файловый браузер, VS Code, ZIP, удаление
- Панель ❓ в проектах — CLAUDE.md и журнал (state/changelog/decisions) прямо в портале
- Страница dev-portal с вкладками CLAUDE.md / Состояние / История / Решения
- Чат с Claude: SSE-стрим, продолжение диалогов через --resume, темы в сайдбаре
- Systemd надёжен: `sudo systemctl restart dev-portal` работает корректно

**В процессе / недоделано:** нет открытых задач; следующие фичи — по запросу.

**Прод:** `https://vibe.blackboxbegin.space` · сервер: `/home/deploy/dev-portal/`

**Подводные камни:**
- Claude CLI использует OAuth-подписку, не API-ключ — если сессия протухла, чат не работает
- systemd перезапускается через `Restart=always` + `KillMode=control-group` — старая схема с nohup больше не нужна

**Первое для нового исполнителя:** открыть `docs/state.md`, затем `CLAUDE.md` для полной картины архитектуры.

### 2026-06-27 — Начальная инициализация журнала

**Проект:** Dev Portal — веб-портал разработчика Битрикс24.
**Что работает:** полный функционал портала (таблицы, файловый браузер, журнал, чат).
**В процессе:** возврат на systemd, дальнейшие фичи по запросу.
**Прод:** `https://vibe.blackboxbegin.space` · VPS: `/home/deploy/dev-portal/`
**Первое для нового исполнителя:** прочитать `docs/state.md`, запустить `git log --oneline`.

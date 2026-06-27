# Dev Portal — Документация проекта

Персональный веб-портал для разработки на VPS. Доступен по адресу `https://vibe.blackboxbegin.space`.
Основная специализация — проекты для платформы **Битрикс24**.

---

## Стек технологий

| Уровень | Технология | Назначение |
|---|---|---|
| Веб-сервер / HTTPS | **Caddy** | Обратный прокси, автоматический SSL-сертификат (Let's Encrypt) |
| IDE в браузере | **code-server** | VS Code в браузере, порт `8080` (внутренний) |
| Бэкенд портала | **Node.js + Express 5** | API-сервер, порт `3000` (внутренний) |
| База данных | **SQLite** (better-sqlite3) | Хранение чатов и истории сообщений |
| Авторизация | **JWT** (jsonwebtoken) | Токен в cookie, срок 30 дней |
| Фронтенд | **Ванильный HTML/JS/CSS** | SPA без фреймворков |
| ИИ-ассистент | **Claude CLI** (`claude --print --resume`) | Использует OAuth-сессию подписки |

---

## Структура файлов

```
/home/deploy/dev-portal/          ← корень проекта
├── src/
│   └── server.js                 ← единственный серверный файл (Express)
├── public/
│   ├── index.html                ← SPA-оболочка (один HTML для всех страниц)
│   ├── css/
│   │   └── style.css             ← все стили
│   └── js/
│       └── app.js                ← весь фронтенд-код
├── docs/                         ← журнал проекта
│   ├── state.md                  ← текущее состояние (перезаписывается)
│   ├── changelog.md              ← история изменений (дописывается)
│   ├── decisions.md              ← журнал решений D-NNN (дописывается)
│   ├── handoff.md                ← точка входа для нового исполнителя
│   └── project-brief.md         ← что за проект и зачем
├── scripts/
│   └── snapshot.sh               ← быстрый git-снимок
├── data/
│   └── portal.db                 ← SQLite база данных
├── .env                          ← переменные окружения (не в git)
├── .env.example                  ← шаблон переменных окружения
├── install.sh                    ← скрипт первичной установки (запускать с sudo)
├── package.json
└── CLAUDE.md                     ← этот файл

/projects/                        ← папка проектов (каждый в своей подпапке)
├── my-project/
│   ├── CLAUDE.md                 ← спецификация проекта (опционально)
│   ├── annotation.md             ← первая строка = описание в таблице портала
│   ├── docs/                     ← журнал проекта (state/changelog/decisions/handoff)
│   └── ...

/templates/                       ← шаблоны для новых проектов
├── bitrix24-local-app/
├── bitrix24-rest-widget/
├── bitrix24-open-lines/
└── empty/
```

---

## Переменные окружения (`.env`)

```env
PORTAL_PASSWORD=...        # Пароль для входа в портал
JWT_SECRET=...             # Секрет для подписи JWT-токенов (генерируется при установке)
PORT=3000                  # Порт Express-сервера (внутренний)
PROJECTS_DIR=/projects     # Путь к папке с проектами
TEMPLATES_DIR=/templates   # Путь к папке с шаблонами
CODE_SERVER_URL=http://localhost:8080   # Адрес code-server
CLAUDE_PATH=/home/deploy/.npm-global/bin/claude   # Путь к claude CLI
DB_PATH=...                # Путь к SQLite (по умолчанию data/portal.db)
```

---

## Схема базы данных

### Таблица `chats`
```sql
id          INTEGER PRIMARY KEY AUTOINCREMENT
name        TEXT NOT NULL DEFAULT 'Новый чат'   -- название чата (до 100 символов)
topic       TEXT NOT NULL DEFAULT '!Без темы'   -- тема/группа чата
session_id  TEXT                                 -- ID сессии claude CLI для --resume
created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
```

### Таблица `messages`
```sql
id          INTEGER PRIMARY KEY AUTOINCREMENT
chat_id     INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE
role        TEXT NOT NULL CHECK(role IN ('user','assistant'))
content     TEXT NOT NULL
created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
```

**Важно:** при удалении чата все его сообщения удаляются автоматически (CASCADE).

---

## API-маршруты

### Авторизация
| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/login` | Вход по паролю, устанавливает JWT-cookie |
| `POST` | `/api/logout` | Выход, удаляет cookie |
| `GET` | `/api/me` | Проверка авторизации |

### Проекты
| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/projects` | Список папок из `/projects`, сортировка по дате изменения |
| `POST` | `/api/projects` | Создать папку проекта (опционально — из шаблона) |
| `DELETE` | `/api/projects/:name` | Удалить папку проекта рекурсивно |
| `GET` | `/api/projects/:name/open` | Получить URL для открытия в code-server |
| `GET` | `/api/projects/:name/download` | Скачать ZIP-архив проекта |
| `GET` | `/api/projects/:name/tree` | Дерево файлов проекта |
| `GET` | `/api/projects/:name/file` | Содержимое файла (`?path=...`) |
| `GET` | `/api/projects/:name/journal` | Журнал проекта: state/changelog/decisions/handoff + CLAUDE.md |
| `POST` | `/api/projects/:name/journal/entry` | Добавить запись в changelog |

### Портал (dev-portal)
| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/portal/open` | URL для открытия портала в code-server |
| `GET` | `/api/portal/tree` | Дерево файлов портала |
| `GET` | `/api/portal/file` | Содержимое файла портала (`?path=...`) |
| `GET` | `/api/portal/journal` | Журнал портала + CLAUDE.md из корня |

### Шаблоны
| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/templates` | Список шаблонов с описаниями из `annotation.md` |

### Чаты
| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/chats` | Все чаты, сортировка: тема → название |
| `GET` | `/api/chats/topics` | Список уникальных тем (для dropdown) |
| `POST` | `/api/chats` | Создать чат `{name, topic}` |
| `PATCH` | `/api/chats/:id/name` | Переименовать чат |
| `PATCH` | `/api/chats/:id/topic` | Изменить тему чата |
| `DELETE` | `/api/chats/:id` | Удалить чат со всей историей |
| `GET` | `/api/chats/:id/messages` | История сообщений чата |
| `POST` | `/api/chat` | Отправить сообщение `{chat_id, message}`, SSE-стрим ответа |

---

## Как работает чат с Claude

1. Пользователь отправляет сообщение → `POST /api/chat`
2. Сервер сохраняет сообщение пользователя в БД
3. Сервер запускает claude CLI:
   - Первое сообщение: `claude --print --verbose --output-format stream-json --dangerously-skip-permissions --model claude-sonnet-4-6 "<сообщение>"`
   - Последующие: добавляется флаг `--resume <session_id>` для продолжения диалога
4. Из потока `stream-json` извлекаются события `type: "assistant"` и передаются клиенту через **Server-Sent Events (SSE)**
5. После завершения — ответ и `session_id` сохраняются в БД
6. Клиент получает текст в реальном времени и отображает его по мере поступления

**Аутентификация Claude:** используется OAuth-сессия подписки (не API-ключ).
**Память диалога:** хранится на серверах Anthropic через `--resume`, история в БД нужна только для отображения.

---

## Фронтенд (SPA)

Вся логика — в одном файле `public/js/app.js`. Нет сборщиков, нет фреймворков.

### Страницы (разделы)
| ID секции | Навигация | Описание |
|---|---|---|
| `#page-portal` | 🅰 dev-portal | Путь портала, браузер файлов, журнал с вкладками |
| `#page-projects` | Проекты | Таблица проектов, создание, ❓ подробности, обзор файлов, VS Code, ZIP, удаление |
| `#page-templates` | Шаблоны | Карточки шаблонов, кнопка «Создать проект из шаблона» |
| `#page-journal` | Журнал | Выбор проекта, markdown-вкладки, добавление записей в changelog |
| `#page-chat` | Чат Claude | Область чата с историей и полем ввода |

### Сайдбар
```
Dev Portal
├── 🅰 dev-portal
├── 📁 Проекты
├── 📄 Шаблоны
├── 📖 Журнал
├── ▶ 🤖 Чат Claude  [+]      ← стрелка сворачивает/разворачивает список чатов
│     ├── ▶ !Без темы          ← тема (сворачиваемая группа)
│     │     Название чата 1
│     ├── ▼ Bitrix24
│     │     CRM-интеграция     ← кнопка ✕ при наведении
│     │     REST виджет задач
│     └── ▶ Архив
│
└── [Выйти]                    ← зафиксирован внизу (position: fixed)
```

- Секция «Чат Claude» изначально свёрнута; разворачивается стрелкой ▶ или при переходе на страницу чата
- Темы сортируются по алфавиту (`!` идёт первым)
- `!Без темы` — тема по умолчанию
- Кнопка «Выйти» — `position: fixed; bottom: 0` — не мешает списку чатов

### Панели-оверлеи (поверх контентной области)
| ID | Тип | Назначение |
|---|---|---|
| `#file-browser` | `.file-browser` | Дерево файлов + просмотр содержимого; типы `project`, `template`, `portal` |
| `#project-details` | `.file-browser` | Подробности проекта: путь, Обзор, VS Code, вкладки CLAUDE.md/Состояние/История/Решения |

### Вкладки журнала (используются в нескольких местах)
| Ключ | Файл | Где используется |
|---|---|---|
| `claude` | `CLAUDE.md` | dev-portal, project-details |
| `state` | `state.md` | dev-portal, project-details, journal |
| `changelog` | `changelog.md` | dev-portal, project-details, journal |
| `decisions` | `decisions.md` | dev-portal, project-details, journal |
| `handoff` | `handoff.md` | journal |

### Статус-бар (во время ожидания ответа от Claude)
```
⠹  Обрабатываю...                              8 с
```
- Braille-спиннер (10 кадров, 100ms/кадр)
- Статус меняется по времени: «Отправка» → «Читаю» → «Обрабатываю» → «Формирую ответ» → «Ещё немного»
- Таймер в секундах / минутах
- Исчезает при получении первого чанка текста

### Модальные окна
| ID | Назначение |
|---|---|
| `#modal-new-project` | Создание проекта (название + выбор шаблона) |
| `#modal-delete` | Подтверждение удаления проекта |
| `#modal-new-chat` | Создание чата (название + тема: dropdown существующих или новая) |
| `#modal-rename-name` | Переименование чата |
| `#modal-rename-topic` | Смена темы (dropdown + поле для новой темы) |

---

## Systemd-сервисы

```bash
# Портал
sudo systemctl status dev-portal
sudo systemctl restart dev-portal
sudo systemctl stop dev-portal

# VS Code в браузере
sudo systemctl status code-server@deploy
sudo systemctl restart code-server@deploy
```

Параметры `dev-portal.service` (`/etc/systemd/system/dev-portal.service`):
- `Restart=always` — перезапуск при любом коде выхода
- `KillMode=control-group` — убивает все процессы cgroup, не только main PID
- `StartLimitIntervalSec=0` — без ограничения на частоту перезапусков
- `TimeoutStopSec=10` — SIGKILL через 10 сек если процесс завис

### Конфиг code-server
`~/.config/code-server/config.yaml`
```yaml
bind-addr: 127.0.0.1:8080
auth: none      # авторизация через Caddy
cert: false
```

### Caddyfile
`/etc/caddy/Caddyfile`
```
vibe.blackboxbegin.space {
    handle /vscode* {
        reverse_proxy localhost:8080
    }
    handle {
        reverse_proxy localhost:3000
    }
}
```

---

## Первичная установка

```bash
# Запустить один раз с правами root
sudo bash /home/deploy/dev-portal/install.sh

# Установить пароль
nano /home/deploy/dev-portal/.env   # PORTAL_PASSWORD=...

# Перезапустить портал
sudo systemctl restart dev-portal
```

Скрипт `install.sh` выполняет:
1. Создание `/projects` и `/templates` с шаблонами Битрикс24
2. Установку Caddy (apt)
3. Установку code-server
4. Генерацию `.env` с случайным JWT_SECRET
5. Регистрацию и запуск systemd-сервисов

---

## Шаблоны Битрикс24

| Папка | Описание | Технология |
|---|---|---|
| `bitrix24-local-app` | Локальное приложение с OAuth-авторизацией | PHP |
| `bitrix24-rest-widget` | Виджет для встройки в интерфейс Б24 | JavaScript (BX24 JS SDK) |
| `bitrix24-open-lines` | Чат-бот для Открытых линий | Node.js + Express |
| `empty` | Пустой проект | — |

Каждый шаблон содержит:
- `annotation.md` — первая строка = описание в таблице портала
- `README.md` — инструкция по запуску
- `.env.example` — шаблон переменных окружения

---

## Деплой проектов

Деплой производится на **отдельный VPS** (не этот).
Этот VPS используется только для разработки.
Основной домен: `blackboxbegin.space`
Портал разработки: `vibe.blackboxbegin.space`

---

## ЖУРНАЛ ПРОЕКТА И КОММИТЫ — ГЛАВНОЕ ПРАВИЛО

Ведём **журнал**, чтобы проект можно было передать другому
исполнителю — другой нейронке или человеку — без потери контекста. Любой,
кто откроет проект, должен понять **что делали, где сейчас и куда идём**,
не читая весь код.

**Память проекта — пять файлов. Точка входа: [docs/handoff.md](docs/handoff.md).**

| Файл | Роль | Как меняется |
|------|------|--------------|
| `docs/handoff.md` | С чего начать новому исполнителю | при передаче |
| `docs/project-brief.md` | Что за проект и зачем | редко |
| `docs/state.md` | Где мы **сейчас** + следующие шаги | постоянно (перезапись) |
| `docs/changelog.md` | Что уже **сделано**, по датам | дописывается вниз |
| `docs/decisions.md` | **Почему** так, а не иначе | дописывается вниз |

**Железное правило — после каждого осмысленного шага:**

1. Обнови `docs/state.md` — где сейчас и что дальше.
2. Допиши `docs/changelog.md` — одна запись про шаг.
3. Был неочевидный выбор? — запись в `docs/decisions.md` (D-NNN).
4. Снимок в git: `bash scripts/snapshot.sh "<что сделали>"`.

Проще всего — слэш-команды (делают всё это сами):
`/log` — записать шаг и закоммитить · `/decision` — зафиксировать решение ·
`/handoff` — собрать снимок передачи.

«Осмысленный шаг» = добавили фичу, починили баг, задеплоили, приняли
решение, закончили рабочую сессию. Не нужно коммитить каждую строчку —
коммить законченные кусочки.

**Почему так:** история проекта = git-коммиты + `docs/`. `state.md`
отвечает «где мы», `changelog.md` — «что было», `decisions.md` — «почему».
Этого достаточно, чтобы кто угодно подхватил проект с того места, где его оставили.

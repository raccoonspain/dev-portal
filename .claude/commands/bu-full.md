---
description: Полный бэкап dev-portal — анализ, инструкция по переносу, архив
---

Создай полный бэкап dev-portal. Действуй строго по порядку.

Дополнительный контекст (если передан): $ARGUMENTS

---

## Шаг 1 — Анализ окружения

Собери актуальную картину. Выполни последовательно:

```bash
# Версии и пути
node --version && npm --version
which claude && claude --version 2>/dev/null || echo "claude CLI: путь нестандартный"

# Структура проекта
ls -la /home/deploy/dev-portal/
cat /home/deploy/dev-portal/package.json

# База данных
ls -lh /home/deploy/dev-portal/data/
sqlite3 /home/deploy/dev-portal/data/portal.db "SELECT COUNT(*) as chats FROM chats; SELECT COUNT(*) as messages FROM messages;" 2>/dev/null

# Переменные окружения (только ключи, не значения)
cat /home/deploy/dev-portal/.env.example

# Claude OAuth
ls -la /home/deploy/.claude/.credentials.json 2>/dev/null && echo "credentials: ЕСТЬ" || echo "credentials: ОТСУТСТВУЕТ"

# Шаблоны и проекты
du -sh /templates/ 2>/dev/null && ls /templates/ 2>/dev/null
du -sh /projects/ 2>/dev/null && ls /projects/ 2>/dev/null

# Caddy и systemd
cat /etc/caddy/Caddyfile 2>/dev/null
cat /home/deploy/.config/code-server/config.yaml 2>/dev/null
systemctl is-active dev-portal code-server@deploy caddy
```

Запомни результаты — они войдут в `howtoextract.md` и `log.md`.

---

## Шаг 2 — Подготовка директории бэкапа

```bash
BU_TS=$(date +%Y-%m-%d-%H%M%S)
BU_DIR=/bu/bu-$BU_TS
mkdir -p $BU_DIR/files
echo $BU_DIR
```

Запомни `BU_DIR` — он используется во всех следующих шагах.

---

## Шаг 3 — Checkpoint БД и копирование файлов

```bash
# Сбросить WAL в основной файл БД
sqlite3 /home/deploy/dev-portal/data/portal.db "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null

# Файлы приложения
cp /home/deploy/dev-portal/data/portal.db          $BU_DIR/files/portal.db
cp /home/deploy/dev-portal/.env                    $BU_DIR/files/dot-env.txt

# Claude OAuth-сессия
cp /home/deploy/.claude/.credentials.json           $BU_DIR/files/claude-credentials.json 2>/dev/null \
  || echo "WARN: .credentials.json не найден — пропущен"

# Шаблоны (если не пустые)
[ "$(ls -A /templates/ 2>/dev/null)" ] \
  && cp -r /templates/ $BU_DIR/files/templates \
  || echo "INFO: /templates/ пустая — пропущена"

# Проекты пользователя (если есть)
[ "$(ls -A /projects/ 2>/dev/null)" ] \
  && cp -r /projects/ $BU_DIR/files/projects \
  || echo "INFO: /projects/ пустая — пропущена"

# Конфиги системы
mkdir -p $BU_DIR/files/system
cp /etc/caddy/Caddyfile                            $BU_DIR/files/system/Caddyfile 2>/dev/null
cp /home/deploy/.config/code-server/config.yaml    $BU_DIR/files/system/code-server-config.yaml 2>/dev/null
systemctl cat dev-portal 2>/dev/null               > $BU_DIR/files/system/dev-portal.service

ls -lR $BU_DIR/files/
```

---

## Шаг 4 — Написать `howtoextract.md`

На основе данных из шага 1 создай файл `$BU_DIR/howtoextract.md`.

Файл должен содержать:

1. **Заголовок** — дата и время бэкапа, с какого сервера снят.
2. **Содержимое архива** — список файлов с пояснением, зачем каждый нужен.
3. **Требования к новому серверу** — ОС, пакеты (Node.js версия X, Caddy, code-server), пользователь `deploy`.
4. **Пошаговая инструкция восстановления** — точные команды bash в правильном порядке:
   - Создание пользователя deploy (если нужен)
   - Клонирование репозитория git
   - `npm install`
   - Восстановление файлов из архива (куда что положить)
   - Настройка `/etc/caddy/Caddyfile` (указать актуальный домен)
   - Настройка code-server
   - Регистрация и запуск systemd-сервисов
   - Проверка работоспособности (`curl`, `systemctl status`)
5. **Что НЕ переносится** — node_modules, WAL-файлы БД, временные файлы.
6. **Возможные проблемы** — Claude credentials могут протухнуть, нужно `claude login`; JWT_SECRET можно сгенерить заново.

Пиши по-русски, конкретными командами. Не пиши то, что очевидно — пиши то, что легко забыть.

---

## Шаг 5 — Написать `log.md`

Создай файл `$BU_DIR/log.md` со следующим содержимым:

```
# Лог бэкапа

Дата:    <текущая дата и время>
Сервер:  <hostname>
Создал:  Claude (bu-full)

## Что скопировано

- portal.db — SQLite БД (<размер>, <N> чатов, <M> сообщений)
- dot-env.txt — переменные окружения (.env)
- claude-credentials.json — OAuth-сессия Claude CLI [ЕСТЬ / ОТСУТСТВОВАЛ]
- templates/ — шаблоны проектов [<N> папок / пустая]
- projects/ — проекты пользователя [<N> папок / пустая]
- system/Caddyfile — конфиг Caddy
- system/code-server-config.yaml — конфиг code-server
- system/dev-portal.service — юнит systemd

## Состояние сервисов на момент бэкапа

dev-portal:       <active/inactive>
code-server:      <active/inactive>
caddy:            <active/inactive>

## Версии

Node.js: <версия>
npm:     <версия>
Claude:  <версия>

## Примечания

<если были предупреждения или пропущенные файлы — написать сюда>
```

Заполни реальными данными из шага 1.

---

## Шаг 6 — Создать tar-архив

```bash
tar czf /bu/bu-$BU_TS.tar.gz -C /bu bu-$BU_TS/

# Проверка
ls -lh /bu/bu-$BU_TS.tar.gz
tar tzf /bu/bu-$BU_TS.tar.gz | head -30
```

---

## Шаг 7 — Итог

Ответь кратко:
- Путь к архиву и его размер
- Что вошло (список файлов/папок)
- Что было пропущено и почему
- Сколько чатов и сообщений в БД

Не задавай лишних вопросов — если что-то не найдено, пропусти с пометкой в `log.md`.

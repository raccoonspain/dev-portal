#!/bin/bash
set -e

DEPLOY_USER="deploy"
PORTAL_DIR="/home/deploy/dev-portal"
PROJECTS_DIR="/projects"
TEMPLATES_DIR="/templates"

echo "==> Создание директорий проектов и шаблонов..."
mkdir -p "$PROJECTS_DIR" "$TEMPLATES_DIR"
chown "$DEPLOY_USER:$DEPLOY_USER" "$PROJECTS_DIR" "$TEMPLATES_DIR"
chmod 755 "$PROJECTS_DIR" "$TEMPLATES_DIR"

echo "==> Создание шаблонов Bitrix24..."

# --- Шаблон 1: Локальное приложение Bitrix24 ---
T1="$TEMPLATES_DIR/bitrix24-local-app"
mkdir -p "$T1"
echo "Локальное PHP-приложение для Bitrix24" > "$T1/.description"
cat > "$T1/index.php" << 'PHPEOF'
<?php
// Bitrix24 Local App Entry Point
$app_id = $_REQUEST['APP_ID'] ?? '';
$auth_token = $_REQUEST['AUTH_ID'] ?? '';
$refresh_token = $_REQUEST['REFRESH_ID'] ?? '';
$domain = $_REQUEST['DOMAIN'] ?? '';
?>
<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"><title>Bitrix24 App</title></head>
<body>
<h1>Моё приложение Bitrix24</h1>
<p>Domain: <?= htmlspecialchars($domain) ?></p>
</body>
</html>
PHPEOF
cat > "$T1/.env.example" << 'EOF'
B24_CLIENT_ID=
B24_CLIENT_SECRET=
APP_URL=https://your-domain.com
EOF
cat > "$T1/README.md" << 'EOF'
# Bitrix24 Local App

Шаблон локального приложения для Bitrix24.

## Настройка
1. Скопируйте `.env.example` в `.env` и заполните параметры
2. Настройте адрес приложения в Bitrix24 → Приложения
3. Загрузите на сервер с PHP

## Документация
https://apidocs.bitrix24.com/
EOF
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$T1"

# --- Шаблон 2: REST-виджет (JavaScript) ---
T2="$TEMPLATES_DIR/bitrix24-rest-widget"
mkdir -p "$T2"
echo "JavaScript REST-виджет для интерфейса Bitrix24" > "$T2/.description"
cat > "$T2/index.html" << 'EOF'
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Bitrix24 Widget</title>
  <script src="//api.bitrix24.com/api/v1/"></script>
</head>
<body>
  <div id="app">Загрузка...</div>
  <script src="app.js"></script>
</body>
</html>
EOF
cat > "$T2/app.js" << 'EOF'
BX24.init(function() {
  BX24.callMethod('user.current', {}, function(result) {
    if (result.error()) {
      document.getElementById('app').textContent = 'Ошибка: ' + result.error();
      return;
    }
    const user = result.data();
    document.getElementById('app').innerHTML =
      `<h2>Привет, ${user.NAME} ${user.LAST_NAME}!</h2>
       <p>ID: ${user.ID}</p>`;
  });
});
EOF
cat > "$T2/README.md" << 'EOF'
# Bitrix24 REST Widget

JavaScript-виджет для встройки в интерфейс Bitrix24.

## Использование
1. Разместите файлы на HTTPS-сервере
2. Зарегистрируйте приложение в Bitrix24 → Приложения → Добавить

## Документация
https://apidocs.bitrix24.com/api/bitrix24-js-sdk/
EOF
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$T2"

# --- Шаблон 3: Open Lines / Чат-бот ---
T3="$TEMPLATES_DIR/bitrix24-open-lines"
mkdir -p "$T3/src"
echo "Чат-бот для Open Lines (Открытых линий) Bitrix24" > "$T3/.description"
cat > "$T3/src/bot.js" << 'EOF'
// Bitrix24 Open Lines Bot
const express = require('express');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Webhook от Bitrix24
app.post('/webhook', (req, res) => {
  const event = req.body.event;
  const data = req.body.data;

  console.log('Event:', event, data);

  if (event === 'ONIMBOTMESSAGEADD') {
    const dialogId = data.PARAMS?.DIALOG_ID;
    const text = data.PARAMS?.MESSAGE;
    // Ответить пользователю
    // TODO: вызвать B24 REST API imbot.message.add
    console.log(`Message from ${dialogId}: ${text}`);
  }

  res.send('OK');
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Bot listening on port ${PORT}`));
EOF
cat > "$T3/package.json" << 'EOF'
{
  "name": "bitrix24-open-lines-bot",
  "version": "1.0.0",
  "main": "src/bot.js",
  "scripts": { "start": "node src/bot.js", "dev": "node --watch src/bot.js" },
  "dependencies": { "express": "^4.18.0", "dotenv": "^16.0.0" }
}
EOF
cat > "$T3/.env.example" << 'EOF'
B24_WEBHOOK_URL=https://your-portal.bitrix24.ru/rest/1/xxxxx/
BOT_ID=
PORT=3001
EOF
cat > "$T3/README.md" << 'EOF'
# Bitrix24 Open Lines Bot

Чат-бот для Открытых линий Bitrix24.

## Установка
```
npm install
cp .env.example .env
# Заполнить .env
npm start
```

## Документация
https://apidocs.bitrix24.com/api/chat-bots/
EOF
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$T3"

# --- Шаблон 4: Пустой проект ---
T4="$TEMPLATES_DIR/empty"
mkdir -p "$T4"
echo "Пустой проект без шаблона" > "$T4/.description"
cat > "$T4/README.md" << 'EOF'
# Новый проект

Опишите проект здесь.
EOF
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$T4"

echo "==> Установка Caddy..."
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl -q
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -q
apt-get install -y caddy

echo "==> Установка code-server..."
curl -fsSL https://code-server.dev/install.sh | sh

echo "==> Настройка code-server..."
mkdir -p /home/$DEPLOY_USER/.config/code-server
cat > /home/$DEPLOY_USER/.config/code-server/config.yaml << 'EOF'
bind-addr: 127.0.0.1:8080
auth: none
password: ""
cert: false
EOF
chown -R "$DEPLOY_USER:$DEPLOY_USER" /home/$DEPLOY_USER/.config/code-server

echo "==> Создание .env файла портала..."
if [ ! -f "$PORTAL_DIR/.env" ]; then
  JWT_SECRET=$(openssl rand -hex 32)
  cat > "$PORTAL_DIR/.env" << EOF
PORTAL_PASSWORD=changeme
JWT_SECRET=$JWT_SECRET
PORT=3000
PROJECTS_DIR=/projects
TEMPLATES_DIR=/templates
CODE_SERVER_URL=http://localhost:8080
CLAUDE_PATH=/home/deploy/.npm-global/bin/claude
EOF
  chown "$DEPLOY_USER:$DEPLOY_USER" "$PORTAL_DIR/.env"
  echo "   ВАЖНО: Смените PORTAL_PASSWORD в $PORTAL_DIR/.env"
else
  echo "   .env уже существует, пропускаем"
fi

echo "==> Настройка Caddyfile..."
cat > /etc/caddy/Caddyfile << 'EOF'
vibe.blackboxbegin.space {
    # VS Code (code-server)
    handle /vscode* {
        reverse_proxy localhost:8080
    }

    # Dev Portal
    handle {
        reverse_proxy localhost:3000
    }
}
EOF

echo "==> Создание systemd-сервиса для портала..."
cat > /etc/systemd/system/dev-portal.service << EOF
[Unit]
Description=Dev Portal
After=network.target

[Service]
Type=simple
User=$DEPLOY_USER
WorkingDirectory=$PORTAL_DIR
ExecStart=/usr/bin/node $PORTAL_DIR/src/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

echo "==> Настройка code-server для пользователя $DEPLOY_USER..."
systemctl enable --now code-server@$DEPLOY_USER

echo "==> Перезапуск Caddy..."
systemctl enable --now caddy
systemctl reload caddy

echo "==> Запуск портала..."
systemctl daemon-reload
systemctl enable --now dev-portal

echo ""
echo "====================================="
echo "  Установка завершена!"
echo "====================================="
echo ""
echo "  URL: https://vibe.blackboxbegin.space"
echo "  Пароль: (установлен в $PORTAL_DIR/.env)"
echo ""
echo "  ВАЖНО: Смените пароль:"
echo "  nano $PORTAL_DIR/.env"
echo "  PORTAL_PASSWORD=ВАШ_ПАРОЛЬ"
echo ""
echo "  Затем перезапустите портал:"
echo "  systemctl restart dev-portal"
echo "====================================="

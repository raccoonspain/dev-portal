# Server Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить вкладку «Сервер» на страницу dev-portal, показывающую CPU/RAM/диск и таблицу процессов с клиентской сортировкой.

**Architecture:** Новый API-маршрут `GET /api/server/stats` читает `/proc/stat` (два снимка, 200ms пауза), `/proc/meminfo` и запускает `df -h /` + `ps aux` через `execSync`. Фронтенд добавляет вкладку к существующим `.pjtab` и рендерит дашборд в `#portal-journal-content`.

**Tech Stack:** Node.js + `child_process.execSync`, ванильный JS/HTML/CSS, без новых npm-зависимостей.

## Global Constraints

- Нет новых npm-зависимостей
- Только Linux (`/proc`, `ps`, `df`)
- Стиль — следовать существующей CSS-переменным (`--bg`, `--bg2`, `--bg3`, `--border`, `--accent`, `--text`, `--text-muted`, `--radius`, `--danger`)
- Экранировать пользовательские данные через `esc()` везде, где данные идут в innerHTML
- Сортировка — только на клиенте, без нового запроса к серверу

---

## Task 1: Backend API — `GET /api/server/stats`

**Files:**
- Modify: `src/server.js:5` (добавить `execSync` к импорту)
- Modify: `src/server.js:478` (добавить маршрут перед SPA-fallback)

**Interfaces:**
- Produces: `GET /api/server/stats` → JSON:
  ```json
  {
    "cpu":  { "used": 12.5 },
    "ram":  { "total": 8192, "used": 3400, "free": 4792 },
    "disk": { "total": "50G", "used": "18G", "free": "32G", "pct": 36 },
    "processes": [
      { "pid": 1234, "user": "deploy", "cpu": 5.2, "mem": 1.8, "cmd": "node server.js" }
    ]
  }
  ```
  RAM в МБ. CPU `used` — процент с одним знаком после запятой.

- [ ] **Step 1: Добавить `execSync` к импорту**

Найти строку в `src/server.js`:
```javascript
const { spawn } = require('child_process');
```
Заменить на:
```javascript
const { spawn, execSync } = require('child_process');
```

- [ ] **Step 2: Добавить маршрут `/api/server/stats`**

Вставить перед строкой `// --- SPA fallback ---` в `src/server.js`:

```javascript
// --- Server stats ---
app.get('/api/server/stats', auth, async (req, res) => {
  try {
    // CPU: два снимка /proc/stat с паузой 200ms
    function readCpuLine() {
      const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
      const parts = line.trim().split(/\s+/).slice(1).map(Number);
      const idle = parts[3] + (parts[4] || 0); // idle + iowait
      const total = parts.reduce((a, b) => a + b, 0);
      return { idle, total };
    }
    const snap1 = readCpuLine();
    await new Promise(r => setTimeout(r, 200));
    const snap2 = readCpuLine();
    const deltaIdle = snap2.idle - snap1.idle;
    const deltaTotal = snap2.total - snap1.total;
    const cpuUsed = deltaTotal > 0 ? Math.round(100 * (1 - deltaIdle / deltaTotal) * 10) / 10 : 0;

    // RAM: /proc/meminfo (значения в kB → МБ)
    const memInfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const getMemVal = key => {
      const m = memInfo.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
      return m ? Math.round(parseInt(m[1]) / 1024) : 0;
    };
    const ramTotal = getMemVal('MemTotal');
    const ramAvail = getMemVal('MemAvailable');
    const ramUsed = ramTotal - ramAvail;

    // Disk: df -h /
    const dfOut = execSync('df -h /', { encoding: 'utf8' });
    const dfParts = dfOut.trim().split('\n')[1].trim().split(/\s+/);
    const disk = {
      total: dfParts[1],
      used: dfParts[2],
      free: dfParts[3],
      pct: parseInt(dfParts[4])
    };

    // Processes: ps aux --sort=-%cpu --no-headers
    // Колонки: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND...
    const psOut = execSync('ps aux --sort=-%cpu --no-headers', { encoding: 'utf8' });
    const processes = psOut.trim().split('\n')
      .filter(l => l.trim())
      .map(line => {
        const parts = line.trim().split(/\s+/);
        return {
          user: parts[0],
          pid: parseInt(parts[1]),
          cpu: parseFloat(parts[2]),
          mem: parseFloat(parts[3]),
          cmd: parts.slice(10).join(' ')
        };
      });

    res.json({
      cpu: { used: cpuUsed },
      ram: { total: ramTotal, used: ramUsed, free: ramAvail },
      disk,
      processes
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3: Перезапустить сервер и проверить маршрут**

```bash
sudo systemctl restart dev-portal && sleep 2
# Получить токен через логин и проверить маршрут:
TOKEN=$(curl -s -c /tmp/cookie.txt -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"password":"'$(grep PORTAL_PASSWORD /home/deploy/dev-portal/.env | cut -d= -f2)'"}' \
  && curl -s -b /tmp/cookie.txt http://localhost:3000/api/me)
curl -s -b /tmp/cookie.txt http://localhost:3000/api/server/stats | python3 -m json.tool | head -30
```

Ожидаемый результат: JSON с ключами `cpu`, `ram`, `disk`, `processes`. `cpu.used` — число. `processes` — массив объектов.

- [ ] **Step 4: Commit**

```bash
git add src/server.js
git commit -m "feat: API /api/server/stats — CPU, RAM, диск, процессы"
```

---

## Task 2: Frontend — вкладка «Сервер» (HTML + JS + CSS)

**Files:**
- Modify: `public/index.html` (добавить кнопку вкладки)
- Modify: `public/js/app.js` (добавить state-переменные, обновить `renderPortalJournalTab`, добавить `loadServerStats`, `renderServerDashboard`, `sortProcesses`)
- Modify: `public/css/style.css` (добавить стили дашборда)

**Interfaces:**
- Consumes: `GET /api/server/stats` → `{ cpu, ram, disk, processes }` (из Task 1)
- Consumes: существующий `api(method, url)` хелпер из `app.js`
- Consumes: существующий `esc(str)` хелпер из `app.js`
- Consumes: существующий паттерн `.pjtab[data-tab]` + `portalJournalTab` переменная

- [ ] **Step 1: Добавить кнопку вкладки в `index.html`**

Найти в `public/index.html`:
```html
            <button class="pjtab" data-tab="decisions">Решения</button>
```
Заменить на:
```html
            <button class="pjtab" data-tab="decisions">Решения</button>
            <button class="pjtab" data-tab="server">Сервер</button>
```

- [ ] **Step 2: Добавить state-переменные в `app.js`**

Найти в `public/js/app.js` блок объявления переменных (в начале файла, после `'use strict';`). Найти строку:
```javascript
let pcpPastedImage = null;
```
Добавить после неё:
```javascript
let serverStatsData = null;
let serverSortCol = 'cpu';
let serverSortDir = 'desc';
```

- [ ] **Step 3: Обновить `renderPortalJournalTab` в `app.js`**

Найти функцию:
```javascript
function renderPortalJournalTab(tab) {
  const content = document.getElementById('portal-journal-content');
  if (!portalJournalData) { content.innerHTML = '<div class="empty-state">Загрузка...</div>'; return; }
```
Заменить на:
```javascript
function renderPortalJournalTab(tab) {
  const content = document.getElementById('portal-journal-content');
  if (tab === 'server') {
    if (serverStatsData) renderServerDashboard(content);
    else loadServerStats(content);
    return;
  }
  if (!portalJournalData) { content.innerHTML = '<div class="empty-state">Загрузка...</div>'; return; }
```

- [ ] **Step 4: Добавить функции `loadServerStats`, `renderServerDashboard`, `sortProcesses` в `app.js`**

В конце файла `public/js/app.js`, перед последней закрывающей строкой (или в конце файла), добавить:

```javascript
// ── Server dashboard ──
async function loadServerStats(container) {
  container.innerHTML = '<div class="empty-state">Загрузка данных сервера...</div>';
  try {
    serverStatsData = await api('GET', '/api/server/stats');
    renderServerDashboard(container);
  } catch (e) {
    container.innerHTML = `<div class="empty-state error">${esc(e.message)}</div>`;
  }
}

function barColor(pct) {
  if (pct > 85) return 'var(--srv-red)';
  if (pct > 60) return 'var(--srv-yellow)';
  return 'var(--srv-green)';
}

function metricCard(label, pct, valHtml) {
  const color = barColor(pct);
  return `<div class="server-card">
    <div class="server-card-label">${label}</div>
    <div class="server-bar-wrap"><div class="server-bar" style="width:${Math.min(pct, 100)}%;background:${color}"></div></div>
    <div class="server-card-val">${valHtml}</div>
  </div>`;
}

function sortProcesses(procs) {
  return [...procs].sort((a, b) => {
    let va, vb;
    if (serverSortCol === 'cpu') { va = a.cpu; vb = b.cpu; }
    else if (serverSortCol === 'mem') { va = a.mem; vb = b.mem; }
    else { va = a.cmd.toLowerCase(); vb = b.cmd.toLowerCase(); }
    if (va < vb) return serverSortDir === 'asc' ? -1 : 1;
    if (va > vb) return serverSortDir === 'asc' ? 1 : -1;
    return 0;
  });
}

function renderServerDashboard(container) {
  const { cpu, ram, disk, processes } = serverStatsData;
  const now = new Date().toLocaleTimeString('ru-RU');
  const ramPct = Math.round(ram.used / ram.total * 100);
  const ramTotalGB = (ram.total / 1024).toFixed(1);
  const ramUsedGB = (ram.used / 1024).toFixed(1);

  function thCls(col) { return `sortable${serverSortCol === col ? ' sort-active' : ''}`; }
  function thArrow(col) {
    if (serverSortCol !== col) return '';
    return serverSortDir === 'desc' ? ' &#9660;' : ' &#9650;';
  }

  const sorted = sortProcesses(processes);
  const rows = sorted.map(p => `<tr>
    <td>${p.pid}</td>
    <td>${esc(p.user)}</td>
    <td>${p.cpu.toFixed(1)}</td>
    <td>${p.mem.toFixed(1)}</td>
    <td class="server-cmd">${esc(p.cmd)}</td>
  </tr>`).join('');

  container.innerHTML = `
    <div class="server-toolbar">
      <button id="server-refresh-btn" class="btn-primary">&#8635; Обновить</button>
      <span class="server-updated">Обновлено: ${esc(now)}</span>
    </div>
    <div class="server-cards-row">
      ${metricCard('CPU', cpu.used, `${cpu.used}%`)}
      ${metricCard('RAM', ramPct, `${ramUsedGB} / ${ramTotalGB} GB`)}
      ${metricCard('Диск', disk.pct, `${esc(disk.used)} / ${esc(disk.total)}`)}
    </div>
    <div class="server-procs-wrap">
      <table class="data-table">
        <thead><tr>
          <th>PID</th><th>USER</th>
          <th class="${thCls('cpu')}" data-sort="cpu">CPU%${thArrow('cpu')}</th>
          <th class="${thCls('mem')}" data-sort="mem">MEM%${thArrow('mem')}</th>
          <th class="${thCls('cmd')}" data-sort="cmd">COMMAND${thArrow('cmd')}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  document.getElementById('server-refresh-btn').addEventListener('click', () => {
    serverStatsData = null;
    loadServerStats(container);
  });

  container.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (serverSortCol === col) {
        serverSortDir = serverSortDir === 'desc' ? 'asc' : 'desc';
      } else {
        serverSortCol = col;
        serverSortDir = col === 'cmd' ? 'asc' : 'desc';
      }
      renderServerDashboard(container);
    });
  });
}
```

- [ ] **Step 5: Добавить стили в `style.css`**

Добавить в конец файла `public/css/style.css`:

```css
/* ── Server dashboard ── */
:root {
  --srv-green: #4caf7d;
  --srv-yellow: #f0a500;
  --srv-red: #e05252;
}

.server-toolbar {
  display: flex; align-items: center; gap: 16px;
  padding: 16px 0 12px; flex-shrink: 0;
}
.server-updated { font-size: 13px; color: var(--text-muted); }

.server-cards-row {
  display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap;
}
.server-card {
  flex: 1; min-width: 160px; background: var(--bg2);
  border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 20px;
}
.server-card-label {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 10px;
}
.server-bar-wrap {
  height: 6px; background: var(--bg3); border-radius: 3px;
  overflow: hidden; margin-bottom: 8px;
}
.server-bar { height: 100%; border-radius: 3px; transition: width 0.3s; }
.server-card-val { font-size: 14px; font-weight: 500; }

.server-procs-wrap { overflow-y: auto; }
th.sortable { cursor: pointer; user-select: none; }
th.sortable:hover { color: var(--text); }
th.sort-active { color: var(--accent); }
.server-cmd {
  max-width: 400px; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; font-family: monospace; font-size: 12px;
}
```

- [ ] **Step 6: Проверить в браузере**

1. Открыть `https://vibe.blackboxbegin.space`
2. Перейти на страницу «🅰 dev-portal»
3. Убедиться, что вкладка «Сервер» появилась после «Решения»
4. Нажать «Сервер» — данные должны загрузиться (CPU, RAM, Диск + таблица)
5. Нажать заголовок «MEM%» — таблица пересортируется по памяти, появится стрелка ▼
6. Нажать «MEM%» снова — стрелка меняется на ▲ (asc)
7. Нажать «COMMAND» — сортировка по алфавиту ▲
8. Нажать «🔄 Обновить» — данные перезагружаются, время обновляется
9. Убедиться, что остальные вкладки (CLAUDE.md, Состояние, и т.д.) работают без изменений

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/js/app.js public/css/style.css
git commit -m "feat: дашборд ресурсов сервера — вкладка Сервер на странице dev-portal"
```

---

## После реализации

Обновить `docs/state.md` и `docs/changelog.md`, запустить `bash scripts/snapshot.sh "feat: дашборд ресурсов сервера"`.

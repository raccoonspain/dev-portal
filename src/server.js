const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const archiver = require('archiver');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3000;
const PROJECTS_DIR = process.env.PROJECTS_DIR || '/projects';
const TEMPLATES_DIR = process.env.TEMPLATES_DIR || '/templates';
const PORTAL_DIR = path.resolve(__dirname, '..');
const PORTAL_TREE_IGNORE = new Set(['node_modules', '.git', 'data']);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD || 'changeme';
const CODE_SERVER_URL = process.env.CODE_SERVER_URL || 'http://localhost:8080';
const CLAUDE_PATH = process.env.CLAUDE_PATH || '/home/deploy/.npm-global/bin/claude';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/portal.db');

// --- Database ---
ensureDir(path.dirname(DB_PATH));
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT 'Новый чат',
    topic TEXT NOT NULL DEFAULT '!Без темы',
    session_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user','assistant')),
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
// migrate: add name column if missing (for existing DBs)
const cols = db.pragma('table_info(chats)').map(c => c.name);
if (!cols.includes('name')) {
  db.exec("ALTER TABLE chats ADD COLUMN name TEXT NOT NULL DEFAULT 'Новый чат'");
}

// --- Middleware ---
app.use((req, res, next) => {
  const raw = req.headers.cookie || '';
  req.cookies = Object.fromEntries(
    raw.split(';').map(c => c.trim().split('=').map(decodeURIComponent)).filter(a => a.length === 2)
  );
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

function auth(req, res, next) {
  const token = req.cookies?.token || req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// --- Auth ---
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password !== PORTAL_PASSWORD) return res.status(401).json({ error: 'Wrong password' });
  const token = jwt.sign({ ok: true }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 3600 * 1000, sameSite: 'strict' });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json({ ok: true }));

// --- Projects ---
app.get('/api/projects', auth, (req, res) => {
  ensureDir(PROJECTS_DIR);
  const items = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const fullPath = path.join(PROJECTS_DIR, d.name);
      const stat = fs.statSync(fullPath);
      const annotationFile = path.join(fullPath, 'annotation.md');
      const description = fs.existsSync(annotationFile)
        ? fs.readFileSync(annotationFile, 'utf8').split('\n').find(l => l.trim()) || ''
        : '';
      return { name: d.name, description, fullPath, created: stat.birthtime, modified: stat.mtime };
    })
    .sort((a, b) => b.modified - a.modified);
  res.json(items);
});

app.post('/api/projects', auth, (req, res) => {
  const { name, template } = req.body;
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) return res.status(400).json({ error: 'Invalid name' });
  const dest = path.join(PROJECTS_DIR, name);
  if (fs.existsSync(dest)) return res.status(409).json({ error: 'Already exists' });
  ensureDir(PROJECTS_DIR);
  if (template) {
    const src = path.join(TEMPLATES_DIR, template);
    if (!fs.existsSync(src)) return res.status(404).json({ error: 'Template not found' });
    copyDir(src, dest);
  } else {
    fs.mkdirSync(dest, { recursive: true });
  }
  res.json({ ok: true, name });
});

// --- Project journal ---
const JOURNAL_FILES = ['state.md', 'changelog.md', 'decisions.md', 'handoff.md'];

app.get('/api/projects/:name/journal', auth, (req, res) => {
  const name = req.params.name;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return res.status(400).json({ error: 'Invalid name' });
  const folder = path.join(PROJECTS_DIR, name);
  if (!fs.existsSync(folder)) return res.status(404).json({ error: 'Not found' });
  const docsDir = path.join(folder, 'docs');
  const result = {};
  for (const file of JOURNAL_FILES) {
    const p = path.join(docsDir, file);
    result[file] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  }
  const claudeMd = path.join(folder, 'CLAUDE.md');
  result['CLAUDE.md'] = fs.existsSync(claudeMd) ? fs.readFileSync(claudeMd, 'utf8') : null;
  res.json(result);
});

app.post('/api/projects/:name/journal/entry', auth, (req, res) => {
  const name = req.params.name;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return res.status(400).json({ error: 'Invalid name' });
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' });
  const folder = path.join(PROJECTS_DIR, name);
  if (!fs.existsSync(folder)) return res.status(404).json({ error: 'Not found' });
  const docsDir = path.join(folder, 'docs');
  ensureDir(docsDir);
  const changelogPath = path.join(docsDir, 'changelog.md');

  const date = new Date().toISOString().slice(0, 10);
  const entry = `\n## ${date} — ${text.trim()}\n`;

  if (!fs.existsSync(changelogPath)) {
    fs.writeFileSync(changelogPath, `# История изменений\n\n<!-- Новые записи добавляй СВЕРХУ -->\n${entry}`);
  } else {
    const current = fs.readFileSync(changelogPath, 'utf8');
    const marker = '<!-- Новые записи добавляй СВЕРХУ -->';
    if (current.includes(marker)) {
      fs.writeFileSync(changelogPath, current.replace(marker, marker + entry));
    } else {
      fs.writeFileSync(changelogPath, entry + current);
    }
  }
  res.json({ ok: true });
});

app.delete('/api/projects/:name', auth, (req, res) => {
  const name = req.params.name;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return res.status(400).json({ error: 'Invalid name' });
  const target = path.join(PROJECTS_DIR, name);
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'Not found' });
  fs.rmSync(target, { recursive: true, force: true });
  res.json({ ok: true });
});

// --- Open project in VS Code ---
app.get('/api/projects/:name/open', auth, (req, res) => {
  const name = req.params.name;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return res.status(400).json({ error: 'Invalid name' });
  const folder = path.join(PROJECTS_DIR, name);
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const url   = `${proto}://${host}/vscode/?folder=${folder}`;
  res.json({ url });
});

// --- Download project as zip ---
app.get('/api/projects/:name/download', auth, (req, res) => {
  const name = req.params.name;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return res.status(400).json({ error: 'Invalid name' });
  const folder = path.join(PROJECTS_DIR, name);
  if (!fs.existsSync(folder)) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', err => { console.error('[archiver]', err); res.end(); });
  archive.pipe(res);
  archive.directory(folder, name);
  archive.finalize();
});

// --- File tree for projects ---
app.get('/api/projects/:name/tree', auth, (req, res) => {
  const name = req.params.name;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return res.status(400).json({ error: 'Invalid name' });
  const folder = path.join(PROJECTS_DIR, name);
  if (!fs.existsSync(folder)) return res.status(404).json({ error: 'Not found' });
  res.json(buildFileTree(folder, folder));
});

// --- File content for projects ---
app.get('/api/projects/:name/file', auth, (req, res) => {
  const name = req.params.name;
  const filePath = req.query.path;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return res.status(400).json({ error: 'Invalid name' });
  if (!filePath) return res.status(400).json({ error: 'Path required' });
  const folder = path.resolve(path.join(PROJECTS_DIR, name));
  const resolved = path.resolve(folder, filePath);
  if (!resolved.startsWith(folder + path.sep) && resolved !== folder) return res.status(403).json({ error: 'Forbidden' });
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) return res.status(404).json({ error: 'Not found' });
  try { res.json({ content: fs.readFileSync(resolved, 'utf8') }); }
  catch { res.json({ content: '[Бинарный файл — просмотр недоступен]' }); }
});

// --- Templates ---
app.get('/api/templates', auth, (req, res) => {
  ensureDir(TEMPLATES_DIR);
  const items = fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const fullPath = path.join(TEMPLATES_DIR, d.name);
      const annotationFile = path.join(fullPath, 'annotation.md');
      const description = fs.existsSync(annotationFile)
        ? fs.readFileSync(annotationFile, 'utf8').split('\n').find(l => l.trim()) || ''
        : '';
      return { name: d.name, description, fullPath };
    });
  res.json(items);
});

// --- Open template in VS Code ---
app.get('/api/templates/:name/open', auth, (req, res) => {
  const name = req.params.name;
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) return res.status(400).json({ error: 'Invalid name' });
  const folder = path.resolve(path.join(TEMPLATES_DIR, name));
  if (!folder.startsWith(path.resolve(TEMPLATES_DIR) + path.sep)) return res.status(403).json({ error: 'Forbidden' });
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  res.json({ url: `${proto}://${host}/vscode/?folder=${folder}` });
});

// --- File tree for templates ---
app.get('/api/templates/:name/tree', auth, (req, res) => {
  const name = req.params.name;
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) return res.status(400).json({ error: 'Invalid name' });
  const folder = path.resolve(path.join(TEMPLATES_DIR, name));
  if (!folder.startsWith(path.resolve(TEMPLATES_DIR) + path.sep)) return res.status(403).json({ error: 'Forbidden' });
  if (!fs.existsSync(folder)) return res.status(404).json({ error: 'Not found' });
  res.json(buildFileTree(folder, folder));
});

// --- File content for templates ---
app.get('/api/templates/:name/file', auth, (req, res) => {
  const name = req.params.name;
  const filePath = req.query.path;
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) return res.status(400).json({ error: 'Invalid name' });
  if (!filePath) return res.status(400).json({ error: 'Path required' });
  const folder = path.resolve(path.join(TEMPLATES_DIR, name));
  if (!folder.startsWith(path.resolve(TEMPLATES_DIR) + path.sep)) return res.status(403).json({ error: 'Forbidden' });
  const resolved = path.resolve(folder, filePath);
  if (!resolved.startsWith(folder + path.sep) && resolved !== folder) return res.status(403).json({ error: 'Forbidden' });
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) return res.status(404).json({ error: 'Not found' });
  try { res.json({ content: fs.readFileSync(resolved, 'utf8') }); }
  catch { res.json({ content: '[Бинарный файл — просмотр недоступен]' }); }
});

// --- Chats API ---
app.get('/api/chats', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, topic, updated_at,
      (SELECT COUNT(*) FROM messages WHERE chat_id = chats.id) as msg_count
    FROM chats
    ORDER BY topic COLLATE NOCASE ASC, name COLLATE NOCASE ASC
  `).all();
  res.json(rows);
});

app.get('/api/chats/topics', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT DISTINCT topic FROM chats ORDER BY topic COLLATE NOCASE ASC
  `).all();
  res.json(rows.map(r => r.topic));
});

app.post('/api/chats', auth, (req, res) => {
  const name = (req.body?.name || 'Новый чат').slice(0, 100);
  const topic = req.body?.topic || '!Без темы';
  const { lastInsertRowid } = db.prepare('INSERT INTO chats (name, topic) VALUES (?,?)').run(name, topic);
  res.json({ id: lastInsertRowid, name, topic });
});

app.patch('/api/chats/:id/name', auth, (req, res) => {
  const id = Number(req.params.id);
  const name = (req.body?.name || '').trim().slice(0, 100);
  if (!name) return res.status(400).json({ error: 'Name required' });
  const info = db.prepare('UPDATE chats SET name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name, id);
  if (!info.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

app.patch('/api/chats/:id/topic', auth, (req, res) => {
  const id = Number(req.params.id);
  const topic = (req.body?.topic || '').trim();
  if (!topic) return res.status(400).json({ error: 'Topic required' });
  const info = db.prepare('UPDATE chats SET topic=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(topic, id);
  if (!info.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

app.delete('/api/chats/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM chats WHERE id=?').run(id);
  if (!info.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

app.get('/api/chats/:id/messages', auth, (req, res) => {
  const id = Number(req.params.id);
  const chat = db.prepare('SELECT id FROM chats WHERE id=?').get(id);
  if (!chat) return res.status(404).json({ error: 'Not found' });
  const msgs = db.prepare('SELECT role, content, created_at FROM messages WHERE chat_id=? ORDER BY id ASC').all(id);
  res.json(msgs);
});

// --- Chat with Claude (with history) ---
app.post('/api/chat', auth, (req, res) => {
  const { chat_id, message } = req.body;
  if (!message) return res.status(400).json({ error: 'No message' });
  if (!chat_id) return res.status(400).json({ error: 'No chat_id' });

  const chat = db.prepare('SELECT id, name, session_id FROM chats WHERE id=?').get(Number(chat_id));
  if (!chat) return res.status(404).json({ error: 'Chat not found' });

  // Save user message immediately
  db.prepare('INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)').run(chat.id, 'user', message);
  db.prepare('UPDATE chats SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(chat.id);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const args = [
    '--print', '--verbose',
    '--output-format', 'stream-json',
    '--dangerously-skip-permissions',
    '--model', 'claude-sonnet-4-6',
  ];

  // Resume previous session if exists
  if (chat.session_id) {
    args.push('--resume', chat.session_id);
  }
  args.push(message);

  const proc = spawn(CLAUDE_PATH, args, {
    env: { ...process.env, HOME: '/home/deploy' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let buffer = '';
  let done = false;
  let assistantText = '';
  let newSessionId = null;

  res.on('close', () => {
    if (!done) proc.kill();
  });

  proc.stdout.on('data', chunk => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'system' && obj.session_id) {
          newSessionId = obj.session_id;
        } else if (obj.type === 'assistant') {
          const content = obj.message?.content || [];
          for (const block of content) {
            if (block.type === 'text') {
              assistantText += block.text;
              res.write(`data: ${JSON.stringify({ text: block.text })}\n\n`);
            }
          }
        }
      } catch {}
    }
  });

  proc.stderr.on('data', chunk => {
    const text = chunk.toString();
    if (!text.startsWith('\r') && !text.includes('ⓘ') && text.trim()) {
      console.error('[claude stderr]', text.trim());
    }
  });

  proc.on('close', () => {
    done = true;
    // Save assistant response and session_id
    if (assistantText) {
      db.prepare('INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)').run(chat.id, 'assistant', assistantText);
    }
    if (newSessionId && newSessionId !== chat.session_id) {
      db.prepare('UPDATE chats SET session_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(newSessionId, chat.id);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
});

// --- Portal (dev-portal itself) ---
app.get('/api/portal/open', auth, (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  res.json({ url: `${proto}://${host}/vscode/?folder=${PORTAL_DIR}` });
});

app.get('/api/portal/tree', auth, (req, res) => {
  res.json(buildFileTree(PORTAL_DIR, PORTAL_DIR, PORTAL_TREE_IGNORE));
});

app.get('/api/portal/file', auth, (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Path required' });
  const base = path.resolve(PORTAL_DIR);
  const resolved = path.resolve(base, filePath);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) return res.status(403).json({ error: 'Forbidden' });
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) return res.status(404).json({ error: 'Not found' });
  try { res.json({ content: fs.readFileSync(resolved, 'utf8') }); }
  catch { res.json({ content: '[Бинарный файл — просмотр недоступен]' }); }
});

app.get('/api/portal/journal', auth, (req, res) => {
  const docsDir = path.join(PORTAL_DIR, 'docs');
  const result = {};
  for (const file of JOURNAL_FILES) {
    const p = path.join(docsDir, file);
    result[file] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  }
  const claudeMd = path.join(PORTAL_DIR, 'CLAUDE.md');
  result['CLAUDE.md'] = fs.existsSync(claudeMd) ? fs.readFileSync(claudeMd, 'utf8') : null;
  res.json(result);
});

// --- SPA fallback ---
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function buildFileTree(dir, baseDir, ignore = new Set()) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }
  const result = [];
  for (const entry of entries) {
    if (ignore.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);
    if (entry.isDirectory()) {
      result.push({ name: entry.name, path: relPath, type: 'dir', children: buildFileTree(fullPath, baseDir, ignore) });
    } else {
      result.push({ name: entry.name, path: relPath, type: 'file' });
    }
  }
  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const server = app.listen(PORT, '127.0.0.1', () => console.log(`Portal running on http://127.0.0.1:${PORT}`));
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use — exiting`);
    process.exit(1);
  }
  throw err;
});

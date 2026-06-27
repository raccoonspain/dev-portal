'use strict';

// ── State ──
let currentPage = 'projects';
let templates = [];
let pendingDeleteProject = null;
let currentChatId = null;
let chatBusy = false;
let chatListData = [];
let openTopics = new Set();
let fbContext = null;
let journalData = null;
let journalCurrentTab = 'state';
let journalCurrentProject = null;
let portalJournalData = null;
let portalJournalTab = 'state';
let projectDetailsData = null;
let projectDetailsTab = 'claude';
let projectDetailsName = null;
let projectDetailsFullPath = null;

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  const ok = await checkAuth();
  if (ok) showMain();
  else showLogin();
});

// ── Auth ──
async function checkAuth() {
  try { return (await api('GET', '/api/me')).ok; } catch { return false; }
}

document.getElementById('login-btn').addEventListener('click', doLogin);
document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  const pw = document.getElementById('login-password').value;
  const err = document.getElementById('login-error');
  err.classList.add('hidden');
  try {
    await api('POST', '/api/login', { password: pw });
    showMain();
  } catch { err.classList.remove('hidden'); }
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('POST', '/api/logout');
  location.reload();
});

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('main-layout').classList.add('hidden');
  setTimeout(() => document.getElementById('login-password').focus(), 50);
}

function showMain() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-layout').classList.remove('hidden');
  loadChatList();
  navigate('projects');
}

// ── Navigation ──
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', e => { e.preventDefault(); navigate(link.dataset.page); });
});

document.getElementById('chat-tree-toggle').addEventListener('click', () => {
  document.querySelector('.nav-chat-section').classList.toggle('open');
});

function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.nav-link').forEach(l => {
    const isChat = l.classList.contains('nav-link-chat');
    l.classList.toggle('active', l.dataset.page === page && !isChat);
  });
  document.querySelectorAll('.page').forEach(p => { p.classList.add('hidden'); p.classList.remove('active'); });
  const el = document.getElementById(`page-${page}`);
  if (el) { el.classList.remove('hidden'); el.classList.add('active'); }
  if (page === 'portal') loadPortalPage();
  if (page === 'projects') loadProjects();
  if (page === 'templates') loadTemplates();
  if (page === 'journal') loadJournalPage();
  if (page === 'chat') {
    document.querySelector('.nav-link-chat')?.classList.add('active');
    document.querySelector('.nav-chat-section').classList.add('open');
    updateChatView();
  }
}

// ── Projects ──
async function loadProjects() {
  const list = document.getElementById('projects-list');
  list.innerHTML = '<div class="empty-state">Загрузка...</div>';
  try {
    const projects = await api('GET', '/api/projects');
    if (!projects.length) { list.innerHTML = '<div class="empty-state">Проектов нет. Создайте первый!</div>'; return; }
    list.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `<thead><tr>
      <th>Название</th><th>Описание</th><th>Полный путь</th><th>Действия</th>
    </tr></thead><tbody></tbody>`;
    const tbody = table.querySelector('tbody');
    for (const p of projects) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="td-name">${esc(p.name)}</td>
        <td class="td-desc">${esc(p.description || '')}</td>
        <td class="td-path"><code data-path="${esc(p.fullPath)}" title="Нажмите, чтобы скопировать">${esc(p.fullPath)}</code></td>
        <td class="td-actions">
          <button class="btn-action btn-details" data-name="${esc(p.name)}" data-full-path="${esc(p.fullPath)}" title="Подробности">&#10067;</button>
          <button class="btn-action btn-browse" data-name="${esc(p.name)}" data-full-path="${esc(p.fullPath)}" title="Обзор файлов">&#128194;</button>
          <button class="btn-action btn-open" data-name="${esc(p.name)}" title="Открыть в VS Code">&#9000;</button>
          <button class="btn-action btn-download" data-name="${esc(p.name)}" title="Скачать ZIP">&#128229;</button>
          <button class="btn-action danger btn-delete" data-name="${esc(p.name)}" title="Удалить">&#128465;</button>
        </td>`;
      tbody.appendChild(tr);
    }
    list.appendChild(table);
    list.querySelectorAll('.td-path code').forEach(el => {
      el.addEventListener('click', () => copyToClipboard(el.dataset.path, el));
    });
    list.querySelectorAll('.btn-details').forEach(b => b.addEventListener('click', () =>
      openProjectDetails(b.dataset.name, b.dataset.fullPath)));
    list.querySelectorAll('.btn-browse').forEach(b => b.addEventListener('click', () =>
      openFileBrowser('project', b.dataset.name, b.dataset.fullPath)));
    list.querySelectorAll('.btn-open').forEach(b => b.addEventListener('click', () => openProject(b.dataset.name)));
    list.querySelectorAll('.btn-download').forEach(b => b.addEventListener('click', () => downloadProject(b.dataset.name)));
    list.querySelectorAll('.btn-delete').forEach(b => b.addEventListener('click', () => showDeleteModal(b.dataset.name)));
  } catch (e) { list.innerHTML = `<div class="empty-state error">${esc(e.message)}</div>`; }
}

async function openProject(name) {
  return openInVSCode('project', name);
}

async function openProjectDetails(name, fullPath) {
  projectDetailsName = name;
  projectDetailsFullPath = fullPath;
  document.getElementById('pd-title').textContent = `📁 ${name}`;
  const pathEl = document.getElementById('pd-path');
  pathEl.textContent = fullPath;
  pathEl.dataset.path = fullPath;
  document.querySelectorAll('.pdtab').forEach(b => b.classList.remove('active'));
  document.querySelector('.pdtab[data-tab="claude"]').classList.add('active');
  projectDetailsTab = 'claude';
  projectDetailsData = null;
  document.getElementById('pd-content').innerHTML = '<div class="empty-state">Загрузка...</div>';
  document.getElementById('project-details').classList.remove('hidden');
  try {
    projectDetailsData = await api('GET', `/api/projects/${encodeURIComponent(name)}/journal`);
    renderProjectDetailsTab(projectDetailsTab);
  } catch (e) {
    document.getElementById('pd-content').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
  }
}

function renderProjectDetailsTab(tab) {
  const content = document.getElementById('pd-content');
  if (!projectDetailsData) { content.innerHTML = '<div class="empty-state">Загрузка...</div>'; return; }
  const file = JOURNAL_TAB_FILES[tab];
  const text = projectDetailsData[file];
  if (text == null) {
    content.innerHTML = `<div class="md-empty">${file} не найден</div>`;
  } else {
    content.innerHTML = `<div class="md">${renderMarkdown(text)}</div>`;
  }
}

document.getElementById('pd-close-btn').addEventListener('click', () => {
  document.getElementById('project-details').classList.add('hidden');
});
document.getElementById('pd-path').addEventListener('click', e => {
  copyToClipboard(e.currentTarget.dataset.path, e.currentTarget);
});
document.getElementById('pd-browse-btn').addEventListener('click', () => {
  openFileBrowser('project', projectDetailsName, projectDetailsFullPath);
});
document.getElementById('pd-vscode-btn').addEventListener('click', () => {
  openProject(projectDetailsName);
});
document.querySelectorAll('.pdtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pdtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    projectDetailsTab = btn.dataset.tab;
    renderProjectDetailsTab(projectDetailsTab);
  });
});

async function openInVSCode(type, name) {
  try {
    const prefix = type === 'project' ? 'projects' : 'templates';
    const { url } = await api('GET', `/api/${prefix}/${encodeURIComponent(name)}/open`);
    window.open(url, '_blank');
  } catch (e) { alert('Ошибка: ' + e.message); }
}

function downloadProject(name) {
  const a = document.createElement('a');
  a.href = `/api/projects/${encodeURIComponent(name)}/download`;
  a.download = `${name}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function copyToClipboard(text, el) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = el.style.color;
    el.style.color = '#6c63ff';
    setTimeout(() => { el.style.color = orig; }, 800);
  }).catch(() => {});
}

document.getElementById('new-project-btn').addEventListener('click', async () => {
  document.getElementById('new-project-name').value = '';
  document.getElementById('modal-error').classList.add('hidden');
  await populateTemplateSelect();
  document.getElementById('modal-new-project').classList.remove('hidden');
  setTimeout(() => document.getElementById('new-project-name').focus(), 50);
});
document.getElementById('modal-cancel').addEventListener('click', () => document.getElementById('modal-new-project').classList.add('hidden'));
document.getElementById('modal-create').addEventListener('click', createProject);
document.getElementById('new-project-name').addEventListener('keydown', e => { if (e.key === 'Enter') createProject(); });

async function populateTemplateSelect() {
  const sel = document.getElementById('new-project-template');
  sel.innerHTML = '<option value="">— без шаблона —</option>';
  try {
    templates = await api('GET', '/api/templates');
    for (const t of templates) {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = t.name + (t.description ? ` — ${t.description}` : '');
      sel.appendChild(opt);
    }
  } catch {}
}

async function createProject() {
  const name = document.getElementById('new-project-name').value.trim();
  const template = document.getElementById('new-project-template').value;
  const errEl = document.getElementById('modal-error');
  errEl.classList.add('hidden');
  if (!name) { errEl.textContent = 'Введите название'; errEl.classList.remove('hidden'); return; }
  try {
    document.getElementById('modal-create').disabled = true;
    await api('POST', '/api/projects', { name, template: template || undefined });
    document.getElementById('modal-new-project').classList.add('hidden');
    await loadProjects();
  } catch (e) {
    errEl.textContent = e.message; errEl.classList.remove('hidden');
  } finally { document.getElementById('modal-create').disabled = false; }
}

function showDeleteModal(name) {
  pendingDeleteProject = name;
  document.getElementById('modal-delete-name').textContent = name;
  document.getElementById('modal-delete').classList.remove('hidden');
}
document.getElementById('modal-delete-cancel').addEventListener('click', () => {
  document.getElementById('modal-delete').classList.add('hidden'); pendingDeleteProject = null;
});
document.getElementById('modal-delete-confirm').addEventListener('click', async () => {
  if (!pendingDeleteProject) return;
  try {
    await api('DELETE', `/api/projects/${encodeURIComponent(pendingDeleteProject)}`);
    document.getElementById('modal-delete').classList.add('hidden');
    pendingDeleteProject = null;
    await loadProjects();
  } catch (e) { alert('Ошибка: ' + e.message); }
});

// ── Templates ──
async function loadTemplates() {
  const list = document.getElementById('templates-list');
  list.innerHTML = '<div class="empty-state">Загрузка...</div>';
  try {
    templates = await api('GET', '/api/templates');
    if (!templates.length) { list.innerHTML = '<div class="empty-state">Шаблонов нет.</div>'; return; }
    list.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `<thead><tr>
      <th>Название</th><th>Описание</th><th>Полный путь</th><th>Действия</th>
    </tr></thead><tbody></tbody>`;
    const tbody = table.querySelector('tbody');
    for (const t of templates) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="td-name">${esc(t.name)}</td>
        <td class="td-desc">${esc(t.description || '')}</td>
        <td class="td-path"><code data-path="${esc(t.fullPath)}" title="Нажмите, чтобы скопировать">${esc(t.fullPath)}</code></td>
        <td class="td-actions">
          <button class="btn-action btn-browse" data-name="${esc(t.name)}" data-full-path="${esc(t.fullPath)}" title="Обзор файлов">&#128194;</button>
          <button class="btn-action btn-open-vscode" data-name="${esc(t.name)}" title="Открыть в VS Code">&#9000;</button>
          <button class="btn-action btn-use-template" data-name="${esc(t.name)}" title="Создать проект из шаблона">&#43;</button>
        </td>`;
      tbody.appendChild(tr);
    }
    list.appendChild(table);
    list.querySelectorAll('.td-path code').forEach(el => {
      el.addEventListener('click', () => copyToClipboard(el.dataset.path, el));
    });
    list.querySelectorAll('.btn-browse').forEach(b => b.addEventListener('click', () =>
      openFileBrowser('template', b.dataset.name, b.dataset.fullPath)));
    list.querySelectorAll('.btn-open-vscode').forEach(b => b.addEventListener('click', () => openInVSCode('template', b.dataset.name)));
    list.querySelectorAll('.btn-use-template').forEach(btn => {
      btn.addEventListener('click', () => {
        navigate('projects');
        setTimeout(async () => {
          await populateTemplateSelect();
          document.getElementById('new-project-template').value = btn.dataset.name;
          document.getElementById('modal-new-project').classList.remove('hidden');
          document.getElementById('new-project-name').focus();
        }, 100);
      });
    });
  } catch (e) { list.innerHTML = `<div class="empty-state error">${esc(e.message)}</div>`; }
}

// ── Chat tree in sidebar ──
async function loadChatList() {
  try {
    chatListData = await api('GET', '/api/chats');
    renderChatTree();
  } catch {}
}

function getTopics() {
  // unique topics, sorted (backend already sorted, but let's be safe)
  const seen = new Set();
  return chatListData.filter(c => { if (seen.has(c.topic)) return false; seen.add(c.topic); return true; }).map(c => c.topic);
}

function renderChatTree() {
  const tree = document.getElementById('chat-tree');
  tree.innerHTML = '';
  const topics = getTopics();
  for (const topic of topics) {
    const chats = chatListData.filter(c => c.topic === topic);
    const isOpen = openTopics.has(topic);

    const group = document.createElement('div');
    group.className = 'topic-group' + (isOpen ? ' open' : '');

    // Topic header
    const header = document.createElement('div');
    header.className = 'topic-header';
    header.innerHTML = `<span class="topic-arrow">&#9658;</span><span class="topic-name">${esc(topic)}</span>`;
    header.addEventListener('click', () => {
      if (openTopics.has(topic)) openTopics.delete(topic);
      else openTopics.add(topic);
      group.classList.toggle('open');
    });
    group.appendChild(header);

    // Chats inside topic
    const chatList = document.createElement('div');
    chatList.className = 'topic-chats';
    for (const chat of chats) {
      const item = document.createElement('div');
      item.className = 'chat-item' + (chat.id === currentChatId ? ' active' : '');
      item.innerHTML = `
        <span class="chat-item-name">${esc(chat.name)}</span>
        <button class="chat-item-del" title="Удалить чат" data-id="${chat.id}">&#10005;</button>`;
      item.querySelector('.chat-item-name').addEventListener('click', () => selectChat(chat.id));
      item.querySelector('.chat-item-del').addEventListener('click', e => {
        e.stopPropagation();
        deleteChat(chat.id, chat.name, topic);
      });
      chatList.appendChild(item);
    }
    group.appendChild(chatList);
    tree.appendChild(group);
  }
}

// ── New chat ──
document.getElementById('new-chat-btn').addEventListener('click', openNewChatModal);
document.getElementById('chat-empty-new-btn').addEventListener('click', openNewChatModal);

async function openNewChatModal() {
  document.getElementById('new-chat-name').value = '';
  document.getElementById('new-chat-error').classList.add('hidden');
  document.getElementById('new-chat-topic-input').value = '';
  await populateTopicSelect('new-chat-topic-select');
  document.getElementById('modal-new-chat').classList.remove('hidden');
  setTimeout(() => document.getElementById('new-chat-name').focus(), 50);
}

// sync: selecting from dropdown clears text input and vice versa
document.getElementById('new-chat-topic-select').addEventListener('change', e => {
  if (e.target.value) document.getElementById('new-chat-topic-input').value = '';
});
document.getElementById('new-chat-topic-input').addEventListener('input', e => {
  if (e.target.value) document.getElementById('new-chat-topic-select').value = '';
});

document.getElementById('new-chat-cancel').addEventListener('click', () => document.getElementById('modal-new-chat').classList.add('hidden'));
document.getElementById('new-chat-confirm').addEventListener('click', createNewChat);
document.getElementById('new-chat-name').addEventListener('keydown', e => { if (e.key === 'Enter') createNewChat(); });

async function createNewChat() {
  const name = document.getElementById('new-chat-name').value.trim().slice(0, 100);
  const topicFromSelect = document.getElementById('new-chat-topic-select').value;
  const topicFromInput = document.getElementById('new-chat-topic-input').value.trim();
  const topic = topicFromInput || topicFromSelect || '!Без темы';
  const errEl = document.getElementById('new-chat-error');
  errEl.classList.add('hidden');
  if (!name) { errEl.textContent = 'Введите название чата'; errEl.classList.remove('hidden'); return; }
  try {
    const chat = await api('POST', '/api/chats', { name, topic });
    openTopics.add(topic);
    await loadChatList();
    document.getElementById('modal-new-chat').classList.add('hidden');
    navigate('chat');
    selectChat(chat.id);
  } catch (e) { errEl.textContent = e.message; errEl.classList.remove('hidden'); }
}

// ── Select chat ──
async function selectChat(id) {
  currentChatId = id;
  navigate('chat');
  renderChatTree();

  const chat = chatListData.find(c => c.id === id);
  if (chat) {
    // auto-expand topic
    openTopics.add(chat.topic);
    renderChatTree();
    document.getElementById('chat-topic-text').textContent = chat.topic;
    document.getElementById('chat-name-text').textContent = chat.name;
    document.getElementById('chat-rename-name-btn').classList.remove('hidden');
    document.getElementById('chat-rename-topic-btn').classList.remove('hidden');
    document.getElementById('chat-delete-btn').classList.remove('hidden');
  }

  // Load messages
  const msgs = document.getElementById('chat-messages');
  msgs.innerHTML = '';
  try {
    const history = await api('GET', `/api/chats/${id}/messages`);
    for (const m of history) appendChatMsg(m.role, m.content);
    scrollChat();
  } catch {}

  updateChatView();
  document.getElementById('chat-input').focus();
}

function updateChatView() {
  const hasChat = currentChatId !== null;
  document.getElementById('chat-messages').classList.toggle('hidden', !hasChat);
  document.getElementById('chat-input-area').classList.toggle('hidden', !hasChat);
  document.getElementById('chat-empty-state').classList.toggle('hidden', hasChat);
}

// ── Delete chat ──
async function deleteChat(id, name, topic) {
  if (!confirm(`Удалить чат "${name}"?\nВся история будет потеряна.`)) return;
  try {
    await api('DELETE', `/api/chats/${id}`);
    if (currentChatId === id) {
      currentChatId = null;
      document.getElementById('chat-messages').innerHTML = '';
      document.getElementById('chat-name-text').textContent = 'Выберите чат';
      document.getElementById('chat-topic-text').textContent = '';
      document.getElementById('chat-rename-name-btn').classList.add('hidden');
      document.getElementById('chat-rename-topic-btn').classList.add('hidden');
      document.getElementById('chat-delete-btn').classList.add('hidden');
      updateChatView();
    }
    // remove topic from openTopics if no chats left
    const remaining = chatListData.filter(c => c.id !== id && c.topic === topic);
    if (remaining.length === 0) openTopics.delete(topic);
    await loadChatList();
  } catch (e) { alert('Ошибка: ' + e.message); }
}

// Topbar delete button
document.getElementById('chat-delete-btn').addEventListener('click', () => {
  const chat = chatListData.find(c => c.id === currentChatId);
  if (chat) deleteChat(chat.id, chat.name, chat.topic);
});

// ── Rename chat name ──
document.getElementById('chat-rename-name-btn').addEventListener('click', () => {
  if (!currentChatId) return;
  const chat = chatListData.find(c => c.id === currentChatId);
  document.getElementById('rename-name-input').value = chat?.name || '';
  document.getElementById('modal-rename-name').classList.remove('hidden');
  setTimeout(() => document.getElementById('rename-name-input').focus(), 50);
});
document.getElementById('rename-name-cancel').addEventListener('click', () => document.getElementById('modal-rename-name').classList.add('hidden'));
document.getElementById('rename-name-confirm').addEventListener('click', renameChatName);
document.getElementById('rename-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') renameChatName(); });

async function renameChatName() {
  const name = document.getElementById('rename-name-input').value.trim().slice(0, 100);
  if (!name || !currentChatId) return;
  try {
    await api('PATCH', `/api/chats/${currentChatId}/name`, { name });
    document.getElementById('modal-rename-name').classList.add('hidden');
    document.getElementById('chat-name-text').textContent = name;
    await loadChatList();
  } catch (e) { alert('Ошибка: ' + e.message); }
}

// ── Rename topic ──
document.getElementById('chat-rename-topic-btn').addEventListener('click', async () => {
  if (!currentChatId) return;
  const chat = chatListData.find(c => c.id === currentChatId);
  document.getElementById('rename-topic-input').value = '';
  await populateTopicSelect('rename-topic-select', chat?.topic);
  document.getElementById('modal-rename-topic').classList.remove('hidden');
  setTimeout(() => document.getElementById('rename-topic-select').focus(), 50);
});

document.getElementById('rename-topic-select').addEventListener('change', e => {
  if (e.target.value) document.getElementById('rename-topic-input').value = '';
});
document.getElementById('rename-topic-input').addEventListener('input', e => {
  if (e.target.value) document.getElementById('rename-topic-select').value = '';
});

document.getElementById('rename-topic-cancel').addEventListener('click', () => document.getElementById('modal-rename-topic').classList.add('hidden'));
document.getElementById('rename-topic-confirm').addEventListener('click', renameTopic);
document.getElementById('rename-topic-input').addEventListener('keydown', e => { if (e.key === 'Enter') renameTopic(); });

async function renameTopic() {
  const fromSelect = document.getElementById('rename-topic-select').value;
  const fromInput = document.getElementById('rename-topic-input').value.trim();
  const topic = fromInput || fromSelect;
  if (!topic || !currentChatId) return;
  const chat = chatListData.find(c => c.id === currentChatId);
  const oldTopic = chat?.topic;
  try {
    await api('PATCH', `/api/chats/${currentChatId}/topic`, { topic });
    document.getElementById('modal-rename-topic').classList.add('hidden');
    document.getElementById('chat-topic-text').textContent = topic;
    // cleanup old topic if empty, open new
    openTopics.add(topic);
    const remaining = chatListData.filter(c => c.id !== currentChatId && c.topic === oldTopic);
    if (remaining.length === 0) openTopics.delete(oldTopic);
    await loadChatList();
  } catch (e) { alert('Ошибка: ' + e.message); }
}

// ── Helpers ──
async function populateTopicSelect(selectId, currentTopic) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = '<option value="">— выбрать тему —</option>';
  try {
    const topics = await api('GET', '/api/chats/topics');
    for (const t of topics) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      if (t === currentTopic) opt.selected = true;
      sel.appendChild(opt);
    }
  } catch {}
}

// ── Status bar ──
const SPINNER_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
const STATUS_PHASES = [
  { until: 3,  text: 'Отправка запроса...' },
  { until: 7,  text: 'Читаю запрос...' },
  { until: 14, text: 'Обрабатываю...' },
  { until: 25, text: 'Формирую ответ...' },
  { until: Infinity, text: 'Ещё немного...' },
];

let _statusInterval = null;

function startStatus() {
  const bar    = document.getElementById('chat-status-bar');
  const spinner= document.getElementById('chat-status-spinner');
  const text   = document.getElementById('chat-status-text');
  const timer  = document.getElementById('chat-status-timer');
  bar.classList.remove('hidden');

  let frame = 0;
  let elapsed = 0;
  const t0 = Date.now();

  _statusInterval = setInterval(() => {
    elapsed = (Date.now() - t0) / 1000;
    frame = (frame + 1) % SPINNER_FRAMES.length;
    spinner.textContent = SPINNER_FRAMES[frame];
    const phase = STATUS_PHASES.find(p => elapsed < p.until) || STATUS_PHASES.at(-1);
    text.textContent = phase.text;
    const s = Math.floor(elapsed);
    timer.textContent = s < 60 ? `${s} с` : `${Math.floor(s/60)}м ${s%60}с`;
  }, 100);
}

function stopStatus() {
  clearInterval(_statusInterval);
  _statusInterval = null;
  document.getElementById('chat-status-bar').classList.add('hidden');
  document.getElementById('chat-status-spinner').textContent = '';
  document.getElementById('chat-status-text').textContent = '';
  document.getElementById('chat-status-timer').textContent = '';
}

// ── Send message ──
document.getElementById('chat-send-btn').addEventListener('click', sendChat);
document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

async function sendChat() {
  if (chatBusy || !currentChatId) return;
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;

  input.value = '';
  chatBusy = true;
  document.getElementById('chat-send-btn').disabled = true;

  appendChatMsg('user', msg);
  const assistantEl = appendChatMsg('assistant', '');
  const bubble = assistantEl.querySelector('.bubble');
  let fullText = '';
  let firstChunk = true;

  startStatus();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: currentChatId, message: msg })
    });
    if (!response.ok) { bubble.textContent = 'Ошибка запроса'; return; }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') break;
        try {
          const obj = JSON.parse(data);
          if (obj.text) {
            if (firstChunk) { stopStatus(); firstChunk = false; }
            fullText += obj.text;
            bubble.textContent = fullText;
            scrollChat();
          }
        } catch {}
      }
    }
  } catch (e) {
    bubble.textContent = 'Ошибка: ' + e.message;
  } finally {
    stopStatus();
    chatBusy = false;
    document.getElementById('chat-send-btn').disabled = false;
    input.focus();
  }
}

function appendChatMsg(role, text) {
  const msgs = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = `chat-msg ${role}`;
  el.innerHTML = role === 'assistant'
    ? `<div class="role">Claude</div><div class="bubble">${esc(text)}</div>`
    : `<div class="bubble">${esc(text)}</div>`;
  msgs.appendChild(el);
  scrollChat();
  return el;
}

function scrollChat() {
  const msgs = document.getElementById('chat-messages');
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Portal page ──
document.getElementById('portal-path').addEventListener('click', e => {
  copyToClipboard(e.currentTarget.dataset.path, e.currentTarget);
});

document.getElementById('portal-browse-btn').addEventListener('click', () => {
  openFileBrowser('portal', 'dev-portal', '/home/deploy/dev-portal');
});

document.getElementById('portal-vscode-btn').addEventListener('click', async () => {
  try {
    const { url } = await api('GET', '/api/portal/open');
    window.open(url, '_blank');
  } catch (e) { alert('Ошибка: ' + e.message); }
});

document.querySelectorAll('.pjtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pjtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    portalJournalTab = btn.dataset.tab;
    renderPortalJournalTab(portalJournalTab);
  });
});

async function loadPortalPage() {
  const content = document.getElementById('portal-journal-content');
  content.innerHTML = '<div class="empty-state">Загрузка...</div>';
  try {
    portalJournalData = await api('GET', '/api/portal/journal');
    renderPortalJournalTab(portalJournalTab);
  } catch (e) {
    content.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
  }
}

function renderPortalJournalTab(tab) {
  const content = document.getElementById('portal-journal-content');
  if (!portalJournalData) { content.innerHTML = '<div class="empty-state">Загрузка...</div>'; return; }
  const file = JOURNAL_TAB_FILES[tab];
  const text = portalJournalData[file];
  if (text == null) {
    content.innerHTML = `<div class="md-empty">${file} не найден</div>`;
  } else {
    content.innerHTML = `<div class="md">${renderMarkdown(text)}</div>`;
  }
}

// ── Journal ──
const JOURNAL_TAB_FILES = { claude: 'CLAUDE.md', state: 'state.md', changelog: 'changelog.md', decisions: 'decisions.md', handoff: 'handoff.md' };
const JOURNAL_TAB_LABELS = { state: 'Состояние', changelog: 'История', decisions: 'Решения', handoff: 'Передача' };

async function loadJournalPage() {
  const sel = document.getElementById('journal-project-select');
  const prev = journalCurrentProject;
  try {
    const projects = await api('GET', '/api/projects');
    sel.innerHTML = '<option value="">— выберите проект —</option>';
    for (const p of projects) {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      sel.appendChild(opt);
    }
    if (prev && projects.find(p => p.name === prev)) {
      sel.value = prev;
      await loadJournal(prev);
    }
  } catch {}
}

document.getElementById('journal-project-select').addEventListener('change', async e => {
  const name = e.target.value;
  journalCurrentProject = name || null;
  if (!name) {
    journalData = null;
    document.getElementById('journal-content').innerHTML = '<div class="empty-state">Выберите проект</div>';
    document.getElementById('journal-has-docs').classList.add('hidden');
    return;
  }
  await loadJournal(name);
});

async function loadJournal(name) {
  document.getElementById('journal-content').innerHTML = '<div class="empty-state">Загрузка...</div>';
  try {
    journalData = await api('GET', `/api/projects/${encodeURIComponent(name)}/journal`);
    const hasAny = Object.values(journalData).some(v => v !== null);
    const status = document.getElementById('journal-has-docs');
    status.textContent = hasAny ? `docs/ найден` : 'docs/ отсутствует';
    status.classList.remove('hidden');
    renderJournalTab(journalCurrentTab);
  } catch (e) {
    document.getElementById('journal-content').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
  }
}

document.querySelectorAll('.jtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.jtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    journalCurrentTab = btn.dataset.tab;
    renderJournalTab(journalCurrentTab);
  });
});

function renderJournalTab(tab) {
  const content = document.getElementById('journal-content');
  if (!journalData) { content.innerHTML = '<div class="empty-state">Выберите проект</div>'; return; }
  const file = JOURNAL_TAB_FILES[tab];
  const text = journalData[file];
  if (text == null) {
    content.innerHTML = `<div class="md-empty">${file} не найден в папке docs/</div>`;
  } else {
    content.innerHTML = `<div class="md">${renderMarkdown(text)}</div>`;
  }
}

document.getElementById('journal-entry-btn').addEventListener('click', addJournalEntry);

async function addJournalEntry() {
  const name = document.getElementById('journal-project-select').value;
  const text = document.getElementById('journal-entry-input').value.trim();
  if (!name) { alert('Выберите проект'); return; }
  if (!text) { alert('Введите текст записи'); return; }
  try {
    document.getElementById('journal-entry-btn').disabled = true;
    await api('POST', `/api/projects/${encodeURIComponent(name)}/journal/entry`, { text });
    document.getElementById('journal-entry-input').value = '';
    await loadJournal(name);
    // Switch to changelog tab to show new entry
    document.querySelectorAll('.jtab').forEach(b => b.classList.remove('active'));
    document.querySelector('.jtab[data-tab="changelog"]').classList.add('active');
    journalCurrentTab = 'changelog';
    renderJournalTab('changelog');
  } catch (e) { alert('Ошибка: ' + e.message); }
  finally { document.getElementById('journal-entry-btn').disabled = false; }
}

function renderMarkdown(text) {
  const lines = text.split('\n');
  let html = '';
  let inPre = false;
  let inBlockquote = false;
  let inList = false;

  const flushList = () => { if (inList) { html += '</ul>'; inList = false; } };
  const flushBq = () => { if (inBlockquote) { html += '</blockquote>'; inBlockquote = false; } };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Fenced code blocks
    if (line.startsWith('```')) {
      if (inPre) { html += '</code></pre>'; inPre = false; }
      else { flushList(); flushBq(); html += '<pre><code>'; inPre = true; }
      continue;
    }
    if (inPre) { html += esc(line) + '\n'; continue; }

    // Blockquote
    if (line.startsWith('>')) {
      flushList();
      if (!inBlockquote) { html += '<blockquote>'; inBlockquote = true; }
      html += inline(line.replace(/^>\s?/, '')) + '<br>';
      continue;
    }
    flushBq();

    // HR
    if (/^---+$/.test(line.trim())) { flushList(); html += '<hr>'; continue; }

    // Headings
    const h3 = line.match(/^### (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h1 = line.match(/^# (.+)/);
    if (h1) { flushList(); html += `<h1>${inline(h1[1])}</h1>`; continue; }
    if (h2) { flushList(); html += `<h2>${inline(h2[1])}</h2>`; continue; }
    if (h3) { flushList(); html += `<h3>${inline(h3[1])}</h3>`; continue; }

    // List items
    const li = line.match(/^[-*]\s+(.+)/);
    const liCheck = line.match(/^[-*]\s+\[(x| )\]\s+(.+)/i);
    if (liCheck) {
      if (!inList) { html += '<ul>'; inList = true; }
      const done = liCheck[1].toLowerCase() === 'x';
      html += `<li${done ? ' class="checked"' : ''}>${inline(liCheck[2])}</li>`;
      continue;
    }
    if (li) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(li[1])}</li>`;
      continue;
    }
    flushList();

    // Empty line = paragraph break
    if (!line.trim()) { html += ''; continue; }

    html += `<p>${inline(line)}</p>`;
  }
  flushList(); flushBq();
  if (inPre) html += '</code></pre>';
  return html;
}

function inline(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

// ── File browser ──
document.getElementById('fb-close-btn').addEventListener('click', closeFileBrowser);
document.getElementById('fb-vscode-btn').addEventListener('click', () => {
  if (!fbContext) return;
  if (fbContext.type === 'portal') {
    api('GET', '/api/portal/open').then(({ url }) => window.open(url, '_blank')).catch(e => alert('Ошибка: ' + e.message));
  } else {
    openInVSCode(fbContext.type, fbContext.name);
  }
});

async function openFileBrowser(type, name, fullPath) {
  fbContext = { type, name, fullPath };
  document.getElementById('fb-title').textContent = name;
  document.getElementById('fb-vscode-btn').style.display = '';
  document.getElementById('fb-content').innerHTML = '<div class="fb-placeholder">Выберите файл для просмотра</div>';
  document.getElementById('fb-tree').innerHTML = '<div class="fb-placeholder">Загрузка...</div>';
  document.getElementById('file-browser').classList.remove('hidden');
  try {
    let tree;
    if (type === 'portal') {
      tree = await api('GET', '/api/portal/tree');
    } else {
      const prefix = type === 'project' ? 'projects' : 'templates';
      tree = await api('GET', `/api/${prefix}/${encodeURIComponent(name)}/tree`);
    }
    renderFileTree(tree, type, name);
  } catch (e) {
    document.getElementById('fb-tree').innerHTML = `<div class="fb-placeholder">${esc(e.message)}</div>`;
  }
}

function closeFileBrowser() {
  document.getElementById('file-browser').classList.add('hidden');
  fbContext = null;
}

function renderFileTree(nodes, type, name, container, depth) {
  const target = container || document.getElementById('fb-tree');
  if (!container) target.innerHTML = '';
  depth = depth || 0;
  for (const node of nodes) {
    const wrapper = document.createElement('div');
    wrapper.className = 'ft-node';
    const item = document.createElement('div');
    item.className = 'ft-item';
    item.style.paddingLeft = `${12 + depth * 16}px`;
    if (node.type === 'dir') {
      item.innerHTML = `<span class="ft-icon">&#128193;</span>${esc(node.name)}`;
      const children = document.createElement('div');
      children.className = 'ft-children';
      if (node.children?.length) renderFileTree(node.children, type, name, children, depth + 1);
      item.addEventListener('click', () => children.classList.toggle('open'));
      wrapper.appendChild(item);
      wrapper.appendChild(children);
    } else {
      item.innerHTML = `<span class="ft-icon">&#128196;</span>${esc(node.name)}`;
      item.addEventListener('click', () => loadFileContent(type, name, node.path, item));
      wrapper.appendChild(item);
    }
    target.appendChild(wrapper);
  }
}

async function loadFileContent(type, name, filePath, itemEl) {
  document.querySelectorAll('.ft-item.active').forEach(el => el.classList.remove('active'));
  itemEl.classList.add('active');
  const content = document.getElementById('fb-content');
  content.innerHTML = '<div class="fb-placeholder">Загрузка...</div>';
  try {
    let url;
    if (type === 'portal') {
      url = `/api/portal/file?path=${encodeURIComponent(filePath)}`;
    } else {
      const prefix = type === 'project' ? 'projects' : 'templates';
      url = `/api/${prefix}/${encodeURIComponent(name)}/file?path=${encodeURIComponent(filePath)}`;
    }
    const { content: text } = await api('GET', url);
    content.innerHTML = `<div class="fb-file-header">${esc(filePath)}</div><pre class="fb-file-body">${esc(text)}</pre>`;
  } catch (e) {
    content.innerHTML = `<div class="fb-placeholder">${esc(e.message)}</div>`;
  }
}

// ── Close modals on backdrop click ──
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
});

// ── Utils ──
async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  if (!r.ok) {
    const data = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(data.error || r.statusText);
  }
  return r.json();
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

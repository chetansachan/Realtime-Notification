/* global EventSource, fetch, document, setTimeout, clearTimeout */
(() => {
  const el = (id) => document.getElementById(id);

  const state = {
    userId: null,
    token: null,
    stream: null,
    lastSeq: 0,
    unread: 0,
    reconnectAttempt: 0,
    reconnectTimer: null,
    connected: false,
  };

  function setStatus(text, kind) {
    const node = el('status');
    node.textContent = text;
    node.className = `status${kind ? ` ${kind}` : ''}`;
  }

  function renderUnread(value) {
    state.unread = Math.max(0, Number(value) || 0);
    el('unreadBadge').textContent = String(state.unread);
  }

  function setConnected(connected) {
    state.connected = connected;
    el('connectBtn').disabled = connected;
    el('disconnectBtn').disabled = !connected;
    el('sendBtn').disabled = !connected;
    el('readAllBtn').disabled = !connected;
    el('refreshBtn').disabled = !connected;
    el('userId').disabled = connected;
    document.body.classList.toggle('connected', connected);
  }

  // ---------- rendering -------------------------------------------------

  function renderItem(item, read) {
    const li = document.createElement('li');
    li.dataset.id = item.id;
    if (read || item.readAt) li.classList.add('read');

    const meta = document.createElement('div');
    meta.className = 'meta';
    const category = document.createElement('span');
    category.textContent = item.category;
    const seq = document.createElement('span');
    seq.textContent = `seq ${item.seq}`;
    meta.append(category, seq);

    const title = document.createElement('div');
    title.className = 'title';
    // Notification content is untrusted input: textContent only, never innerHTML.
    title.textContent = item.title;

    li.append(meta, title);

    if (item.body) {
      const body = document.createElement('div');
      body.className = 'body';
      body.textContent = item.body;
      li.append(body);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';
    const readButton = document.createElement('button');
    readButton.textContent = 'Mark read';
    readButton.addEventListener('click', () => void markRead(item.id));
    actions.append(readButton);
    li.append(actions);

    return li;
  }

  function upsertItem(item) {
    const list = el('items');
    const existing = list.querySelector(`li[data-id="${CSS.escape(item.id)}"]`);
    if (existing) {
      existing.classList.remove('read');
      existing.querySelector('.actions button').disabled = false;
      return;
    }
    list.prepend(renderItem(item, false));
    el('empty').hidden = true;
  }

  function markItemRead(id) {
    const node = el('items').querySelector(`li[data-id="${CSS.escape(id)}"]`);
    if (!node) return;
    node.classList.add('read');
    const button = node.querySelector('.actions button');
    if (button) button.disabled = true;
  }

  function markAllRead() {
    for (const node of el('items').querySelectorAll('li')) {
      node.classList.add('read');
      const button = node.querySelector('.actions button');
      if (button) button.disabled = true;
    }
  }

  // ---------- REST ------------------------------------------------------

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
        ...(options.headers ?? {}),
      },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    if (response.status === 204) return null;
    return response.json();
  }

  async function loadHistory() {
    const data = await api('/v1/notifications?limit=30');
    const list = el('items');
    list.replaceChildren();
    for (const item of data.items) list.append(renderItem(item, Boolean(item.readAt)));
    el('empty').hidden = data.items.length > 0;
    renderUnread(data.unreadCount);
    const newest = data.items[0];
    if (newest) state.lastSeq = Math.max(state.lastSeq, newest.seq);
  }

  async function markRead(id) {
    try {
      const result = await api(`/v1/notifications/${id}/read`, { method: 'POST' });
      markItemRead(id);
      renderUnread(result.unreadCount);
    } catch (err) {
      setStatus(`mark read failed: ${err.message}`, 'error');
    }
  }

  async function markAllReadViaApi() {
    try {
      const result = await api('/v1/notifications/read-all', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      markAllRead();
      renderUnread(result.unreadCount);
    } catch (err) {
      setStatus(`read-all failed: ${err.message}`, 'error');
    }
  }

  async function ack(id) {
    try {
      await api(`/v1/notifications/${id}/ack`, { method: 'POST' });
    } catch {
      /* ack is best-effort */
    }
  }

  // ---------- stream ----------------------------------------------------

  function handleEvent(name, event) {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    switch (name) {
      case 'hello':
        el('instanceId').textContent = data.instanceId;
        state.lastSeq = Math.max(state.lastSeq, data.resumeFrom ?? 0);
        renderUnread(data.unreadCount);
        setStatus(`connected to ${data.instanceId}`, 'connected');
        break;
      case 'notification': {
        state.lastSeq = Math.max(state.lastSeq, data.seq);
        upsertItem(data);
        renderUnread(state.unread + 1);
        void ack(data.id);
        break;
      }
      case 'read':
        markItemRead(data.notificationId);
        renderUnread(data.unreadCount);
        break;
      case 'read_all':
        markAllRead();
        renderUnread(data.unreadCount);
        break;
      case 'unread_count':
        renderUnread(data.unreadCount);
        break;
      case 'resync':
        setStatus(`resync: ${data.reason} — reloading history`, 'error');
        void loadHistory();
        break;
      case 'reconnect':
        setStatus(`server asked us to reconnect in ${data.retryAfterMs}ms`, 'error');
        disconnect(false);
        state.reconnectTimer = setTimeout(() => void reconnect(), data.retryAfterMs);
        break;
      default:
        break;
    }
  }

  function openStream(ticket) {
    const query = new URLSearchParams({ ticket });
    if (state.lastSeq > 0) query.set('lastEventId', String(state.lastSeq));

    const stream = new EventSource(`/v1/stream?${query.toString()}`);
    state.stream = stream;

    for (const name of [
      'hello',
      'notification',
      'read',
      'read_all',
      'unread_count',
      'resync',
      'reconnect',
    ]) {
      stream.addEventListener(name, (event) => handleEvent(name, event));
    }

    stream.onerror = () => {
      if (state.stream !== stream) return;
      // The ticket is single-use, so a native EventSource retry would 401.
      // Close and re-mint a ticket instead.
      stream.close();
      state.stream = null;
      setStatus('stream dropped, reconnecting…', 'error');
      void reconnect();
    };
  }

  async function reconnect() {
    if (!state.token) return;
    state.reconnectAttempt += 1;
    const delay = Math.min(15_000, 400 * 2 ** state.reconnectAttempt) + Math.random() * 250;

    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const ticket = await api('/v1/stream-tickets', { method: 'POST', body: '{}' });
      openStream(ticket.ticket);
    } catch (err) {
      setStatus(`reconnect failed: ${err.message}`, 'error');
      void reconnect();
    }
  }

  async function connect() {
    const userId = el('userId').value.trim();
    if (!userId) {
      setStatus('enter a user id first', 'error');
      return;
    }
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);

    state.userId = userId;
    state.lastSeq = 0;
    state.reconnectAttempt = 0;
    setStatus('connecting…');

    try {
      const session = await api('/demo/token', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      state.token = session.token;
      openStream(session.ticket);
      await loadHistory();
      setConnected(true);
    } catch (err) {
      setStatus(`connect failed: ${err.message}`, 'error');
    }
  }

  function disconnect(closeStream = true) {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (closeStream && state.stream) {
      state.stream.close();
      state.stream = null;
    }
    if (closeStream) {
      state.token = null;
      setConnected(false);
      setStatus('disconnected');
      el('instanceId').textContent = '–';
    }
  }

  async function sendTestNotification(event) {
    event.preventDefault();
    if (!state.userId) return;

    const title = el('title').value.trim();
    if (!title) return;

    try {
      const result = await api('/demo/notify', {
        method: 'POST',
        body: JSON.stringify({
          userId: state.userId,
          title,
          ...(el('body').value.trim() ? { body: el('body').value.trim() } : {}),
        }),
      });
      setStatus(`sent ${result.id} (${result.status})`, 'connected');
    } catch (err) {
      setStatus(`send failed: ${err.message}`, 'error');
    }
  }

  el('connectBtn').addEventListener('click', () => void connect());
  el('disconnectBtn').addEventListener('click', () => disconnect(true));
  el('sendForm').addEventListener('submit', (event) => void sendTestNotification(event));
  el('readAllBtn').addEventListener('click', () => void markAllReadViaApi());
  el('refreshBtn').addEventListener('click', () => void loadHistory());
  el('userId').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void connect();
  });
})();

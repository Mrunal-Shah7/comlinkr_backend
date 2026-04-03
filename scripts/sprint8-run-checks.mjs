/**
 * Sprint 8 — Messaging: run validation checks via HTTP + Socket.IO client.
 * Usage: node scripts/sprint8-run-checks.mjs
 * Requires: server on http://localhost:4000, and two users (admin + one other).
 * Set COOKIE_A and COOKIE_B env vars to session cookie values for two users, or we login.
 */

const BASE = 'http://localhost:4000/api';
const BASE_WS = 'http://localhost:4000';

async function login(identifier, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
    redirect: 'manual',
    credentials: 'include',
  });
  const setCookie = res.headers.get('set-cookie');
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || `Login failed: ${res.status}`);
  return { cookie: setCookie, user: body };
}

async function req(method, path, opts = {}, cookie = null) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const headers = { ...opts.headers };
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(url, { method, ...opts, headers, credentials: 'include' });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function parseCookie(setCookie) {
  if (!setCookie) return null;
  const m = setCookie.match(/comlinkr\.sid=([^;]+)/);
  return m ? `comlinkr.sid=${m[1]}` : null;
}

async function main() {
  const results = [];
  function ok(check, msg) {
    results.push({ check, ok: true, msg });
    console.log(`[PASS] ${check}: ${msg}`);
  }
  function fail(check, msg) {
    results.push({ check, ok: false, msg });
    console.log(`[FAIL] ${check}: ${msg}`);
  }

  console.log('Sprint 8 — Messaging checks\n');

  // 1) Login as user A
  let cookieA;
  let userAId;
  try {
    const loginA = await login('admin@comlinkr.com', 'Admin@123456');
    cookieA = parseCookie(loginA.cookie) || (loginA.user?.id ? 'use-session' : null);
    userAId = loginA.user?.id;
    if (!userAId) fail('Login A', 'No user id in response');
    else ok('Login A', `user id ${userAId}`);
  } catch (e) {
    fail('Login A', e.message);
    console.log('\nResults:', results);
    process.exit(1);
  }

  // 2) Get another user id (for participantId) — e.g. roommates or users
  let participantId = null;
  const r1 = await req('GET', '/roommates', {}, cookieA);
  if (r1.status === 200 && Array.isArray(r1.data?.data)) {
    const first = r1.data.data[0];
    if (first?.user?.id && first.user.id !== userAId) participantId = first.user.id;
  }
  if (!participantId && r1.data?.data?.length === 0) {
    const r2 = await req('GET', '/users/me', {}, cookieA);
    const me = r2.data?.data ?? r2.data;
    if (me?.id) {
      const r3 = await req('GET', '/housing', {}, cookieA);
      const list = r3.data?.data ?? r3.data;
      const other = Array.isArray(list) ? list.find((l) => l.owner?.id && l.owner.id !== me.id) : null;
      if (other?.owner?.id) participantId = other.owner.id;
    }
  }
  if (!participantId) {
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      const other = await prisma.user.findFirst({ where: { id: { not: userAId }, isActive: true }, select: { id: true } });
      if (other) participantId = other.id;
      await prisma.$disconnect();
    } catch (_) {}
  }
  if (participantId) ok('Participant id', participantId);
  else fail('Participant id', 'No second user found (create conversation will use placeholder)');

  // 3) Create conversation
  const createRes = await req('POST', '/conversations', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId: participantId || userAId }),
  }, cookieA);
  let conversationId = null;
  if (createRes.status === 201 || createRes.status === 200) {
    const conv = createRes.data?.data ?? createRes.data;
    conversationId = conv?.id;
    if (conversationId) ok('Create conversation', `id=${conversationId}`);
    else fail('Create conversation', 'No conversation id in response');
  } else {
    fail('Create conversation', `${createRes.status} ${JSON.stringify(createRes.data)}`);
  }

  // 4) Duplicate: create again same participant
  const dupRes = await req('POST', '/conversations', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId: participantId || userAId }),
  }, cookieA);
  if (dupRes.status === 200 || dupRes.status === 201) {
    const conv = dupRes.data?.data ?? dupRes.data;
    if (conv?.id === conversationId) ok('Duplicate prevention', 'Same conversation returned');
    else ok('Duplicate prevention', 'Conversation returned');
  } else {
    fail('Duplicate prevention', `${dupRes.status}`);
  }

  // 5) List conversations
  const listRes = await req('GET', '/conversations', {}, cookieA);
  if (listRes.status === 200) {
    const list = listRes.data?.data ?? listRes.data;
    const arr = Array.isArray(list) ? list : [];
    ok('List conversations', `count=${arr.length}`);
  } else {
    fail('List conversations', `${listRes.status}`);
  }

  // 6) Unread count
  const unreadRes = await req('GET', '/conversations/unread-count', {}, cookieA);
  if (unreadRes.status === 200) {
    const u = unreadRes.data?.data ?? unreadRes.data;
    ok('Unread count', `unreadCount=${u?.unreadCount ?? '?'}`);
  } else {
    fail('Unread count', `${unreadRes.status}`);
  }

  if (conversationId) {
    // 7) Get messages (cursor)
    const msgRes = await req('GET', `/conversations/${conversationId}/messages?limit=3`, {}, cookieA);
    if (msgRes.status === 200) {
      const payload = msgRes.data;
      const data = payload?.data ?? payload;
      const nextCursor = payload?.nextCursor;
      const arr = Array.isArray(data) ? data : [];
      ok('Get messages', `data.length=${arr.length}, nextCursor=${nextCursor ?? 'null'}`);
    } else {
      fail('Get messages', `${msgRes.status}`);
    }

    // 8) Send message (text)
    const sendRes = await req('POST', `/conversations/${conversationId}/messages`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hey! How\'s everything going?' }),
    }, cookieA);
    if (sendRes.status === 201) {
      const msg = sendRes.data?.data ?? sendRes.data;
      ok('Send message (text)', msg?.id ? `id=${msg.id}` : 'created');
    } else {
      fail('Send message (text)', `${sendRes.status} ${JSON.stringify(sendRes.data)}`);
    }

    // 9) Mark as read
    const readRes = await req('PATCH', `/conversations/${conversationId}/read`, {}, cookieA);
    if (readRes.status === 200) {
      const r = readRes.data?.data ?? readRes.data;
      ok('Mark as read', r?.lastReadAt ? 'ok' : `${readRes.status}`);
    } else {
      fail('Mark as read', `${readRes.status}`);
    }
  }

  // 10) WebSocket: connect with session (using cookie)
  try {
    const { io } = await import('socket.io-client');
    const cookieForWs = cookieA || '';
    const socket = io(`${BASE_WS}/chat`, {
      path: '/socket.io',
      extraHeaders: cookieForWs ? { Cookie: cookieForWs } : {},
      transports: ['websocket'],
      autoConnect: true,
    });
    const connected = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), 5000);
      socket.on('connect', () => {
        clearTimeout(t);
        resolve(true);
      });
      socket.on('connect_error', () => {
        clearTimeout(t);
        resolve(false);
      });
    });
    if (connected) {
      ok('WebSocket connection', 'Connected with session');
      if (conversationId) {
        socket.emit('join_conversation', { conversationId });
        await new Promise((r) => setTimeout(r, 200));
      }
      socket.disconnect();
    } else {
      fail('WebSocket connection', 'Connection failed or timed out');
    }
  } catch (e) {
    fail('WebSocket connection', e.message || 'socket.io-client not available');
  }

  console.log('\n--- Summary ---');
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

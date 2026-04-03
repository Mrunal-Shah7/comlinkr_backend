/**
 * Sprint 8 — WebSocket check: connect to /chat with session cookie from file.
 * Usage: node scripts/sprint8-ws-check.mjs [cookie-file]
 * Cookie file should contain comlinkr.sid (e.g. from curl -c).
 */
import { readFileSync } from 'fs';
import { io } from 'socket.io-client';

const cookieFile = process.argv[2]; // no default: if missing, test "no cookie" rejection
const BASE_WS = 'http://localhost:4000';

function parseCookieFromJar(path) {
  if (!path) return null;
  try {
    const text = readFileSync(path, 'utf8');
    const line = text.split('\n').find((l) => l.includes('comlinkr.sid'));
    if (!line) return null;
    const tab = line.split('\t');
    const nameIdx = tab.findIndex((c) => c === 'comlinkr.sid');
    const value = nameIdx >= 0 ? tab[nameIdx + 1]?.trim() : tab[tab.length - 1]?.trim();
    return value ? `comlinkr.sid=${value}` : null;
  } catch {
    return null;
  }
}

const cookie = parseCookieFromJar(cookieFile);
const expectConnect = !!cookie;
if (cookieFile && !cookie) {
  console.error('No comlinkr.sid in', cookieFile);
  process.exit(1);
}

const socket = io(`${BASE_WS}/chat`, {
  path: '/socket.io',
  extraHeaders: cookie ? { Cookie: cookie } : {},
  transports: ['websocket'],
  autoConnect: true,
});

const done = (ok, msg) => {
  console.log(ok ? '[PASS]' : '[FAIL]', msg);
  socket.disconnect();
  process.exit(ok ? 0 : 1);
};

socket.on('connect', () => {
  console.log('Connected. Socket id:', socket.id);
  if (expectConnect) {
    socket.emit('join_conversation', { conversationId: 'e25e9e30-f5a8-4f68-97c6-b66490f77128' });
    setTimeout(() => done(true, 'WebSocket connection with session + join_conversation'), 500);
  }
  // When no cookie expected, server may disconnect after connect; we'll pass on disconnect
});

socket.on('disconnect', (reason) => {
  if (!expectConnect) {
    done(true, 'WebSocket correctly rejected (no session, disconnected: ' + reason + ')');
  }
});

socket.on('connect_error', (err) => {
  if (!expectConnect) done(true, 'WebSocket correctly rejected (no session)');
  else done(false, 'WebSocket connect_error: ' + (err.message || err));
});

socket.on('error', (payload) => {
  console.log('Server error event:', payload);
});

setTimeout(() => {
  if (socket.connected && expectConnect) return;
  if (!socket.connected && !expectConnect) done(true, 'WebSocket correctly rejected (no session, timeout)');
  else done(false, 'WebSocket connection timeout');
}, 6000);

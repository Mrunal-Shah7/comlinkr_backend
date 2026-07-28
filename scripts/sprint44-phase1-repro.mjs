import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const BASE = process.env.SPRINT44_API_BASE || 'http://localhost:4000/api';
const PASSWORD = 'Sprint44Test!234';
const EMAIL_A = 'sprint44a@comlinkr.test';
const EMAIL_B = 'sprint44b@comlinkr.test';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

function parseSetCookie(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  if (raw.length) {
    return raw.map((c) => c.split(';')[0]).join('; ');
  }
  const single = res.headers.get('set-cookie');
  if (!single) return '';
  return single.split(',').map((p) => p.trim().split(';')[0]).join('; ');
}

async function login(email) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password: PASSWORD }),
  });
  const body = await res.json();
  const cookie = parseSetCookie(res);
  if (!res.ok) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(body)}`);
  }
  // Prefer body sessionCookie (signed) over Set-Cookie when present
  const sessionCookie =
    body?.data?.sessionCookie || body?.sessionCookie || cookie;
  let cookieHeader = '';
  if (typeof sessionCookie === 'string' && sessionCookie.includes('=')) {
    cookieHeader = sessionCookie.split(';')[0];
  } else if (cookie) {
    cookieHeader = cookie;
  }
  return {
    status: res.status,
    body,
    cookie: cookieHeader,
    userId: body?.data?.user?.id || body?.user?.id,
  };
}

async function api(cookie, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Cookie: cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, raw: text };
}

async function membersFor(conversationId, userAId, userBId) {
  const rows = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: {
      id: true,
      conversationId: true,
      userId: true,
      status: true,
      isHidden: true,
      role: true,
    },
    orderBy: { userId: 'asc' },
  });
  return rows.map((r) => ({
    ...r,
    who: r.userId === userAId ? 'A(blocker)' : r.userId === userBId ? 'B(target)' : 'other',
  }));
}

async function main() {
  const out = {};

  const aLogin = await login(EMAIL_A);
  const bLogin = await login(EMAIL_B);
  out.loginA = { status: aLogin.status, userId: aLogin.userId, cookiePresent: !!aLogin.cookie };
  out.loginB = { status: bLogin.status, userId: bLogin.userId, cookiePresent: !!bLogin.cookie };

  const userAId = aLogin.userId;
  const userBId = bLogin.userId;

  // Create conversation A->B
  const create = await api(aLogin.cookie, 'POST', '/conversations', {
    participantId: userBId,
  });
  out.step0_create = { status: create.status, body: create.body };
  const conversationId = create.body?.data?.id || create.body?.id;
  if (!conversationId) {
    console.log(JSON.stringify(out, null, 2));
    throw new Error('No conversation id');
  }
  out.originalConversationId = conversationId;

  // B accept
  const bMember = await prisma.conversationMember.findUnique({
    where: {
      conversationId_userId: { conversationId, userId: userBId },
    },
  });
  const accept = await api(bLogin.cookie, 'PATCH', `/conversations/members/${bMember.id}/status`, {
    status: 'ACCEPTED',
  });
  out.step0_accept = { status: accept.status, body: accept.body };

  // Exchange messages (3 each)
  const msgs = [];
  for (let i = 1; i <= 3; i++) {
    msgs.push(
      await api(aLogin.cookie, 'POST', `/conversations/${conversationId}/messages`, {
        content: `A message ${i}`,
        type: 'TEXT',
      }),
    );
    msgs.push(
      await api(bLogin.cookie, 'POST', `/conversations/${conversationId}/messages`, {
        content: `B message ${i}`,
        type: 'TEXT',
      }),
    );
  }
  out.step0_messages = msgs.map((m) => ({ status: m.status, id: m.body?.data?.id || m.body?.id }));

  // 1.3.1 Confirm visible both sides
  const listA1 = await api(aLogin.cookie, 'GET', '/conversations');
  const listB1 = await api(bLogin.cookie, 'GET', '/conversations');
  const msgsA1 = await api(aLogin.cookie, 'GET', `/conversations/${conversationId}/messages`);
  const msgsB1 = await api(bLogin.cookie, 'GET', `/conversations/${conversationId}/messages`);
  out.step1_visible = {
    listA_has: (listA1.body?.data || listA1.body || []).some?.((c) => c.id === conversationId) ?? false,
    listB_has: (listB1.body?.data || listB1.body || []).some?.((c) => c.id === conversationId) ?? false,
    listA_status: listA1.status,
    listB_status: listB1.status,
    msgsA: { status: msgsA1.status, count: (msgsA1.body?.data || []).length },
    msgsB: { status: msgsB1.status, count: (msgsB1.body?.data || []).length },
    listA_raw: listA1.raw,
    listB_raw: listB1.raw,
  };

  // 1.3.2 Block B from A
  const block = await api(aLogin.cookie, 'POST', '/settings/blocked-users', {
    userId: userBId,
  });
  out.step2_block = { status: block.status, body: block.body, raw: block.raw };

  // 1.3.3 Query members after block
  out.step3_members_after_block = await membersFor(conversationId, userAId, userBId);

  // 1.3.4 Unblock
  const unblock = await api(
    aLogin.cookie,
    'DELETE',
    `/settings/blocked-users/${userBId}`,
  );
  out.step4_unblock = { status: unblock.status, body: unblock.body, raw: unblock.raw };

  // 1.3.5 BlockedUser gone
  const bu = await prisma.blockedUser.findUnique({
    where: { blockerId_blockedId: { blockerId: userAId, blockedId: userBId } },
  });
  out.step5_blockedUser = bu;

  // 1.3.6 Members after unblock
  out.step6_members_after_unblock = await membersFor(conversationId, userAId, userBId);

  // 1.3.7 List from A
  const listA2 = await api(aLogin.cookie, 'GET', '/conversations');
  const listA2arr = listA2.body?.data || listA2.body || [];
  out.step7_listA = {
    status: listA2.status,
    hasConversation: Array.isArray(listA2arr)
      ? listA2arr.some((c) => c.id === conversationId)
      : false,
    ids: Array.isArray(listA2arr) ? listA2arr.map((c) => c.id) : listA2arr,
    raw: listA2.raw,
  };

  // 1.3.8 Messages from A — THE REPORTED ERROR
  const msgsA2 = await api(
    aLogin.cookie,
    'GET',
    `/conversations/${conversationId}/messages`,
  );
  out.step8_messagesA = {
    status: msgsA2.status,
    raw: msgsA2.raw,
    body: msgsA2.body,
  };

  // 1.3.9 Create conversation again
  const create2 = await api(aLogin.cookie, 'POST', '/conversations', {
    participantId: userBId,
  });
  out.step9_reinitiate = {
    status: create2.status,
    raw: create2.raw,
    body: create2.body,
    returnedId: create2.body?.data?.id || create2.body?.id || null,
    matchesOriginal:
      (create2.body?.data?.id || create2.body?.id) === conversationId,
  };

  // 1.3.10 Messages for whatever id step 9 returned (or original if none)
  const idFor10 =
    create2.body?.data?.id || create2.body?.id || conversationId;
  const msgsA3 = await api(
    aLogin.cookie,
    'GET',
    `/conversations/${idFor10}/messages`,
  );
  out.step10_messages = {
    conversationId: idFor10,
    status: msgsA3.status,
    raw: msgsA3.raw,
    body: msgsA3.body,
  };

  // 1.4 Silent write path
  const listB2 = await api(bLogin.cookie, 'GET', '/conversations');
  const listB2arr = listB2.body?.data || listB2.body || [];
  out.step14_1_listB = {
    status: listB2.status,
    hasConversation: Array.isArray(listB2arr)
      ? listB2arr.some((c) => c.id === conversationId)
      : false,
    raw: listB2.raw,
  };

  const sendB = await api(
    bLogin.cookie,
    'POST',
    `/conversations/${conversationId}/messages`,
    { content: 'Silent write from B after unblock', type: 'TEXT' },
  );
  out.step14_2_sendB = {
    status: sendB.status,
    raw: sendB.raw,
    body: sendB.body,
  };

  const listA3 = await api(aLogin.cookie, 'GET', '/conversations');
  const msgsOld = await api(
    aLogin.cookie,
    'GET',
    `/conversations/${conversationId}/messages`,
  );
  out.step14_3_reachabilityA = {
    listA_raw: listA3.raw,
    msgsOld: { status: msgsOld.status, raw: msgsOld.raw },
  };

  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

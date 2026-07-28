import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';
import { writeFileSync } from 'fs';

const BASE = process.env.SPRINT44_API_BASE || 'http://localhost:4000/api';
const PASSWORD = 'Sprint44Test!234';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function parseSetCookie(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  if (raw.length) return raw.map((c) => c.split(';')[0]).join('; ');
  const single = res.headers.get('set-cookie');
  if (!single) return '';
  return single
    .split(',')
    .map((p) => p.trim().split(';')[0])
    .join('; ');
}

async function upsertUser(email, username, fullName) {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      username,
      fullName,
      role: 'USER',
      onboardingCompleted: true,
      authProviders: { create: { provider: 'LOCAL', passwordHash } },
    },
    update: {
      username,
      fullName,
      onboardingCompleted: true,
      isActive: true,
      deletedAt: null,
    },
    include: { authProviders: true },
  });
  if (user.authProviders.length === 0) {
    await prisma.authProvider.create({
      data: { userId: user.id, provider: 'LOCAL', passwordHash },
    });
  } else {
    await prisma.authProvider.updateMany({
      where: { userId: user.id, provider: 'LOCAL' },
      data: { passwordHash },
    });
  }
  return user;
}

async function wipePair(aId, bId) {
  await prisma.blockedUser.deleteMany({
    where: {
      OR: [
        { blockerId: aId, blockedId: bId },
        { blockerId: bId, blockedId: aId },
      ],
    },
  });
  const shared = await prisma.conversation.findMany({
    where: {
      type: 'DIRECT',
      AND: [
        { members: { some: { userId: aId } } },
        { members: { some: { userId: bId } } },
      ],
    },
    select: { id: true },
  });
  const ids = shared.map((c) => c.id);
  if (ids.length) {
    await prisma.message.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversationMember.deleteMany({
      where: { conversationId: { in: ids } },
    });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  }
}

async function login(email) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${email}: ${JSON.stringify(body)}`);
  const sessionCookie = body?.data?.sessionCookie || body?.sessionCookie || '';
  const cookie =
    (typeof sessionCookie === 'string' && sessionCookie.includes('=')
      ? sessionCookie.split(';')[0]
      : parseSetCookie(res)) || parseSetCookie(res);
  return {
    cookie,
    userId: body?.data?.user?.id || body?.user?.id,
    body,
  };
}

async function api(cookie, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Cookie: cookie,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }
  return { status: res.status, body: parsed, raw };
}

async function members(conversationId) {
  return prisma.conversationMember.findMany({
    where: { conversationId },
    select: {
      userId: true,
      status: true,
      isHidden: true,
      blockedByUserBlock: true,
    },
    orderBy: { userId: 'asc' },
  });
}

async function main() {
  const out = { phase4: {}, phase5: {}, phase6: {} };

  const a = await upsertUser(
    'sprint44a@comlinkr.test',
    'sprint44a',
    'Sprint44 User A',
  );
  const b = await upsertUser(
    'sprint44b@comlinkr.test',
    'sprint44b',
    'Sprint44 User B',
  );
  const c = await upsertUser(
    'sprint44c@comlinkr.test',
    'sprint44c',
    'Sprint44 User C',
  );
  const d = await upsertUser(
    'sprint44d@comlinkr.test',
    'sprint44d',
    'Sprint44 User D',
  );
  const e = await upsertUser(
    'sprint44e@comlinkr.test',
    'sprint44e',
    'Sprint44 User E',
  );
  const f = await upsertUser(
    'sprint44f@comlinkr.test',
    'sprint44f',
    'Sprint44 User F',
  );

  // ---------- Phase 4.4 unblock response + Phase 4 gate 4 isolation ----------
  await wipePair(c.id, d.id);
  const declined = await prisma.conversation.create({
    data: {
      type: 'DIRECT',
      contextType: 'GENERAL',
      createdById: c.id,
      members: {
        create: [
          { userId: c.id, role: 'MEMBER', status: 'ACCEPTED' },
          {
            userId: d.id,
            role: 'MEMBER',
            status: 'BLOCKED',
            blockedByUserBlock: false,
          },
        ],
      },
    },
  });
  const blockedConv = await prisma.conversation.create({
    data: {
      type: 'DIRECT',
      contextType: 'GENERAL',
      createdById: c.id,
      members: {
        create: [
          {
            userId: c.id,
            role: 'MEMBER',
            status: 'BLOCKED',
            blockedByUserBlock: true,
          },
          { userId: d.id, role: 'MEMBER', status: 'ACCEPTED' },
        ],
      },
    },
  });
  await prisma.blockedUser.create({
    data: { blockerId: c.id, blockedId: d.id },
  });
  out.phase4.isolation_before = {
    declined: await members(declined.id),
    blocked: await members(blockedConv.id),
  };
  const cLogin = await login('sprint44c@comlinkr.test');
  const unblockIso = await api(
    cLogin.cookie,
    'DELETE',
    `/settings/blocked-users/${d.id}`,
  );
  out.phase4.unblock_response = {
    status: unblockIso.status,
    raw: unblockIso.raw,
  };
  out.phase4.isolation_after = {
    declined: await members(declined.id),
    blocked: await members(blockedConv.id),
  };

  // ---------- Phase 6.1 full defect walkthrough (fresh A/B) ----------
  await wipePair(a.id, b.id);
  const aLogin = await login('sprint44a@comlinkr.test');
  const bLogin = await login('sprint44b@comlinkr.test');

  const create1 = await api(aLogin.cookie, 'POST', '/conversations', {
    participantId: b.id,
  });
  const oldId = create1.body?.data?.id;
  out.phase6.originalId = oldId;
  const bMem = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: oldId, userId: b.id } },
  });
  await api(bLogin.cookie, 'PATCH', `/conversations/members/${bMem.id}/status`, {
    status: 'ACCEPTED',
  });
  for (let i = 1; i <= 3; i++) {
    await api(aLogin.cookie, 'POST', `/conversations/${oldId}/messages`, {
      content: `A${i}`,
      type: 'TEXT',
    });
    await api(bLogin.cookie, 'POST', `/conversations/${oldId}/messages`, {
      content: `B${i}`,
      type: 'TEXT',
    });
  }

  const block = await api(aLogin.cookie, 'POST', '/settings/blocked-users', {
    userId: b.id,
  });
  out.phase6.block = { status: block.status, raw: block.raw };
  out.phase6.members_after_block = await members(oldId);

  const unblock = await api(
    aLogin.cookie,
    'DELETE',
    `/settings/blocked-users/${b.id}`,
  );
  out.phase6.unblock = { status: unblock.status, raw: unblock.raw };
  out.phase6.members_after_unblock = await members(oldId);

  const listA_after = await api(aLogin.cookie, 'GET', '/conversations');
  const listB_after = await api(bLogin.cookie, 'GET', '/conversations');
  out.phase6.lists_after_unblock = {
    A_has_old: (listA_after.body?.data || []).some((x) => x.id === oldId),
    B_has_old: (listB_after.body?.data || []).some((x) => x.id === oldId),
    A_raw: listA_after.raw,
    B_raw: listB_after.raw,
  };

  const reinit = await api(aLogin.cookie, 'POST', '/conversations', {
    participantId: b.id,
  });
  const newId = reinit.body?.data?.id;
  out.phase6.reinit = {
    status: reinit.status,
    raw: reinit.raw,
    newId,
    differentFromOld: newId && newId !== oldId,
  };

  const msgsNew = await api(
    aLogin.cookie,
    'GET',
    `/conversations/${newId}/messages`,
  );
  out.phase6.msgs_new = {
    status: msgsNew.status,
    raw: msgsNew.raw,
    count: (msgsNew.body?.data || []).length,
  };

  const sendNew = await api(
    aLogin.cookie,
    'POST',
    `/conversations/${newId}/messages`,
    { content: 'hello fresh', type: 'TEXT' },
  );
  out.phase6.send_new = { status: sendNew.status, raw: sendNew.raw };

  const listB_pending = await api(bLogin.cookie, 'GET', '/conversations');
  const pendingConv = (listB_pending.body?.data || []).find(
    (x) => x.id === newId,
  );
  out.phase6.B_sees_pending = {
    found: !!pendingConv,
    myStatus: pendingConv?.members?.find((m) => m.userId === b.id)?.status,
    raw_ids: (listB_pending.body?.data || []).map((x) => x.id),
  };

  const bMemNew = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: newId, userId: b.id } },
  });
  const acceptNew = await api(
    bLogin.cookie,
    'PATCH',
    `/conversations/members/${bMemNew.id}/status`,
    { status: 'ACCEPTED' },
  );
  const sendBnew = await api(
    bLogin.cookie,
    'POST',
    `/conversations/${newId}/messages`,
    { content: 'B on fresh', type: 'TEXT' },
  );
  out.phase6.accept_and_send_B = {
    accept: acceptNew.status,
    send: sendBnew.status,
  };

  // 6.2 silent write path closed at list level
  const sendBold = await api(
    bLogin.cookie,
    'POST',
    `/conversations/${oldId}/messages`,
    { content: 'into retired', type: 'TEXT' },
  );
  out.phase6.silent_write = {
    B_list_has_old: (listB_after.body?.data || []).some((x) => x.id === oldId),
    B_send_by_id: { status: sendBold.status, raw: sendBold.raw },
  };

  // ---------- Phase 5.2 delete-chat hidden clear ----------
  await wipePair(e.id, f.id);
  const eLogin = await login('sprint44e@comlinkr.test');
  const fLogin = await login('sprint44f@comlinkr.test');
  const efCreate = await api(eLogin.cookie, 'POST', '/conversations', {
    participantId: f.id,
  });
  const efId = efCreate.body?.data?.id;
  const fMem = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: efId, userId: f.id } },
  });
  await api(fLogin.cookie, 'PATCH', `/conversations/members/${fMem.id}/status`, {
    status: 'ACCEPTED',
  });
  await api(eLogin.cookie, 'POST', `/conversations/${efId}/messages`, {
    content: 'before hide',
    type: 'TEXT',
  });
  const hide = await api(eLogin.cookie, 'DELETE', `/conversations/${efId}`);
  const listE_hidden = await api(eLogin.cookie, 'GET', '/conversations');
  const reopen = await api(eLogin.cookie, 'POST', '/conversations', {
    participantId: f.id,
  });
  const listE_after = await api(eLogin.cookie, 'GET', '/conversations');
  const eMemberAfter = await members(efId);
  out.phase5.hidden_fix = {
    hide_status: hide.status,
    list_while_hidden_has: (listE_hidden.body?.data || []).some(
      (x) => x.id === efId,
    ),
    reopen_id: reopen.body?.data?.id,
    same_id: reopen.body?.data?.id === efId,
    list_after_has: (listE_after.body?.data || []).some((x) => x.id === efId),
    members: eMemberAfter,
    f_still_hidden: eMemberAfter.find((m) => m.userId === f.id)?.isHidden,
  };

  // ---------- Phase 6.4 never-blocked pair regression captures ----------
  // Use E/F after reopen (never blocked)
  const reg = {};
  reg.list = await api(eLogin.cookie, 'GET', '/conversations');
  reg.create_again = await api(eLogin.cookie, 'POST', '/conversations', {
    participantId: f.id,
  });
  reg.msgs = await api(eLogin.cookie, 'GET', `/conversations/${efId}/messages`);
  reg.msgs_cursor = await api(
    eLogin.cookie,
    'GET',
    `/conversations/${efId}/messages?cursor=${encodeURIComponent(
      (reg.msgs.body?.data || [])[0]?.createdAt || new Date().toISOString(),
    )}`,
  );
  reg.send_text = await api(
    eLogin.cookie,
    'POST',
    `/conversations/${efId}/messages`,
    { content: 'reg text', type: 'TEXT' },
  );
  reg.read = await api(eLogin.cookie, 'PATCH', `/conversations/${efId}/read`);
  reg.unread = await api(eLogin.cookie, 'GET', '/conversations/unread-count');
  reg.get_one = await api(eLogin.cookie, 'GET', `/conversations/${efId}`);
  out.phase6.messaging_regression = {
    list_status: reg.list.status,
    create_status: reg.create_again.status,
    create_same_id: reg.create_again.body?.data?.id === efId,
    msgs_status: reg.msgs.status,
    msgs_cursor_status: reg.msgs_cursor.status,
    send_text_status: reg.send_text.status,
    read_status: reg.read.status,
    unread_status: reg.unread.status,
    get_one_status: reg.get_one.status,
    bodies: {
      list: reg.list.raw,
      create: reg.create_again.raw,
      msgs: reg.msgs.raw,
      send: reg.send_text.raw,
      read: reg.read.raw,
      unread: reg.unread.raw,
    },
  };

  // ---------- Phase 6.5 cross-module smoke ----------
  const adminLogin = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'admin@comlinkr.com',
      password: 'Admin@123456',
    }),
  });
  const adminBody = await adminLogin.json();
  const adminCookie = (
    adminBody?.data?.sessionCookie ||
    adminBody?.sessionCookie ||
    ''
  ).split(';')[0];
  const modules = {};
  modules.auth_me = await api(aLogin.cookie, 'GET', '/auth/me');
  modules.users_me = await api(aLogin.cookie, 'GET', '/users/me');
  modules.feed = await api(aLogin.cookie, 'GET', '/feed?page=1&limit=1');
  modules.housing = await api(
    aLogin.cookie,
    'GET',
    '/housing/listings?page=1&limit=1',
  );
  modules.food = await api(
    aLogin.cookie,
    'GET',
    '/food/restaurants?page=1&limit=1',
  );
  modules.events = await api(aLogin.cookie, 'GET', '/events?page=1&limit=1');
  modules.roommates = await api(
    aLogin.cookie,
    'GET',
    '/roommates?page=1&limit=1',
  );
  modules.community = await api(
    aLogin.cookie,
    'GET',
    '/community/questions?page=1&limit=1',
  );
  modules.news = await api(aLogin.cookie, 'GET', '/news/explore');
  modules.notifications = await api(
    aLogin.cookie,
    'GET',
    '/notifications?page=1&limit=1',
  );
  modules.settings = await api(aLogin.cookie, 'GET', '/settings/account');
  if (adminCookie) {
    modules.admin_users = await api(
      adminCookie,
      'GET',
      '/admin/users?page=1&pageSize=1',
    );
  }
  // Group conversation exemption: find any GROUP membership
  const groupMem = await prisma.conversationMember.findFirst({
    where: { conversation: { type: 'GROUP' } },
    include: { conversation: { select: { id: true, type: true } } },
  });
  out.phase6.cross_module = {
    statuses: Object.fromEntries(
      Object.entries(modules).map(([k, v]) => [
        k,
        { status: v.status, success: v.body?.success },
      ]),
    ),
    group_sample: groupMem
      ? { id: groupMem.conversation.id, type: groupMem.conversation.type }
      : null,
  };

  // Phase 5.4: resolvers on pair with two conversations (A/B after walkthrough)
  const pairConvs = await prisma.conversation.findMany({
    where: {
      type: 'DIRECT',
      AND: [
        { members: { some: { userId: a.id } } },
        { members: { some: { userId: b.id } } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true },
  });
  out.phase5.pair_two_conversations = pairConvs;
  out.phase5.most_recent_is_new = pairConvs[0]?.id === newId;

  writeFileSync(
    'scripts/sprint44-verify-out.json',
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

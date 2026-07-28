import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const BASE = 'http://localhost:4000/api';
const PASSWORD = 'Sprint44Test!234';
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function login(email) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password: PASSWORD }),
  });
  const body = await res.json();
  const cookie = (body?.data?.sessionCookie || body?.sessionCookie || '').split(
    ';',
  )[0];
  return { cookie, userId: body?.data?.user?.id || body?.user?.id };
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
  const raw = await res.text();
  return { status: res.status, raw, body: JSON.parse(raw) };
}

async function main() {
  const out = {};
  // Message-request decline + unblock isolation (fresh pair via existing E/F wipe create)
  const e = await prisma.user.findUnique({
    where: { email: 'sprint44e@comlinkr.test' },
  });
  const f = await prisma.user.findUnique({
    where: { email: 'sprint44f@comlinkr.test' },
  });
  await prisma.blockedUser.deleteMany({
    where: {
      OR: [
        { blockerId: e.id, blockedId: f.id },
        { blockerId: f.id, blockedId: e.id },
      ],
    },
  });
  const shared = await prisma.conversation.findMany({
    where: {
      type: 'DIRECT',
      AND: [
        { members: { some: { userId: e.id } } },
        { members: { some: { userId: f.id } } },
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

  const eLogin = await login('sprint44e@comlinkr.test');
  const fLogin = await login('sprint44f@comlinkr.test');
  const created = await api(eLogin.cookie, 'POST', '/conversations', {
    participantId: f.id,
  });
  const convId = created.body.data.id;
  const fMem = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: convId, userId: f.id } },
  });
  // F declines message request
  const decline = await api(
    fLogin.cookie,
    'PATCH',
    `/conversations/members/${fMem.id}/status`,
    { status: 'BLOCKED' },
  );
  out.decline = { status: decline.status, raw: decline.raw };
  const before = await prisma.conversationMember.findMany({
    where: { conversationId: convId },
    select: {
      userId: true,
      status: true,
      isHidden: true,
      blockedByUserBlock: true,
    },
  });
  out.before_unblock = before;
  // E blocks then unblocks F (user-block on a pair that also has declined request)
  // First need a shared conversation where E can set provenance — blockUser flips E's rows on shared convs
  const block = await api(eLogin.cookie, 'POST', '/settings/blocked-users', {
    userId: f.id,
  });
  out.block = block.raw;
  const mid = await prisma.conversationMember.findMany({
    where: { conversationId: convId },
    select: {
      userId: true,
      status: true,
      isHidden: true,
      blockedByUserBlock: true,
    },
  });
  out.after_block = mid;
  const unblock = await api(
    eLogin.cookie,
    'DELETE',
    `/settings/blocked-users/${f.id}`,
  );
  out.unblock = unblock.raw;
  const after = await prisma.conversationMember.findMany({
    where: { conversationId: convId },
    select: {
      userId: true,
      status: true,
      isHidden: true,
      blockedByUserBlock: true,
    },
  });
  out.after_unblock = after;
  // F's declined status must remain BLOCKED; conversation may be retired because E's block set provenance on E's row
  out.f_still_blocked =
    after.find((m) => m.userId === f.id)?.status === 'BLOCKED';
  out.f_provenance_still_false =
    after.find((m) => m.userId === f.id)?.blockedByUserBlock === false;

  // Other-participant hide not cleared: hide F, then E reopens
  await prisma.blockedUser.deleteMany({
    where: {
      OR: [
        { blockerId: e.id, blockedId: f.id },
        { blockerId: f.id, blockedId: e.id },
      ],
    },
  });
  // Reset members for hide test on a new usable conversation
  const shared2 = await prisma.conversation.findMany({
    where: {
      type: 'DIRECT',
      AND: [
        { members: { some: { userId: e.id } } },
        { members: { some: { userId: f.id } } },
      ],
    },
    select: { id: true },
  });
  const ids2 = shared2.map((c) => c.id);
  if (ids2.length) {
    await prisma.message.deleteMany({
      where: { conversationId: { in: ids2 } },
    });
    await prisma.conversationMember.deleteMany({
      where: { conversationId: { in: ids2 } },
    });
    await prisma.conversation.deleteMany({ where: { id: { in: ids2 } } });
  }
  const c2 = await api(eLogin.cookie, 'POST', '/conversations', {
    participantId: f.id,
  });
  const id2 = c2.body.data.id;
  const fMem2 = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: id2, userId: f.id } },
  });
  await api(fLogin.cookie, 'PATCH', `/conversations/members/${fMem2.id}/status`, {
    status: 'ACCEPTED',
  });
  await api(fLogin.cookie, 'DELETE', `/conversations/${id2}`); // F hides
  await api(eLogin.cookie, 'DELETE', `/conversations/${id2}`); // E hides
  const beforeReopen = await prisma.conversationMember.findMany({
    where: { conversationId: id2 },
    select: { userId: true, isHidden: true },
  });
  const reopen = await api(eLogin.cookie, 'POST', '/conversations', {
    participantId: f.id,
  });
  const afterReopen = await prisma.conversationMember.findMany({
    where: { conversationId: id2 },
    select: { userId: true, isHidden: true },
  });
  out.hide_other_party = {
    beforeReopen,
    reopenId: reopen.body?.data?.id,
    afterReopen,
    e_cleared: afterReopen.find((m) => m.userId === e.id)?.isHidden === false,
    f_still_hidden:
      afterReopen.find((m) => m.userId === f.id)?.isHidden === true,
  };

  // Module smoke with correct paths
  out.modules = {
    housing: await api(eLogin.cookie, 'GET', '/housing?page=1&limit=1'),
    restaurants: await api(eLogin.cookie, 'GET', '/restaurants?page=1&limit=1'),
    shared_spaces: await api(
      eLogin.cookie,
      'GET',
      '/shared-spaces?page=1&limit=1',
    ),
    stories: await api(eLogin.cookie, 'GET', '/stories?page=1&limit=1'),
  };
  out.modules_summary = Object.fromEntries(
    Object.entries(out.modules).map(([k, v]) => [
      k,
      { status: v.status, success: v.body?.success },
    ]),
  );

  // Group exemption code path untouched — confirm any GROUP exists or create none
  const group = await prisma.conversation.findFirst({
    where: { type: 'GROUP' },
    select: { id: true, type: true },
  });
  out.group = group;

  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

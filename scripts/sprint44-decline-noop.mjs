import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const BASE = 'http://localhost:4000/api';
const PASS = 'Sprint44Test!234';
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function login(email) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password: PASS }),
  });
  const b = await r.json();
  return {
    cookie: (b.data?.sessionCookie || b.sessionCookie || '').split(';')[0],
    id: b.data?.user?.id || b.user?.id,
  };
}

async function main() {
  const a = await login('sprint44a@comlinkr.test');
  const bUser = await prisma.user.findUnique({
    where: { email: 'sprint44b@comlinkr.test' },
  });
  await prisma.blockedUser.deleteMany({
    where: {
      OR: [
        { blockerId: a.id, blockedId: bUser.id },
        { blockerId: bUser.id, blockedId: a.id },
      ],
    },
  });
  const shared = await prisma.conversation.findMany({
    where: {
      type: 'DIRECT',
      AND: [
        { members: { some: { userId: a.id } } },
        { members: { some: { userId: bUser.id } } },
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

  const cRes = await fetch(`${BASE}/conversations`, {
    method: 'POST',
    headers: { Cookie: a.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId: bUser.id }),
  });
  const conv = (await cRes.json()).data;
  const bLogin = await login('sprint44b@comlinkr.test');
  const mem = await prisma.conversationMember.findUnique({
    where: {
      conversationId_userId: { conversationId: conv.id, userId: bUser.id },
    },
  });
  await fetch(`${BASE}/conversations/members/${mem.id}/status`, {
    method: 'PATCH',
    headers: { Cookie: bLogin.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'BLOCKED' }),
  });
  const before = await prisma.conversationMember.findMany({
    where: { conversationId: conv.id },
    select: {
      userId: true,
      status: true,
      isHidden: true,
      blockedByUserBlock: true,
    },
  });
  const u = await fetch(`${BASE}/settings/blocked-users/${bUser.id}`, {
    method: 'DELETE',
    headers: { Cookie: a.cookie },
  });
  const uBody = await u.text();
  const after = await prisma.conversationMember.findMany({
    where: { conversationId: conv.id },
    select: {
      userId: true,
      status: true,
      isHidden: true,
      blockedByUserBlock: true,
    },
  });
  console.log(JSON.stringify({ unblock: uBody, before, after }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

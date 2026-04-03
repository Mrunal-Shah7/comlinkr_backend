import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const users = await p.user.findMany({ take: 5, where: { isActive: true }, select: { id: true, email: true } });
console.log(JSON.stringify(users));
await p.$disconnect();

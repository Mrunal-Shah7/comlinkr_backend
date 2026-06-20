"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const connectionString = process.env.DATABASE_URL;
if (!connectionString)
    throw new Error('DATABASE_URL required');
const adapter = new adapter_pg_1.PrismaPg({ connectionString });
const prisma = new client_1.PrismaClient({ adapter });
async function main() {
    const adminId = '3436c80a-22c8-4438-9b24-7078b74bea60';
    const existing = await prisma.userBadge.findFirst({
        where: { userId: adminId, badgeType: 'RESTAURANT_OWNER' },
    });
    if (existing) {
        console.log('Admin already has RESTAURANT_OWNER badge');
        return;
    }
    const app = await prisma.badgeApplication.create({
        data: {
            userId: adminId,
            badgeType: 'RESTAURANT_OWNER',
            status: 'APPROVED',
            fullLegalName: 'ComLinkr Admin',
            businessPhone: '+15550100',
            restaurantName: 'Test',
            cuisineType: 'Japanese',
            restaurantAddress: '123 Main St',
        },
    });
    await prisma.userBadge.create({
        data: {
            userId: adminId,
            badgeType: 'RESTAURANT_OWNER',
            applicationId: app.id,
        },
    });
    console.log('RESTAURANT_OWNER badge added for admin');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=add-restaurant-badge.js.map
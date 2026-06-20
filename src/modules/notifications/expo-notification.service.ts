import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** @see https://docs.expo.dev/push-notifications/sending-notifications/ */
const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';

@Injectable()
export class ExpoNotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async registerToken(userId: string, token: string): Promise<void> {
    if (!token.startsWith('ExponentPushToken[')) {
      throw new BadRequestException('Invalid Expo push token format');
    }

    await this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token },
      update: { userId },
    });
  }

  async removeToken(token: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { token } });
  }

  async removeAllTokensForUser(userId: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { userId } });
  }

  async sendToUsers(
    userIds: string[],
    title: string,
    body: string,
  ): Promise<number> {
    if (userIds.length === 0) return 0;
    const tokens = await this.prisma.pushToken.findMany({
      where: { userId: { in: userIds } },
      select: { token: true },
    });
    if (tokens.length === 0) return 0;

    const chunkSize = 100;
    for (let i = 0; i < tokens.length; i += chunkSize) {
      const batch = tokens.slice(i, i + chunkSize);
      try {
        const response = await fetch(EXPO_PUSH_SEND_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(process.env.EXPO_ACCESS_TOKEN
              ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
              : {}),
          },
          body: JSON.stringify(
            batch.map(({ token }) => ({
              to: token,
              title,
              body,
              sound: 'default',
              data: { type: 'BROADCAST' },
            })),
          ),
        });
        const rawText = await response.text();
        if (!response.ok) {
          console.error(
            `Expo push HTTP ${response.status}: ${rawText.slice(0, 500)}`,
          );
          continue;
        }
        let result: {
          data?: Array<{
            status?: string;
            message?: string;
            details?: { error?: string };
          }>;
        };
        try {
          result = JSON.parse(rawText) as typeof result;
        } catch {
          console.error('Expo push: non-JSON response', rawText.slice(0, 200));
          continue;
        }
        const erroredTokens: string[] = [];
        result.data?.forEach((item, index) => {
          if (item?.status === 'error') {
            console.error(
              'Expo push error:',
              item.message ?? 'Unknown Expo error',
            );
            if (item.details?.error === 'DeviceNotRegistered') {
              erroredTokens.push(batch[index].token);
            }
          }
        });
        if (erroredTokens.length > 0) {
          await this.prisma.pushToken.deleteMany({
            where: { token: { in: erroredTokens } },
          });
        }
      } catch (error) {
        console.error('Failed to send Expo push batch', error);
      }
    }

    return tokens.length;
  }

  async sendToCity(city: string, title: string, body: string): Promise<number> {
    const users = await this.prisma.user.findMany({
      where: {
        location: {
          city: {
            equals: city,
            mode: 'insensitive',
          },
        },
      },
      select: { id: true },
    });
    return this.sendToUsers(
      users.map((user) => user.id),
      title,
      body,
    );
  }

  async sendToAll(title: string, body: string): Promise<number> {
    const rows = await this.prisma.pushToken.findMany({
      distinct: ['userId'],
      select: { userId: true },
    });
    return this.sendToUsers(
      rows.map((row) => row.userId),
      title,
      body,
    );
  }
}

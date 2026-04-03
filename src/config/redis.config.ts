import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

export async function createRedisClient(
  configService: ConfigService,
): Promise<RedisClientType> {
  const url = configService.get<string>('REDIS_URL', 'redis://localhost:6379');
  const client = createClient({ url }) as RedisClientType;

  client.on('error', (err) => {
    console.error('Redis client error:', err);
  });

  try {
    await client.connect();
  } catch (err) {
    console.error('Redis connection failed:', err);
  }

  return client;
}

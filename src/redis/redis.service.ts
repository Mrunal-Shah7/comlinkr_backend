import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit {
  private readonly client: RedisClientType;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.client = createClient({ url }) as RedisClientType;
    this.client.on('error', (err) => console.error('Redis client error:', err));
  }

  async onModuleInit() {
    try {
      await this.client.connect();
    } catch (err) {
      console.error('Redis connection failed:', err);
    }
  }

  getClient(): RedisClientType {
    return this.client;
  }
}

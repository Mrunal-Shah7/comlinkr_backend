import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PostsModule } from '../posts/posts.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [PrismaModule, PostsModule],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}


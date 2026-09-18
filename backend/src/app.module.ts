import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { MembersModule } from './members/members.module.js';
import { TestFilesModule } from './test-files/test-files.module.js';

@Module({
  imports: [PrismaModule, AuthModule, ProjectsModule, MembersModule, TestFilesModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

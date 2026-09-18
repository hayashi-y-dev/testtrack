import { Module } from '@nestjs/common';
import { TestFilesController } from './test-files.controller.js';
import { TestFilesService } from './test-files.service.js';

@Module({
  controllers: [TestFilesController],
  providers: [TestFilesService],
})
export class TestFilesModule {}

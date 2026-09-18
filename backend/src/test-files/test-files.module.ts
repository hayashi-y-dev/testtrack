import { Module } from '@nestjs/common';
import { TestFilesController } from './test-files.controller.js';
import { TestFilesService } from './test-files.service.js';
import { ExcelParserService } from './excel-parser.service.js';

@Module({
  controllers: [TestFilesController],
  providers: [TestFilesService, ExcelParserService],
})
export class TestFilesModule {}

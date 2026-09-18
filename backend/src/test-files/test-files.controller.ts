import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { TestFilesService } from './test-files.service.js';
import { TestFilesQueryDto } from './dto/test-files-query.dto.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import type { TestFileListItem } from './test-files.types.js';

@Controller('projects/:projectId/test-files')
@UseGuards(AuthGuard)
export class TestFilesController {
  constructor(private readonly testFilesService: TestFilesService) {}

  @Get()
  async findAll(
    @Param('projectId') projectId: string,
    @Query() query: TestFilesQueryDto,
    @Req() req: Request,
  ): Promise<{ files: TestFileListItem[]; totalCount: number }> {
    const userId = req.session.userId!;
    return this.testFilesService.findAll(userId, projectId, query);
  }
}

import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type {} from 'multer';
import { TestFilesService } from './test-files.service.js';
import { TestFilesQueryDto } from './dto/test-files-query.dto.js';
import { CommitFilesDto } from './dto/commit-files.dto.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import type {
  TestFileListItem,
  PreviewResponse,
  CommitResponse,
} from './test-files.types.js';

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

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FilesInterceptor('files', 50))
  async preview(
    @Param('projectId') projectId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: Request,
  ): Promise<PreviewResponse> {
    if (!files || files.length === 0) {
      throw new BadRequestException('ファイルが選択されていません。');
    }
    const userId = req.session.userId!;
    return this.testFilesService.preview(userId, projectId, files);
  }

  @Post('commit')
  @HttpCode(HttpStatus.OK)
  async commit(
    @Param('projectId') projectId: string,
    @Body() dto: CommitFilesDto,
    @Req() req: Request,
  ): Promise<CommitResponse> {
    const userId = req.session.userId!;
    return this.testFilesService.commit(userId, projectId, dto);
  }

  @Delete(':fileId')
  async remove(
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const userId = req.session.userId!;
    return this.testFilesService.remove(userId, projectId, fileId);
  }
}

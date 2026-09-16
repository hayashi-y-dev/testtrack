import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { ProjectsService } from './projects.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';

interface ProjectListItem {
  id: string;
  name: string;
  status: string;
  myRole: string;
  order: number | null;
}

interface ProjectDetail {
  id: string;
  name: string;
  status: string;
  myRole: string;
  createdAt: Date;
  progressSummary: {
    fileCount: number;
    targetCount: number;
    completedCount: number;
    progressRate: number | null;
    okCount: number;
    ngCount: number;
    notRunCount: number;
  };
}

@Controller('projects')
@UseGuards(AuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  async findAll(
    @Req() req: Request,
  ): Promise<{ projects: ProjectListItem[] }> {
    const userId = req.session.userId!;
    return this.projectsService.findAll(userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateProjectDto,
    @Req() req: Request,
  ): Promise<ProjectListItem> {
    const userId = req.session.userId!;
    return this.projectsService.create(userId, dto);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<ProjectDetail> {
    const userId = req.session.userId!;
    return this.projectsService.findOne(userId, id);
  }
}

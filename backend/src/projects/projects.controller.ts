import {
  Controller,
  Get,
  Post,
  Patch,
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
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { UpdateOrderDto } from './dto/update-order.dto.js';
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

interface ArchivedProject {
  id: string;
  name: string;
  status: string;
}

interface OrderItem {
  projectId: string;
  order: number;
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

  @Patch('order')
  async updateOrder(
    @Body() dto: UpdateOrderDto,
    @Req() req: Request,
  ): Promise<{ orders: OrderItem[] }> {
    const userId = req.session.userId!;
    return this.projectsService.updateOrder(userId, dto);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<ProjectDetail> {
    const userId = req.session.userId!;
    return this.projectsService.findOne(userId, id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @Req() req: Request,
  ): Promise<ProjectListItem> {
    const userId = req.session.userId!;
    return this.projectsService.update(userId, id, dto);
  }

  @Post(':id/archive')
  async archive(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<ArchivedProject> {
    const userId = req.session.userId!;
    return this.projectsService.archive(userId, id);
  }
}

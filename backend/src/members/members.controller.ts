import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { MembersService } from './members.service.js';
import { AddMemberDto } from './dto/add-member.dto.js';
import { ChangeRoleDto } from './dto/change-role.dto.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import type { MemberListItem, SearchResultItem } from './members.types.js';

@Controller('projects/:projectId/members')
@UseGuards(AuthGuard)
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  async findAll(
    @Param('projectId') projectId: string,
    @Req() req: Request,
  ): Promise<{ members: MemberListItem[] }> {
    const userId = req.session.userId!;
    return this.membersService.findAll(userId, projectId);
  }

  @Get('search')
  async search(
    @Param('projectId') projectId: string,
    @Query('q') query: string,
    @Req() req: Request,
  ): Promise<{ results: SearchResultItem[] }> {
    const userId = req.session.userId!;
    return this.membersService.search(userId, projectId, query ?? '');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addMember(
    @Param('projectId') projectId: string,
    @Body() dto: AddMemberDto,
    @Req() req: Request,
  ): Promise<MemberListItem> {
    const userId = req.session.userId!;
    return this.membersService.addMember(userId, projectId, dto);
  }

  @Post('leave')
  @HttpCode(HttpStatus.OK)
  async leave(
    @Param('projectId') projectId: string,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const userId = req.session.userId!;
    return this.membersService.leave(userId, projectId);
  }

  @Patch(':memberId')
  async changeRole(
    @Param('projectId') projectId: string,
    @Param('memberId') memberId: string,
    @Body() dto: ChangeRoleDto,
    @Req() req: Request,
  ): Promise<MemberListItem> {
    const userId = req.session.userId!;
    return this.membersService.changeRole(userId, projectId, memberId, dto);
  }

  @Delete(':memberId')
  async removeMember(
    @Param('projectId') projectId: string,
    @Param('memberId') memberId: string,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const userId = req.session.userId!;
    return this.membersService.removeMember(userId, projectId, memberId);
  }
}

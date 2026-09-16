import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AddMemberDto } from './dto/add-member.dto.js';
import type { MemberListItem, SearchResultItem } from './members.types.js';

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    userId: string,
    projectId: string,
  ): Promise<{ members: MemberListItem[] }> {
    // メンバーシップと管理者権限を確認
    await this.requireAdminMembership(userId, projectId);

    // プロジェクトの全メンバーを取得
    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      members: members.map((m) => ({
        id: m.id,
        userId: m.user.id,
        displayName: m.user.displayName,
        email: m.user.email,
        role: m.role,
        isMe: m.userId === userId,
      })),
    };
  }

  async search(
    userId: string,
    projectId: string,
    query: string,
  ): Promise<{ results: SearchResultItem[] }> {
    // メンバーシップと管理者権限を確認
    await this.requireAdminMembership(userId, projectId);

    // 検索語が空の場合は空配列を返す
    if (!query || query.trim() === '') {
      return { results: [] };
    }

    const trimmedQuery = query.trim();

    // ユーザーを検索（displayNameまたはemailで部分一致）
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { displayName: { contains: trimmedQuery, mode: 'insensitive' } },
          { email: { contains: trimmedQuery, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        displayName: true,
        email: true,
      },
      take: 20,
    });

    // このプロジェクトに参加済みのユーザーIDを取得
    const existingMembers = await this.prisma.projectMember.findMany({
      where: { projectId },
      select: { userId: true },
    });
    const joinedUserIds = new Set(existingMembers.map((m) => m.userId));

    return {
      results: users.map((u) => ({
        userId: u.id,
        displayName: u.displayName,
        email: u.email,
        alreadyJoined: joinedUserIds.has(u.id),
      })),
    };
  }

  async addMember(
    userId: string,
    projectId: string,
    dto: AddMemberDto,
  ): Promise<MemberListItem> {
    // メンバーシップと管理者権限を確認
    await this.requireAdminMembership(userId, projectId);

    // 追加対象のユーザーが存在するか確認
    const targetUser = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true, displayName: true, email: true },
    });

    if (!targetUser) {
      throw new NotFoundException(
        '指定されたプロジェクトまたはユーザーが見つかりません。',
      );
    }

    // すでに参加済みかチェック
    const existingMember = await this.prisma.projectMember.findUnique({
      where: {
        userId_projectId: {
          userId: dto.userId,
          projectId,
        },
      },
    });

    if (existingMember) {
      throw new BadRequestException(
        '指定されたユーザーはすでにこのプロジェクトに参加しています。',
      );
    }

    // メンバーを追加（ロールは常にtester）
    const newMember = await this.prisma.projectMember.create({
      data: {
        userId: dto.userId,
        projectId,
        role: 'tester',
      },
    });

    return {
      id: newMember.id,
      userId: targetUser.id,
      displayName: targetUser.displayName,
      email: targetUser.email,
      role: 'tester',
      isMe: false,
    };
  }

  /**
   * メンバーシップを確認し、管理者でなければエラーを投げる
   */
  private async requireAdminMembership(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const membership = await this.prisma.projectMember.findUnique({
      where: {
        userId_projectId: {
          userId,
          projectId,
        },
      },
      select: { role: true },
    });

    if (!membership) {
      throw new NotFoundException('指定されたプロジェクトが見つかりません。');
    }

    if (membership.role !== 'admin') {
      throw new ForbiddenException('この操作を行う権限がありません。');
    }
  }
}

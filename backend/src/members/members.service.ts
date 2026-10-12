import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import type { ProjectRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { nextDisplayOrder } from '../projects/display-order.js';
import { AddMemberDto } from './dto/add-member.dto.js';
import { ChangeRoleDto } from './dto/change-role.dto.js';
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
    await this.requireProjectActive(projectId);

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

    // メンバーを追加（ロールは常にtester）。
    // 追加された人のタブでは、その人の進行中プロジェクトの末尾に出す（プロジェクト作成時と同じ扱い）
    const newMember = await this.prisma.projectMember.create({
      data: {
        userId: dto.userId,
        projectId,
        role: 'tester',
        displayOrder: await nextDisplayOrder(this.prisma, dto.userId),
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

  async changeRole(
    userId: string,
    projectId: string,
    memberId: string,
    dto: ChangeRoleDto,
  ): Promise<MemberListItem> {
    // メンバーシップと管理者権限を確認
    await this.requireAdminMembership(userId, projectId);
    await this.requireProjectActive(projectId);

    // 対象メンバーを取得
    const targetMember = await this.prisma.projectMember.findUnique({
      where: { id: memberId },
      include: {
        user: {
          select: { id: true, displayName: true, email: true },
        },
      },
    });

    if (!targetMember || targetMember.projectId !== projectId) {
      throw new NotFoundException(
        '指定されたプロジェクトまたはユーザーが見つかりません。',
      );
    }

    // 自分自身のロールは変更できない
    if (targetMember.userId === userId) {
      throw new BadRequestException('管理者自身のロールは変更できません。');
    }

    // 変更後に管理者が0人になるかチェック
    if (targetMember.role === 'admin' && dto.role !== 'admin') {
      await this.checkCanRemoveAdmin(projectId, targetMember.userId);
    }

    // ロールを更新
    const updatedMember = await this.prisma.projectMember.update({
      where: { id: memberId },
      data: { role: dto.role as ProjectRole },
    });

    return {
      id: updatedMember.id,
      userId: targetMember.user.id,
      displayName: targetMember.user.displayName,
      email: targetMember.user.email,
      role: updatedMember.role,
      isMe: false,
    };
  }

  async removeMember(
    userId: string,
    projectId: string,
    memberId: string,
  ): Promise<{ message: string }> {
    // メンバーシップと管理者権限を確認
    await this.requireAdminMembership(userId, projectId);
    await this.requireProjectActive(projectId);

    // 対象メンバーを取得
    const targetMember = await this.prisma.projectMember.findUnique({
      where: { id: memberId },
      select: { userId: true, projectId: true, role: true },
    });

    if (!targetMember || targetMember.projectId !== projectId) {
      throw new NotFoundException(
        '指定されたプロジェクトまたはユーザーが見つかりません。',
      );
    }

    // 自分自身は削除できない
    if (targetMember.userId === userId) {
      throw new BadRequestException(
        '自分自身を削除することはできません。離脱を利用してください。',
      );
    }

    // 削除後に管理者が0人になるかチェック
    if (targetMember.role === 'admin') {
      await this.checkCanRemoveAdmin(projectId, targetMember.userId);
    }

    // メンバーを削除
    await this.prisma.projectMember.delete({
      where: { id: memberId },
    });

    return { message: 'メンバーを削除しました。' };
  }

  async leave(
    userId: string,
    projectId: string,
  ): Promise<{ message: string }> {
    // メンバーシップと管理者権限を確認
    const membership = await this.requireAdminMembership(userId, projectId);
    await this.requireProjectActive(projectId);

    // 離脱後に管理者が0人になるかチェック
    if (membership.role === 'admin') {
      await this.checkCanRemoveAdmin(projectId, userId);
    }

    // 自分自身を削除
    await this.prisma.projectMember.delete({
      where: {
        userId_projectId: {
          userId,
          projectId,
        },
      },
    });

    return { message: 'プロジェクトから離脱しました。' };
  }

  /**
   * メンバーシップを確認し、管理者でなければエラーを投げる
   */
  private async requireAdminMembership(
    userId: string,
    projectId: string,
  ): Promise<{ role: string }> {
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

    return membership;
  }

  /**
   * 指定ユーザーを除外した場合に管理者が0人になるかチェック
   */
  private async checkCanRemoveAdmin(
    projectId: string,
    excludeUserId: string,
  ): Promise<void> {
    const adminCount = await this.prisma.projectMember.count({
      where: {
        projectId,
        role: 'admin',
        userId: { not: excludeUserId },
      },
    });

    if (adminCount === 0) {
      throw new BadRequestException(
        'プロジェクトには管理者が1名以上必要です。',
      );
    }
  }

  /**
   * 終了済みプロジェクトなら403を投げる（書き込み系メソッドでのみ呼ぶ）
   */
  private async requireProjectActive(projectId: string): Promise<void> {
    // 参加確認（404）より後に呼ぶ。先に判定すると、未参加者にも終了済みかどうかが伝わってしまうため
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { status: true },
    });
    if (project?.status === 'archived') {
      throw new ForbiddenException(
        '終了済みのプロジェクトのため、この操作を行うことができません。',
      );
    }
  }
}

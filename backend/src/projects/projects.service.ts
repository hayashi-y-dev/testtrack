import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { UpdateOrderDto } from './dto/update-order.dto.js';
import type {
  ProjectListItem,
  ProjectDetail,
  ArchivedProject,
  OrderItem,
} from './projects.types.js';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string): Promise<{ projects: ProjectListItem[] }> {
    const memberships = await this.prisma.projectMember.findMany({
      where: { userId },
      include: {
        project: true,
      },
      orderBy: [
        { displayOrder: { sort: 'asc', nulls: 'last' } },
        { project: { createdAt: 'desc' } },
      ],
    });

    const projects: ProjectListItem[] = memberships.map((m) => ({
      id: m.project.id,
      name: m.project.name,
      status: m.project.status,
      myRole: m.role,
      order: m.displayOrder,
    }));

    return { projects };
  }

  async create(
    userId: string,
    dto: CreateProjectDto,
  ): Promise<ProjectListItem> {
    // 既存の進行中プロジェクトのorder最大値を取得
    const maxOrderResult = await this.prisma.projectMember.aggregate({
      where: {
        userId,
        project: { status: 'active' },
        displayOrder: { not: null },
      },
      _max: { displayOrder: true },
    });

    const newOrder = (maxOrderResult._max.displayOrder ?? -1) + 1;

    // プロジェクトとメンバーシップを同時作成
    const project = await this.prisma.project.create({
      data: {
        name: dto.name,
        status: 'active',
        members: {
          create: {
            userId,
            role: 'admin',
            displayOrder: newOrder,
          },
        },
      },
    });

    return {
      id: project.id,
      name: project.name,
      status: project.status,
      myRole: 'admin',
      order: newOrder,
    };
  }

  async findOne(userId: string, projectId: string): Promise<ProjectDetail> {
    // プロジェクトと自分のメンバーシップを同時に取得
    const membership = await this.prisma.projectMember.findUnique({
      where: {
        userId_projectId: {
          userId,
          projectId,
        },
      },
      include: {
        project: true,
      },
    });

    // 存在しない or 参加していない場合は区別せず404
    if (!membership) {
      throw new NotFoundException('指定されたプロジェクトが見つかりません。');
    }

    // 進捗サマリーを集計
    const aggregation = await this.prisma.testFile.aggregate({
      where: { projectId },
      _count: { id: true },
      _sum: {
        targetCount: true,
        okCount: true,
        ngCount: true,
        notRunCount: true,
      },
    });

    const fileCount = aggregation._count.id;
    const targetCount = aggregation._sum.targetCount ?? 0;
    const okCount = aggregation._sum.okCount ?? 0;
    const ngCount = aggregation._sum.ngCount ?? 0;
    const notRunCount = aggregation._sum.notRunCount ?? 0;
    const completedCount = okCount + ngCount;

    // targetCountが0の場合はゼロ除算を避けてnull
    const progressRate =
      targetCount > 0
        ? Math.round((completedCount / targetCount) * 1000) / 10
        : null;

    return {
      id: membership.project.id,
      name: membership.project.name,
      status: membership.project.status,
      myRole: membership.role,
      createdAt: membership.project.createdAt,
      progressSummary: {
        fileCount,
        targetCount,
        completedCount,
        progressRate,
        okCount,
        ngCount,
        notRunCount,
      },
    };
  }

  async update(
    userId: string,
    projectId: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectListItem> {
    // メンバーシップと管理者権限を確認
    const membership = await this.getMembershipOrThrow(userId, projectId);
    this.requireAdmin(membership.role);
    this.requireProjectActive(membership.project.status);

    // プロジェクト名を更新
    const updatedProject = await this.prisma.project.update({
      where: { id: projectId },
      data: { name: dto.name },
    });

    return {
      id: updatedProject.id,
      name: updatedProject.name,
      status: updatedProject.status,
      myRole: membership.role,
      order: membership.displayOrder,
    };
  }

  async archive(userId: string, projectId: string): Promise<ArchivedProject> {
    // メンバーシップと管理者権限を確認
    const membership = await this.getMembershipOrThrow(userId, projectId);
    this.requireAdmin(membership.role);

    // すでにアーカイブ済みかチェック
    if (membership.project.status === 'archived') {
      throw new BadRequestException(
        'このプロジェクトはすでに終了しています。',
      );
    }

    // ステータスを更新
    const updatedProject = await this.prisma.project.update({
      where: { id: projectId },
      data: { status: 'archived' },
    });

    return {
      id: updatedProject.id,
      name: updatedProject.name,
      status: updatedProject.status,
    };
  }

  async updateOrder(
    userId: string,
    dto: UpdateOrderDto,
  ): Promise<{ orders: OrderItem[] }> {
    // ユーザーが参加している進行中プロジェクトのIDを取得
    const memberships = await this.prisma.projectMember.findMany({
      where: {
        userId,
        project: { status: 'active' },
      },
      select: { projectId: true },
    });

    const activeProjectIds = new Set(memberships.map((m) => m.projectId));

    // リクエストに含まれるすべてのprojectIdが参加プロジェクトに含まれるか確認
    for (const item of dto.orders) {
      if (!activeProjectIds.has(item.projectId)) {
        throw new BadRequestException(
          '指定されたプロジェクトに、参加していないものが含まれています。',
        );
      }
    }

    // 並び順を一括更新
    await this.prisma.$transaction(
      dto.orders.map((item) =>
        this.prisma.projectMember.update({
          where: {
            userId_projectId: {
              userId,
              projectId: item.projectId,
            },
          },
          data: { displayOrder: item.order },
        }),
      ),
    );

    return { orders: dto.orders };
  }

  /**
   * メンバーシップを取得し、存在しなければ404を投げる
   */
  private async getMembershipOrThrow(
    userId: string,
    projectId: string,
  ): Promise<{
    role: string;
    displayOrder: number | null;
    project: { status: string };
  }> {
    const membership = await this.prisma.projectMember.findUnique({
      where: {
        userId_projectId: {
          userId,
          projectId,
        },
      },
      select: {
        role: true,
        displayOrder: true,
        project: {
          select: { status: true },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('指定されたプロジェクトが見つかりません。');
    }

    return membership;
  }

  /**
   * 管理者でなければ403を投げる
   */
  private requireAdmin(role: string): void {
    if (role !== 'admin') {
      throw new ForbiddenException('この操作を行う権限がありません。');
    }
  }

  /**
   * 終了済みプロジェクトなら403を投げる（書き込み系メソッドでのみ呼ぶ）
   */
  private requireProjectActive(status: string): void {
    // getMembershipOrThrowで取得済みのstatusを使い、追加のクエリを発行しない
    if (status === 'archived') {
      throw new ForbiddenException(
        '終了済みのプロジェクトのため、この操作を行うことができません。',
      );
    }
  }
}

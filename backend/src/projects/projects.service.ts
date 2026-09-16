import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';

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
    // 空白のみのチェック（trimはDTO側で実行済み）
    if (dto.name.length === 0) {
      throw new NotFoundException('プロジェクト名は必須です。');
    }

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
}

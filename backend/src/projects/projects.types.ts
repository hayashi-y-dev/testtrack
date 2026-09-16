export interface ProjectListItem {
  id: string;
  name: string;
  status: string;
  myRole: string;
  order: number | null;
}

export interface ProjectDetail {
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

export interface ArchivedProject {
  id: string;
  name: string;
  status: string;
}

export interface OrderItem {
  projectId: string;
  order: number;
}

export type TestFileStatus = 'hasIncomplete' | 'allComplete' | 'notApplicable';

export interface TestFileListItem {
  id: string;
  fileName: string;
  progressRate: number | null;
  status: TestFileStatus;
  updatedAt: Date;
  lastUpdatedBy: string;
}

export type TestFileStatus = 'hasIncomplete' | 'allComplete' | 'notApplicable';

export interface TestFileListItem {
  id: string;
  fileName: string;
  progressRate: number | null;
  status: TestFileStatus;
  updatedAt: Date;
  lastUpdatedBy: string;
}

// 4-2 Preview用の型定義
export interface ParsedData {
  targetCount: number;
  okCount: number;
  ngCount: number;
  notRunCount: number;
  excludedCount: number;
}

export type PreviewOperation = 'create' | 'update' | 'error';

export interface PreviewFileResult {
  fileName: string;
  operation: PreviewOperation;
  existingFileId?: string;
  baseVersion?: number;
  currentProgressRate?: number | null;
  newProgressRate?: number | null;
  parsedData?: ParsedData;
  errorMessage?: string;
}

export interface PreviewResponse {
  files: PreviewFileResult[];
  summary: {
    totalCount: number;
    errorCount: number;
    successCount: number;
  };
}

// 4-3 Commit用の型定義
export type CommitResult = 'success' | 'error';

export interface CommitFileResult {
  fileName: string;
  result: CommitResult;
  operation?: 'create' | 'update';
  fileId?: string;
  errorMessage?: string;
}

export interface CommitResponse {
  files: CommitFileResult[];
  summary: {
    totalCount: number;
    successCount: number;
    errorCount: number;
  };
}

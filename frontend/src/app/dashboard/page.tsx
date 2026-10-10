'use client';

import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiDelete, apiGet, apiPatch, apiPost, apiPostForm, NETWORK_ERROR_MESSAGE } from '@/lib/api';
import Toast from '@/components/Toast';
import styles from './dashboard.module.css';

/**
 * ダッシュボード
 * 仕様書セクション2-1, 2-2, 2-4, 3-3, 3-5に基づく実装
 * - プロジェクトごとにロールが異なる
 * - ロールに応じてUI要素の表示/非表示を切り替え
 * - プロジェクト切替時は最新のロールを再取得（2-4: ロールは他の管理者操作で変わりうる）
 */

type Role = '管理者' | 'テスター' | '閲覧者';
type ApiRole = 'admin' | 'tester' | 'viewer';

// APIのロールの値を、画面の表示名に変換する
const ROLE_LABELS: Record<ApiRole, Role> = {
  admin: '管理者',
  tester: 'テスター',
  viewer: '閲覧者',
};

// GET /auth/me のレスポンス（api-design.md 1-6。ログインの成功時と同じ形）
type CurrentUser = {
  id: string;
  email: string;
  displayName: string;
};

// GET /projects のレスポンス（api-design.md 2-1）
type ProjectListResponse = {
  projects: {
    id: string;
    name: string;
    status: 'active' | 'archived';
    myRole: ApiRole;
    order: number | null;
  }[];
};

// POST /projects のレスポンス（api-design.md 2-2。一覧APIの1件分と同じ形）
type CreateProjectResponse = ProjectListResponse['projects'][number];

type ProgressSummary = {
  fileCount: number;
  targetCount: number;
  completedCount: number;
  progressRate: number | null;
  okCount: number;
  ngCount: number;
  notRunCount: number;
};

// GET /projects/:id のレスポンス（api-design.md 2-3）
type ProjectDetailResponse = {
  id: string;
  name: string;
  status: 'active' | 'archived';
  myRole: ApiRole;
  createdAt: string;
  progressSummary: ProgressSummary;
};

// 進行中プロジェクトのタブ表示用（一覧APIの値。ロールは詳細を取得するまでのキャッシュ扱い）
type Project = {
  id: string;
  name: string;
  role: Role;
};

// プロジェクト詳細（切替時に取得する最新のロールと進捗サマリー。状態・作成日はプロジェクト設定の基本情報に使う）
type ProjectDetail = {
  id: string;
  name: string;
  status: 'active' | 'archived';
  createdAt: string;
  role: Role;
  progressSummary: ProgressSummary;
};

// GET /projects/:id/members のレスポンスの1件（api-design.md 3-1）
type Member = {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  role: ApiRole;
  isMe: boolean;
};

// GET /projects/:id/members/search のレスポンスの1件（api-design.md 3-2）
type SearchResultUser = {
  userId: string;
  displayName: string;
  email: string;
  alreadyJoined: boolean;
};

// PATCH /projects/:id のレスポンス（api-design.md 2-4。作成と同じ形）
type UpdateProjectResponse = ProjectListResponse['projects'][number];

type ArchivedProject = {
  id: string;
  name: string;
};

// 詳細を取得するまで（または取得失敗時）に使う、すべて0件の進捗サマリー
const EMPTY_SUMMARY: ProgressSummary = {
  fileCount: 0,
  targetCount: 0,
  completedCount: 0,
  progressRate: null,
  okCount: 0,
  ngCount: 0,
  notRunCount: 0,
};

const PROJECT_NOT_FOUND_MESSAGE = '指定されたプロジェクトが見つかりません。';
// メンバー検索で、入力が止まってから検索するまでの待ち時間（1文字ごとに通信しないため）
const MEMBER_SEARCH_DELAY_MS = 300;

// 権限のない画面を開こうとした場合の通知（仕様書4-8）
const NO_PERMISSION_PAGE_MESSAGE = 'このページを表示する権限がありません。';

// APIの日時（UTC）を、日本時間の「2026年3月15日」の形にする
const DATE_FORMAT_JST = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

// APIの日時（UTC）を、日本時間の「2026/03/15 09:05」の形にする（テストファイル一覧の最終更新）
const DATE_TIME_FORMAT_JST = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// テストファイル一覧の検索で、入力が止まってから取得するまでの待ち時間（メンバー検索と同じ）
const FILE_SEARCH_DELAY_MS = 300;

// 全件エラーのときの確認画面の要約（仕様書6-6）
const ALL_FILES_ERROR_MESSAGE = 'すべてのファイルがエラーのため読み込めません。';

// アップロードの上限（仕様書FILE-04）。1ファイル・件数はバックエンドと同じ値、合計はNext.jsの転送の既定値
const MAX_UPLOAD_FILES = 20;
const MAX_UPLOAD_FILE_SIZE = 5 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_SIZE = 10 * 1024 * 1024;

const formatMegabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

// 送る前に件数・サイズを確かめ、上限を超えていれば知らせる文言を返す（超えていなければ null）。
// 合計が10MBを超えると、転送が30秒待ったあとに失敗するため、送らずにすぐ知らせる
function validateUpload(files: File[], bodySize: number): string | null {
  if (files.length > MAX_UPLOAD_FILES) {
    return `一度に読み込めるファイルは${MAX_UPLOAD_FILES}件までです（${files.length}件選択されています）。`;
  }
  const tooLarge = files.filter(f => f.size > MAX_UPLOAD_FILE_SIZE);
  if (tooLarge.length > 0) {
    const names = tooLarge.slice(0, 3).map(f => `${f.name}（${formatMegabytes(f.size)}）`).join('、');
    const rest = tooLarge.length > 3 ? `ほか${tooLarge.length - 3}件` : '';
    return `1ファイルのサイズは5MBまでです。5MBを超えるファイル: ${names}${rest}`;
  }
  if (bodySize > MAX_UPLOAD_TOTAL_SIZE) {
    const total = files.reduce((sum, f) => sum + f.size, 0);
    return `一度に読み込める合計サイズは10MBまでです（選択したファイルの合計: ${formatMegabytes(total)}）。`;
  }
  return null;
}

// 4-2のレスポンス（200、または全件エラーの400）の本文か。400でも files があれば確認画面を出すために使う
function isPreviewResponse(body: unknown): body is PreviewResponse {
  return typeof body === 'object' && body !== null && 'files' in body && Array.isArray(body.files);
}

// 進捗率の表示。対象テストケース0件（null）は「—」（一覧と同じ）
function formatProgress(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? '—' : `${rate}%`;
}

// ファイル名の自然順（「テスト_2」→「テスト_10」。一覧APIの第2ソートと同じ比べ方）
function compareFileName(a: string, b: string): number {
  return a.localeCompare(b, 'ja', { numeric: true });
}

const PROJECT_NAME_MAX_LENGTH = 50;

// 詳細APIのレスポンスを、画面で使う形（ロールは表示名）にする
function toProjectDetail(data: ProjectDetailResponse): ProjectDetail {
  return {
    id: data.id,
    name: data.name,
    status: data.status,
    createdAt: data.createdAt,
    role: ROLE_LABELS[data.myRole],
    progressSummary: data.progressSummary,
  };
}

// 2つの並び（プロジェクトIDの配列）が同じ順序かどうか
function isSameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * プロジェクト名の入力チェック（仕様書2-2・9-1。APIの CreateProjectDto と同じ規則）
 * 前後の空白を除いた値を受け取り、問題があればエラー文言、なければ null を返す
 */
function validateProjectName(trimmed: string): string | null {
  if (trimmed === '') {
    return 'プロジェクト名を入力してください。';
  }
  // 絵文字など、JavaScriptでは2文字分と数えられる文字も1文字として数える（APIの数え方に合わせる）
  if (Array.from(trimmed).length > PROJECT_NAME_MAX_LENGTH) {
    return `プロジェクト名は${PROJECT_NAME_MAX_LENGTH}文字以内で入力してください。`;
  }
  if (/[\r\n]/.test(trimmed)) {
    return 'プロジェクト名に改行を含めることはできません。';
  }
  return null;
}

// GET /projects/:id/test-files のレスポンス（api-design.md 4-1）
type TestFile = {
  id: string;
  fileName: string;
  // 対象テストケース0件のファイルは null（status は notApplicable）
  progressRate: number | null;
  status: 'hasIncomplete' | 'allComplete' | 'notApplicable';
  updatedAt: string;
  lastUpdatedBy: string;
};

type TestFileListResponse = {
  files: TestFile[];
  // 絞り込み・検索後、表示件数で絞る前の件数
  totalCount: number;
};

// 一覧の絞り込み・ソート・表示件数（APIのクエリパラメータの値そのもの。api-design.md 4-1）
type FileStatusFilter = 'all' | 'hasIncomplete' | 'allComplete';
type FileSortKey = 'name' | 'progress' | 'updatedAt';
type FileDisplayLimit = 5 | 10 | 'all';

// POST /projects/:id/test-files/preview のレスポンスの1件（api-design.md 4-2）。
// parsedData・baseVersion・existingFileId は、実行（4-3）でそのまま送り返す
type PreviewFile = {
  fileName: string;
  operation: 'create' | 'update' | 'error';
  existingFileId?: string;
  baseVersion?: number;
  currentProgressRate?: number | null;
  newProgressRate?: number | null;
  updatedAt?: string;
  lastUpdatedBy?: string;
  parsedData?: {
    targetCount: number;
    okCount: number;
    ngCount: number;
    notRunCount: number;
    excludedCount: number;
  };
  errorMessage?: string;
};

type PreviewResponse = {
  files: PreviewFile[];
  summary: { totalCount: number; errorCount: number; successCount: number };
};

// POST /projects/:id/test-files/commit のレスポンス（api-design.md 4-3）。
// 楽観ロックの競合も、ほかのエラーと同じ result: 'error' で、errorMessage だけが競合用になる（仕様書8-1）
type CommitFileResult = {
  fileName: string;
  result: 'success' | 'error';
  operation?: 'create' | 'update';
  fileId?: string;
  errorMessage?: string;
};

type CommitResponse = {
  files: CommitFileResult[];
  summary: { totalCount: number; successCount: number; errorCount: number };
};

export default function DashboardPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<ArchivedProject[]>([]);
  // 一覧の取得状態。「再読み込み」や404のときは listAttempt を増やして取り直す
  const [listStatus, setListStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [listAttempt, setListAttempt] = useState(0);
  // 一覧の最初の取得が終わったか。終わるまでは、ヘッダー・タブなどの骨格を出さない
  // （未ログイン・セッション切れのとき、ログイン画面へ移る前に骨格が一瞬見えないようにするため）
  const [hasFinishedFirstList, setHasFinishedFirstList] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState('');
  // 詳細の取得結果。どのプロジェクトの何回目の取得かを持ち、表示中の対象と一致しない間を「読み込み中」とする
  // （detail が null は取得失敗）
  const [detailResult, setDetailResult] = useState<{
    projectId: string;
    attempt: number;
    detail: ProjectDetail | null;
  } | null>(null);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [activeNav, setActiveNav] = useState<'dashboard' | 'settings'>('dashboard');
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // id は、同じ文言を続けて通知したときにもトーストを作り直して表示時間をやり直すために使う
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  // ヘッダーに表示するログイン中のユーザー。取得できるまで（取得失敗時も）は null で、名前を空にする
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  // テストファイル一覧の検索・絞り込み・ソート・表示件数。初期値はAPIの既定値と同じ（api-design.md 4-1）
  const [searchQuery, setSearchQuery] = useState('');
  // 実際に検索に使う語。入力が止まってから searchQuery を（前後の空白を除いて）反映する
  const [debouncedFileSearchTerm, setDebouncedFileSearchTerm] = useState('');
  const [filterSegment, setFilterSegment] = useState<FileStatusFilter>('all');
  const [fileSort, setFileSort] = useState<{ key: FileSortKey; order: 'asc' | 'desc' }>({
    key: 'progress',
    order: 'asc',
  });
  const [displayLimit, setDisplayLimit] = useState<FileDisplayLimit>(5);
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const sortBoxWrapRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // タブ並び順の保存（api-design.md 2-6）で使う値。画面の描画には使わないため、stateではなくrefで持つ
  // - dragStartOrderRef: ドラッグを始めた時点の並び（変わっていなければ保存しないための比較用）
  // - savedOrderRef: サーバーに保存済みと分かっている並び（保存に失敗したときの戻し先）
  // - pendingOrderRef: 保存待ちの最新の並び（通信中に並び替えられた分を、終わってから送る）
  // - isSavingOrderRef: 保存の通信中かどうか（通信中に呼ばれたら、送らずに保存待ちへ回すため）
  const dragStartOrderRef = useRef<string[] | null>(null);
  const savedOrderRef = useRef<string[]>([]);
  const pendingOrderRef = useRef<string[] | null>(null);
  const isSavingOrderRef = useRef(false);
  // テストファイル一覧の取得結果。どの条件（プロジェクト・検索・絞り込み・ソート・表示件数）の
  // 何回目の取得かを key に持ち、今の条件と一致しない間を「読み込み中」とする（data が null は取得失敗）
  const [filesResult, setFilesResult] = useState<{
    key: string;
    data: TestFileListResponse | null;
  } | null>(null);
  const [filesAttempt, setFilesAttempt] = useState(0);

  // 終了済みプロジェクト関連
  const [viewingArchivedProject, setViewingArchivedProject] = useState<ArchivedProject | null>(null);
  const [isArchivedMenuOpen, setIsArchivedMenuOpen] = useState(false);
  // 終了済みメニューの表示位置。描画中にrefを読まないよう、開くときにボタンの位置から計算して持つ
  const [archivedMenuPosition, setArchivedMenuPosition] = useState({ top: 0, right: 0 });
  const archivedMenuRef = useRef<HTMLDivElement>(null);
  const archivedFilterRef = useRef<HTMLDivElement>(null);

  // プロジェクト設定
  // メンバー一覧の取得結果。詳細と同じく、どのプロジェクトの何回目の取得かを持ち、
  // 表示中の対象と一致しない間を「読み込み中」とする（members が null は取得失敗）
  const [membersResult, setMembersResult] = useState<{
    projectId: string;
    attempt: number;
    members: Member[] | null;
  } | null>(null);
  const [membersAttempt, setMembersAttempt] = useState(0);
  // 編集中のプロジェクト名（null は編集していない）。表示している設定のプロジェクトが変わったら閉じる（下の settingsProjectId 参照）
  const [editingName, setEditingName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [isSavingName, setIsSavingName] = useState(false);

  // モーダル
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectNameError, setNewProjectNameError] = useState<string | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  // メンバー検索の結果。どの検索語の結果かを持ち、今の入力と一致しない間を「検索中」とする（results が null は検索失敗）
  const [memberSearchResult, setMemberSearchResult] = useState<{
    query: string;
    results: SearchResultUser[] | null;
  } | null>(null);
  // 追加の通信中のユーザー（その行の「追加」を押せなくする）
  const [addingUserIds, setAddingUserIds] = useState<string[]>([]);
  // メンバー一覧で選んだが、まだ保存していないロール（メンバーID → ロール）。「保存」で確定する（仕様書4-6）
  const [roleEdits, setRoleEdits] = useState<Record<string, ApiRole>>({});
  // ロール変更の通信中のメンバー（その行のプルダウンと「保存」を押せなくする）
  const [savingRoleMemberIds, setSavingRoleMemberIds] = useState<string[]>([]);
  // 削除の確認モーダルの対象（null は閉じている）
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [isRemovingMember, setIsRemovingMember] = useState(false);
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isTerminateModalOpen, setIsTerminateModalOpen] = useState(false);
  const [isArchivingProject, setIsArchivingProject] = useState(false);

  // 行メニュー（登録取消用）
  const [rowMenuFile, setRowMenuFile] = useState<TestFile | null>(null);
  // buttonTop は「︙」ボタンの上端。下に余白がなく、ボタンの上側に開き直すときに使う
  const [rowMenuPosition, setRowMenuPosition] = useState({ top: 0, left: 0, buttonTop: 0 });
  const rowMenuRef = useRef<HTMLDivElement>(null);
  const [cancelConfirmFile, setCancelConfirmFile] = useState<TestFile | null>(null);
  const [cancelBlockedFile, setCancelBlockedFile] = useState<TestFile | null>(null);
  const [isUnregistering, setIsUnregistering] = useState(false);

  // ファイル読込モーダル
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadView, setUploadView] = useState<'select' | 'confirm' | 'result'>('select');
  // 確認画面に出す解析結果（ファイル名の自然順）。全件エラーの400では、ファイル名だけのエラー行になる
  const [previewFiles, setPreviewFiles] = useState<PreviewFile[]>([]);
  const [isPreviewing, setIsPreviewing] = useState(false);
  // 結果画面に出す実行結果（ファイル名の自然順）
  const [uploadResults, setUploadResults] = useState<CommitFileResult[]>([]);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 列幅リサイズ機能
  const [columnWidths, setColumnWidths] = useState([36, 20, 16, 16, 6]);
  const resizingRef = useRef<{ index: number; startX: number; startWidths: number[] } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  // タブ表示用のプロジェクト情報（一覧APIから取得したキャッシュ）
  const activeProjectFromList = projects.find(p => p.id === activeProjectId);

  // 一覧を進行中（タブ。orderの順）と終了済みに分けて反映し、先頭の進行中プロジェクトを選ぶ
  const applyProjectList = useCallback((data: ProjectListResponse) => {
    const active = data.projects
      .filter(p => p.status === 'active')
      .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
      .map(p => ({ id: p.id, name: p.name, role: ROLE_LABELS[p.myRole] }));
    const archived = data.projects
      .filter(p => p.status === 'archived')
      .map(p => ({ id: p.id, name: p.name }));

    setProjects(active);
    savedOrderRef.current = active.map(p => p.id);
    setArchivedProjects(archived);
    setViewingArchivedProject(null);
    setActiveProjectId(active[0]?.id ?? '');
    setListStatus('loaded');
    setHasFinishedFirstList(true);
  }, []);

  // 画面を開いたとき（と再読み込み・404のとき）に、所属プロジェクトの一覧を取得する
  useEffect(() => {
    // 取得が重なった場合（開発時のStrict Modeでの二重実行など）に、古い結果で上書きしないようにする
    let ignore = false;

    apiGet<ProjectListResponse>('/projects').then((result) => {
      if (ignore) {
        return;
      }
      if (result.ok) {
        applyProjectList(result.data);
      } else if (result.status === 401) {
        router.replace('/login');
      } else {
        setListStatus('failed');
        setHasFinishedFirstList(true);
      }
    });

    return () => {
      ignore = true;
    };
  }, [listAttempt, router, applyProjectList]);

  // 画面を開いたときに、ヘッダーに出すログイン中のユーザーを取得する（api-design.md 1-6）。
  // 一覧の取得とは待ち合わせず、並行して取る。互いの結果を使わず、失敗したときの扱いも違う
  // （一覧は取得失敗の表示を出すが、ユーザー名は空のままにするだけ）ため
  useEffect(() => {
    let ignore = false;

    apiGet<CurrentUser>('/auth/me').then((result) => {
      if (ignore) {
        return;
      }
      if (result.ok) {
        setCurrentUser(result.data);
      } else if (result.status === 401) {
        router.replace('/login');
      }
      // そのほかの失敗では何もしない（名前は空のまま。ほかの表示は止めない）
    });

    return () => {
      ignore = true;
    };
  }, [router]);

  // 詳細を表示する対象。終了済みを閲覧中はそのプロジェクト、それ以外は選択中のタブ
  const detailTargetId = viewingArchivedProject?.id ?? activeProjectId;

  // 一覧を取り直して先頭の進行中プロジェクトへ移り、渡された文言（先頭の1件）をトーストで一時的に通知する。
  // 表示中のプロジェクトを表示し続けられない、またはサーバーの実際の状態に合わせ直したいときに使う。
  // - 404：プロジェクトから外された・なくなった場合（仕様書4-8「権限のない画面へアクセスした場合」に準じる）
  // - タブ並び順の保存の400：参加していない（終了した・外された）プロジェクトが含まれていた場合
  // - 離脱の成功：離脱したプロジェクトは表示できなくなるため（仕様書4-6）
  // 文言が空のときは、プロジェクトが見つからない旨を出す（主な使い道が404のため）
  const reloadProjectListWithNotice = useCallback((messages: string[]) => {
    setToast({ id: Date.now(), message: messages[0] ?? PROJECT_NOT_FOUND_MESSAGE });
    // 取り直した一覧の先頭が、以前に表示していたプロジェクトでも、古い取得結果を使わず読み込み直す
    setDetailResult(null);
    setFilesResult(null);
    setListStatus('loading');
    setListAttempt(attempt => attempt + 1);
  }, []);

  // プロジェクト切替時に、最新のロールと進捗サマリーを取得する（仕様書2-4）
  useEffect(() => {
    if (!detailTargetId) {
      return;
    }
    let ignore = false;

    apiGet<ProjectDetailResponse>(`/projects/${detailTargetId}`).then((result) => {
      if (ignore) {
        return;
      }
      if (result.ok) {
        setDetailResult({
          projectId: detailTargetId,
          attempt: detailAttempt,
          detail: toProjectDetail(result.data),
        });
      } else if (result.status === 401) {
        router.replace('/login');
      } else if (result.status === 404) {
        reloadProjectListWithNotice(result.messages);
      } else {
        setDetailResult({ projectId: detailTargetId, attempt: detailAttempt, detail: null });
      }
    });

    return () => {
      ignore = true;
    };
  }, [detailTargetId, detailAttempt, router, reloadProjectListWithNotice]);

  // 表示中の対象についての取得結果だけを使う。対象を切り替えた直後や再読み込み中は「読み込み中」になる
  const currentDetailResult =
    detailResult?.projectId === detailTargetId && detailResult.attempt === detailAttempt
      ? detailResult
      : null;
  const isLoadingProject = detailTargetId !== '' && currentDetailResult === null;
  const fetchError = currentDetailResult !== null && currentDetailResult.detail === null;
  const activeProjectDetail = currentDetailResult?.detail ?? null;

  // 一覧の取得中・取得失敗も、詳細と同じ「読み込み中」「取得失敗」の表示を使う
  const showLoading = listStatus === 'loading' || (listStatus === 'loaded' && isLoadingProject);
  const showFetchError = listStatus === 'failed' || (listStatus === 'loaded' && fetchError);

  // 再読み込み処理（一覧の取得に失敗していれば一覧から、そうでなければ詳細を取り直す）
  const handleRetry = () => {
    if (listStatus === 'failed') {
      setListStatus('loading');
      setListAttempt(attempt => attempt + 1);
    } else {
      setDetailAttempt(attempt => attempt + 1);
    }
  };

  // ロール判定は詳細APIから取得した最新ロールを使用
  // 詳細取得中は一覧のキャッシュをフォールバックとして使用
  const currentRole = activeProjectDetail?.role || activeProjectFromList?.role || '閲覧者';
  const activeProject = activeProjectDetail || activeProjectFromList;
  const summary = activeProjectDetail?.progressSummary ?? EMPTY_SUMMARY;

  // 終了済みプロジェクト閲覧中かどうか
  const isViewingArchived = viewingArchivedProject !== null;

  // 表示するプロジェクトが変わったら、テストファイル一覧の検索・絞り込み・ソート・表示件数を初期状態に戻す。
  // タブのクリックに限らず、終了済みを開いたときや、404などで一覧を取り直して別のプロジェクトへ移ったときも戻す。
  // effectではなく描画中に前回の値と比べて更新する。描き直す前に条件がそろうので、前の条件での取得は走らず、
  // 取得は新しい条件での1回だけになる。実際に検索に使う語も同時に空にする（入力が止まるのを待つと、
  // その間に前の検索語で取得してしまうため）
  const [prevDetailTargetId, setPrevDetailTargetId] = useState(detailTargetId);
  if (detailTargetId !== prevDetailTargetId) {
    setPrevDetailTargetId(detailTargetId);
    setSearchQuery('');
    setDebouncedFileSearchTerm('');
    setFilterSegment('all');
    setFileSort({ key: 'progress', order: 'asc' });
    setDisplayLimit(5);
    // 表示件数のプルダウンも閉じる。タブのクリック以外（404で一覧を取り直したなど）で切り替わった場合も閉じるため
    setIsSortMenuOpen(false);
    // 登録取消のモーダルは、前のプロジェクトのファイルを指しているため閉じる
    setCancelConfirmFile(null);
    setCancelBlockedFile(null);
    // ファイル読込のモーダルも、前のプロジェクトへの読込になるため閉じる
    setIsUploadModalOpen(false);
    setUploadView('select');
    setPreviewFiles([]);
    setUploadResults([]);
  }

  // 表示中のプロジェクト。登録取消の結果が届いたとき、通信中に切り替わっていないかを確かめるために使う
  // （ボタンの処理の中からは、押した時点の値しか見えないため）
  const detailTargetIdRef = useRef(detailTargetId);
  useEffect(() => {
    detailTargetIdRef.current = detailTargetId;
  }, [detailTargetId]);

  // テストファイル一覧の検索語は、入力が止まってから反映する（1文字ごとに通信しないため。メンバー検索と同じ）
  const fileSearchTerm = searchQuery.trim();
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFileSearchTerm(fileSearchTerm), FILE_SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [fileSearchTerm]);

  // テストファイル一覧の取得先（api-design.md 4-1）。検索・絞り込み・ソート・表示件数はすべてクエリで渡し、
  // 画面側では並べ替えない（表示件数で絞った後に画面側で並べると、全体での順位とずれるため）。
  // 一覧の取得中（404などで取り直している間）は取得しない。取り直した先頭が同じプロジェクトでも、
  // 取得先がいったん空になるため、取り直しの後に必ず取得し直す
  const fileListParams = new URLSearchParams({
    status: filterSegment,
    sort: fileSort.key,
    order: fileSort.order,
    limit: String(displayLimit),
  });
  if (debouncedFileSearchTerm) {
    fileListParams.set('q', debouncedFileSearchTerm);
  }
  const filesPath = listStatus === 'loaded' && detailTargetId
    ? `/projects/${detailTargetId}/test-files?${fileListParams.toString()}`
    : '';
  const filesKey = `${filesPath}#${filesAttempt}`;

  // 条件が変わるたびに取り直す。古い条件の結果が後から届いても、捨てて新しい表示を上書きしない
  useEffect(() => {
    if (!filesPath) {
      return;
    }
    let ignore = false;

    apiGet<TestFileListResponse>(filesPath).then((result) => {
      if (ignore) {
        return;
      }
      if (result.ok) {
        setFilesResult({ key: filesKey, data: result.data });
      } else if (result.status === 401) {
        router.replace('/login');
      } else if (result.status === 404) {
        reloadProjectListWithNotice(result.messages);
      } else {
        setFilesResult({ key: filesKey, data: null });
      }
    });

    return () => {
      ignore = true;
    };
  }, [filesPath, filesKey, router, reloadProjectListWithNotice]);

  // 今の条件についての取得結果だけを使う（条件を変えた直後や再読み込み中は「読み込み中」になる）
  const currentFilesResult = filesResult?.key === filesKey ? filesResult : null;
  const isLoadingFiles = currentFilesResult === null;
  const filesFetchError = currentFilesResult !== null && currentFilesResult.data === null;
  const files = currentFilesResult?.data?.files ?? [];
  const filesTotalCount = currentFilesResult?.data?.totalCount ?? 0;
  // 検索・絞り込みで0件になったのか、そもそもファイルが無いのかを、空状態の文言で区別する（仕様書5-5）。
  // プロジェクトにファイルが1件も無いとき（詳細の fileCount が0）は、条件をかけていても「ファイルが無い」方を出す
  const hasFileConditions = debouncedFileSearchTerm !== '' || filterSegment !== 'all';
  const isFileListFilteredEmpty = hasFileConditions && summary.fileCount > 0;
  // 表示件数で絞られて、表示しきれていないファイルがあるか（「すべて表示」を出すかどうか）
  const hasMoreFiles = displayLimit !== 'all' && filesTotalCount > files.length;

  // 行メニュー（︙）は、一覧の中身が変わったら閉じる。
  // - 取得の条件が変わったとき（検索・絞り込み・ソート・表示件数・プロジェクトの切り替え・取り直し）
  // - メニューを開いた行が一覧から消えたとき（取得中・取得失敗で一覧が空になった場合も含む）
  // クリック以外のきっかけ（キーボードでの入力、404での一覧の取り直しなど）でも閉じるよう、
  // effectではなく描画中に比べて更新する（表示件数のプルダウンを閉じる処理と同じ書き方）
  const [prevFilesKey, setPrevFilesKey] = useState(filesKey);
  if (filesKey !== prevFilesKey) {
    setPrevFilesKey(filesKey);
    setRowMenuFile(null);
  }
  if (rowMenuFile && !files.some(f => f.id === rowMenuFile.id)) {
    setRowMenuFile(null);
  }

  // メニューはすべて、スクロールや画面サイズの変更で閉じる。行メニューと終了済みメニューは画面固定
  // （position: fixed）のためボタンから離れてしまい、ほかのメニューも閉じ方をそろえる。
  // 捕捉（第3引数 true）で、ページ全体に限らず画面内のすべてのスクロールを拾う
  useEffect(() => {
    if (!rowMenuFile && !isArchivedMenuOpen && !isUserMenuOpen && !isSortMenuOpen) {
      return;
    }
    const closeMenus = () => {
      setRowMenuFile(null);
      setIsArchivedMenuOpen(false);
      setIsUserMenuOpen(false);
      setIsSortMenuOpen(false);
    };
    window.addEventListener('scroll', closeMenus, true);
    window.addEventListener('resize', closeMenus);
    return () => {
      window.removeEventListener('scroll', closeMenus, true);
      window.removeEventListener('resize', closeMenus);
    };
  }, [rowMenuFile, isArchivedMenuOpen, isUserMenuOpen, isSortMenuOpen]);

  // 列見出しのクリックで、同じ列なら昇順⇔降順を切り替え、別の列なら昇順から始める（仕様書5-3）
  const handleFileSortClick = (key: FileSortKey) => {
    setFileSort(prev =>
      prev.key === key
        ? { key, order: prev.order === 'asc' ? 'desc' : 'asc' }
        : { key, order: 'asc' },
    );
  };

  // 列見出しの並び順の表示（並べ替えに使っている列だけ矢印を出す）
  const sortAriaFor = (key: FileSortKey) =>
    fileSort.key !== key ? undefined : fileSort.order === 'asc' ? 'ascending' : 'descending';
  const sortMarkFor = (key: FileSortKey) =>
    fileSort.key !== key ? '' : fileSort.order === 'asc' ? '▲' : '▼';

  // 終了済みメニューの外側クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        isArchivedMenuOpen &&
        archivedMenuRef.current &&
        archivedFilterRef.current &&
        !archivedMenuRef.current.contains(e.target as Node) &&
        !archivedFilterRef.current.contains(e.target as Node)
      ) {
        setIsArchivedMenuOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isArchivedMenuOpen]);

  // ヘッダーのユーザーメニュー（ログアウト）と、テストファイル一覧の表示件数のプルダウンも、
  // 終了済みメニューと同じく外側のクリックで閉じる。開閉のボタンとメニューは同じ要素の中にあるため、
  // その要素の外かどうかだけを見る
  useEffect(() => {
    if (!isUserMenuOpen) {
      return;
    }
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isUserMenuOpen]);

  useEffect(() => {
    if (!isSortMenuOpen) {
      return;
    }
    const handleClickOutside = (e: MouseEvent) => {
      if (sortBoxWrapRef.current && !sortBoxWrapRef.current.contains(e.target as Node)) {
        setIsSortMenuOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isSortMenuOpen]);

  // ロールに応じた権限（終了済みプロジェクト閲覧中は全て無効）
  const canManage = !isViewingArchived && currentRole === '管理者';
  const canEdit = !isViewingArchived && (currentRole === '管理者' || currentRole === 'テスター');

  // プロジェクト設定を表示している間、そのプロジェクトのメンバー一覧を取得する（api-design.md 3-1）
  const settingsProjectId = activeNav === 'settings' && canManage ? activeProjectId : '';
  useEffect(() => {
    if (!settingsProjectId) {
      return;
    }
    let ignore = false;

    apiGet<{ members: Member[] }>(`/projects/${settingsProjectId}/members`).then((result) => {
      if (ignore) {
        return;
      }
      if (result.ok) {
        setMembersResult({
          projectId: settingsProjectId,
          attempt: membersAttempt,
          members: result.data.members,
        });
      } else if (result.status === 401) {
        router.replace('/login');
      } else if (result.status === 403) {
        // 管理者でなくなっていた場合など。ダッシュボードへ戻して知らせ（仕様書4-8）、
        // 詳細を取り直して最新のロールに合わせる（管理者ナビも消える）
        setActiveNav('dashboard');
        setToast({ id: Date.now(), message: NO_PERMISSION_PAGE_MESSAGE });
        setDetailAttempt(attempt => attempt + 1);
      } else if (result.status === 404) {
        reloadProjectListWithNotice(result.messages);
      } else {
        setMembersResult({ projectId: settingsProjectId, attempt: membersAttempt, members: null });
      }
    });

    return () => {
      ignore = true;
    };
  }, [settingsProjectId, membersAttempt, router, reloadProjectListWithNotice]);

  // 表示中のプロジェクトについての取得結果だけを使う（詳細の currentDetailResult と同じ考え方）
  const currentMembersResult =
    membersResult?.projectId === settingsProjectId && membersResult.attempt === membersAttempt
      ? membersResult
      : null;
  const members = currentMembersResult?.members ?? null;
  const isLoadingMembers = currentMembersResult === null;
  const membersFetchError = currentMembersResult !== null && currentMembersResult.members === null;

  // 表示している設定のプロジェクトが変わったら（別のプロジェクトへ切り替えた、設定から離れた、403で外れたなど）、
  // 名前の編集とメンバー追加モーダルを閉じる。戻ったときに前の入力やエラー・検索結果が残っていないようにし、
  // 切替後に前の入力で保存・追加してしまうことも防ぐ。設定から外れたのにモーダルだけが残り、
  // 検索が「検索中…」のまま止まることもなくなる（検索は設定を表示している間だけ行うため）。
  // effectではなく描画中に前回の値と比べて更新する（ロールの変化でナビを戻す処理と同じ書き方）
  const [prevSettingsProjectId, setPrevSettingsProjectId] = useState(settingsProjectId);
  if (settingsProjectId !== prevSettingsProjectId) {
    setPrevSettingsProjectId(settingsProjectId);
    setEditingName(null);
    setNameError(null);
    setIsAddMemberModalOpen(false);
    setMemberSearchQuery('');
    setMemberSearchResult(null);
    setRemoveTarget(null);
    setIsLeaveModalOpen(false);
  }

  // メンバー一覧を取り直すとき（設定を開き直した、再読み込み、400などで取り直す）と、
  // 設定のプロジェクトが変わったときは、保存していないロールの選択を元に戻す
  // （取り直した一覧と食い違った選択が残らないようにするため）
  const membersKey = `${settingsProjectId}/${membersAttempt}`;
  const [prevMembersKey, setPrevMembersKey] = useState(membersKey);
  if (membersKey !== prevMembersKey) {
    setPrevMembersKey(membersKey);
    setRoleEdits({});
  }

  const closeNameEditor = () => {
    setEditingName(null);
    setNameError(null);
  };

  // プロジェクト名の変更（仕様書4-5・2-2、api-design.md 2-4）
  const handleSaveProjectName = async () => {
    if (isSavingName || editingName === null || !activeProject) {
      return;
    }
    const projectId = activeProject.id;
    // 名前が変わっていなければ、APIを呼ばずに閉じるだけにする（前後の空白はAPIでも除かれるため、除いて比べる）
    if (editingName.trim() === activeProject.name) {
      closeNameEditor();
      return;
    }

    setIsSavingName(true);
    const result = await apiPatch<UpdateProjectResponse>(`/projects/${projectId}`, {
      name: editingName,
    });

    if (result.ok) {
      const { name } = result.data;
      // タブ（一覧のキャッシュ）と、見出し・設定画面に使う詳細の両方を、再読み込みせずに新しい名前にする
      setProjects(prev => prev.map(p => (p.id === projectId ? { ...p, name } : p)));
      setDetailResult(prev =>
        prev?.detail?.id === projectId ? { ...prev, detail: { ...prev.detail, name } } : prev,
      );
      closeNameEditor();
      setIsSavingName(false);
      return;
    }
    if (result.status === 401) {
      // 遷移が終わるまで保存ボタンは無効のままにする
      router.replace('/login');
      return;
    }

    const message = result.messages[0];
    if (result.status === 400 && message) {
      // 入力の誤り。APIの文言を入力欄の下に出し、編集は閉じない。
      // 空のときは「必須」と「1文字以上」のように同じ原因で複数返ることがあるため、先頭の1件だけを出す
      setNameError(message);
    } else if (result.status === 404) {
      closeNameEditor();
      reloadProjectListWithNotice(result.messages);
    } else if (result.status === 403) {
      // 管理者でなくなっていた、または終了済みになっていた場合。詳細を取り直して最新のロールに合わせる
      // （管理者以外になればナビはダッシュボードに戻る。仕様書2-4）
      closeNameEditor();
      setToast({ id: Date.now(), message: message ?? 'この操作を行う権限がありません。' });
      setDetailAttempt(attempt => attempt + 1);
    } else {
      // 入力した名前は残し、そのまま保存し直せるようにする（仕様書4-8「一部操作の失敗は短いエラー通知」）
      setToast({
        id: Date.now(),
        message: result.status === 500 && message ? message : NETWORK_ERROR_MESSAGE,
      });
    }
    setIsSavingName(false);
  };

  // メンバー追加モーダルの検索（api-design.md 3-2）。前後の空白を除いた入力で検索し、空なら検索しない
  const memberSearchTerm = memberSearchQuery.trim();
  const memberSearchProjectId = isAddMemberModalOpen ? settingsProjectId : '';

  const closeAddMemberModal = () => {
    setIsAddMemberModalOpen(false);
    // 開き直したときに、空の検索欄・結果なしの状態から始めるため
    setMemberSearchQuery('');
    setMemberSearchResult(null);
  };

  // 入力が止まってから検索する。続けて入力したときは、前の待ち（と届いていない結果）を取り消すので、
  // 古い検索の結果が新しい検索の結果を上書きしない
  useEffect(() => {
    if (!memberSearchProjectId || !memberSearchTerm) {
      return;
    }
    let ignore = false;

    const timer = setTimeout(() => {
      apiGet<{ results: SearchResultUser[] }>(
        `/projects/${memberSearchProjectId}/members/search?q=${encodeURIComponent(memberSearchTerm)}`,
      ).then((result) => {
        if (ignore) {
          return;
        }
        if (result.ok) {
          setMemberSearchResult({ query: memberSearchTerm, results: result.data.results });
        } else if (result.status === 401) {
          router.replace('/login');
        } else if (result.status === 403) {
          // 管理者でなくなっていた場合など。追加の403と同じく、閉じて知らせ、詳細を取り直す。
          // （閉じる処理は closeAddMemberModal と同じ。effectの依存を増やさないよう、set関数を直接呼ぶ）
          setIsAddMemberModalOpen(false);
          setMemberSearchQuery('');
          setMemberSearchResult(null);
          setToast({ id: Date.now(), message: result.messages[0] ?? 'この操作を行う権限がありません。' });
          setDetailAttempt(attempt => attempt + 1);
        } else if (result.status === 404) {
          setIsAddMemberModalOpen(false);
          setMemberSearchQuery('');
          setMemberSearchResult(null);
          reloadProjectListWithNotice(result.messages);
        } else {
          setMemberSearchResult({ query: memberSearchTerm, results: null });
        }
      });
    }, MEMBER_SEARCH_DELAY_MS);

    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [memberSearchProjectId, memberSearchTerm, router, reloadProjectListWithNotice]);

  // 今の入力についての検索結果だけを使う（入力を変えた直後は「検索中」になる）
  const currentSearchResult =
    memberSearchResult?.query === memberSearchTerm ? memberSearchResult : null;

  // 検索結果の行を「参加済み」にする（追加に成功したとき、すでに参加済みだったとき）
  const markSearchResultJoined = (userId: string) => {
    setMemberSearchResult(prev =>
      prev?.results
        ? { ...prev, results: prev.results.map(u => (u.userId === userId ? { ...u, alreadyJoined: true } : u)) }
        : prev,
    );
  };

  // メンバー追加（仕様書4-6、api-design.md 3-3）。追加後もモーダルは開いたままにし、続けて追加できるようにする。
  // 追加するユーザーは、押されたボタンの value から読む。行ごとに () => handleAddMember(id) と包むと、
  // Reactのlint（react-hooks/purity）が中の Date.now() を描画中の呼び出しと誤って指摘するため、
  // ほかのボタンと同じく関数をそのまま onClick に渡す形にしている
  const handleAddMember = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const userId = e.currentTarget.value;
    if (addingUserIds.includes(userId) || !settingsProjectId) {
      return;
    }
    const projectId = settingsProjectId;

    setAddingUserIds(prev => [...prev, userId]);
    const result = await apiPost<Member>(`/projects/${projectId}/members`, { userId });
    setAddingUserIds(prev => prev.filter(id => id !== userId));

    if (result.ok) {
      markSearchResultJoined(userId);
      // モーダルの後ろにある設定画面のメンバー一覧（と参加メンバー数）にも、取り直さずに加える。
      // レスポンスは3-1の1件分と同じ形
      setMembersResult(prev =>
        prev?.projectId === projectId && prev.members
          ? { ...prev, members: [...prev.members, result.data] }
          : prev,
      );
      return;
    }
    if (result.status === 401) {
      router.replace('/login');
      return;
    }

    const message = result.messages[0];
    if (result.status === 400) {
      // すでに参加済み（別の管理者が先に追加した場合など）。行を参加済みにし、一覧も取り直して実際の状態に合わせる
      setToast({ id: Date.now(), message: message ?? 'このユーザーはすでに参加しています。' });
      markSearchResultJoined(userId);
      setMembersAttempt(attempt => attempt + 1);
    } else if (result.status === 403) {
      // 管理者でなくなっていた場合など。名前変更の403と同じく、詳細を取り直して最新のロールに合わせる
      closeAddMemberModal();
      setToast({ id: Date.now(), message: message ?? 'この操作を行う権限がありません。' });
      setDetailAttempt(attempt => attempt + 1);
    } else if (result.status === 404) {
      closeAddMemberModal();
      reloadProjectListWithNotice(result.messages);
    } else {
      // モーダルは開いたまま、入力と検索結果も残し、そのまま追加し直せるようにする
      setToast({
        id: Date.now(),
        message: result.status === 500 && message ? message : NETWORK_ERROR_MESSAGE,
      });
    }
  };

  // ロール変更（仕様書4-6、api-design.md 3-4）。プルダウンで選んだロールを、行の「保存」で確定する。
  // 対象のメンバーは、押されたボタンの value から読む（メンバー追加の「追加」ボタンと同じ理由）
  const handleSaveRole = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const memberId = e.currentTarget.value;
    const role = roleEdits[memberId];
    if (!role || savingRoleMemberIds.includes(memberId) || !settingsProjectId) {
      return;
    }
    const projectId = settingsProjectId;

    setSavingRoleMemberIds(prev => [...prev, memberId]);
    const result = await apiPatch<Member>(`/projects/${projectId}/members/${memberId}`, { role });
    setSavingRoleMemberIds(prev => prev.filter(id => id !== memberId));

    if (result.ok) {
      // 一覧は取り直さず、レスポンス（3-1の1件分と同じ形）でその行を置き換え、保存した選択を消す
      setMembersResult(prev =>
        prev?.projectId === projectId && prev.members
          ? { ...prev, members: prev.members.map(m => (m.id === memberId ? result.data : m)) }
          : prev,
      );
      setRoleEdits(prev => {
        const next = { ...prev };
        delete next[memberId];
        return next;
      });
      return;
    }
    if (result.status === 401) {
      router.replace('/login');
      return;
    }

    const message = result.messages[0];
    if (result.status === 400 || result.status === 404) {
      // 400（管理者が0人になる、自分自身の操作など）と404（対象のメンバーがすでに外されていた）は、
      // 別の管理者が先に操作した場合に起きうる。一覧を取り直して実際の状態に合わせる
      // （プロジェクト自体がなくなっていた場合は、取り直しの404で、プロジェクトが見つからない扱いになる）
      setToast({ id: Date.now(), message: message ?? NETWORK_ERROR_MESSAGE });
      setMembersAttempt(attempt => attempt + 1);
    } else if (result.status === 403) {
      // 管理者でなくなっていた場合など。名前変更・メンバー追加の403と同じく、詳細を取り直す
      setToast({ id: Date.now(), message: message ?? 'この操作を行う権限がありません。' });
      setDetailAttempt(attempt => attempt + 1);
    } else {
      // 選んだロールは残し、そのまま保存し直せるようにする
      setToast({
        id: Date.now(),
        message: result.status === 500 && message ? message : NETWORK_ERROR_MESSAGE,
      });
    }
  };

  // メンバー削除（仕様書4-6、api-design.md 3-5）。確認モーダルの「削除する」で実行する
  const handleRemoveMember = async () => {
    if (isRemovingMember || !removeTarget || !settingsProjectId) {
      return;
    }
    const projectId = settingsProjectId;
    const memberId = removeTarget.id;

    setIsRemovingMember(true);
    const result = await apiDelete(`/projects/${projectId}/members/${memberId}`);

    if (result.ok) {
      // 一覧は取り直さず、その行を消す（参加メンバー数も一覧の件数から減る）
      setMembersResult(prev =>
        prev?.projectId === projectId && prev.members
          ? { ...prev, members: prev.members.filter(m => m.id !== memberId) }
          : prev,
      );
      setRemoveTarget(null);
      setIsRemovingMember(false);
      return;
    }
    if (result.status === 401) {
      // 遷移が終わるまで、確認モーダルのボタンは押せないままにする
      router.replace('/login');
      return;
    }

    const message = result.messages[0];
    if (result.status === 400 || result.status === 404) {
      // ロール変更と同じく、別の管理者が先に操作した場合に起きうる。一覧を取り直して実際の状態に合わせる
      setRemoveTarget(null);
      setToast({ id: Date.now(), message: message ?? NETWORK_ERROR_MESSAGE });
      setMembersAttempt(attempt => attempt + 1);
    } else if (result.status === 403) {
      setRemoveTarget(null);
      setToast({ id: Date.now(), message: message ?? 'この操作を行う権限がありません。' });
      setDetailAttempt(attempt => attempt + 1);
    } else {
      // 確認モーダルは開いたまま、そのまま削除し直せるようにする
      setToast({
        id: Date.now(),
        message: result.status === 500 && message ? message : NETWORK_ERROR_MESSAGE,
      });
    }
    setIsRemovingMember(false);
  };

  // 自分の離脱（仕様書3-4・4-6、api-design.md 3-6）。確認モーダルの「離脱する」で実行する
  const handleLeaveProject = async () => {
    if (isLeaving || !settingsProjectId) {
      return;
    }
    const projectId = settingsProjectId;

    setIsLeaving(true);
    const result = await apiPost<{ message: string }>(`/projects/${projectId}/members/leave`);

    if (result.ok) {
      // 離脱したプロジェクトは表示できなくなるため、一覧を取り直して先頭の進行中プロジェクトのダッシュボードへ移り、
      // APIの文言で知らせる（仕様書4-6。進行中が0件なら空状態。動きはプロジェクトが見つからない場合と同じ）
      setIsLeaveModalOpen(false);
      setActiveNav('dashboard');
      reloadProjectListWithNotice([result.data.message]);
      setIsLeaving(false);
      return;
    }
    if (result.status === 401) {
      router.replace('/login');
      return;
    }

    const message = result.messages[0];
    if (result.status === 400) {
      // ほかの管理者がいなくなっていた場合など。一覧を取り直して実際の状態に合わせる（離脱は押せなくなる）
      setIsLeaveModalOpen(false);
      setToast({ id: Date.now(), message: message ?? NETWORK_ERROR_MESSAGE });
      setMembersAttempt(attempt => attempt + 1);
    } else if (result.status === 403) {
      setIsLeaveModalOpen(false);
      setToast({ id: Date.now(), message: message ?? 'この操作を行う権限がありません。' });
      setDetailAttempt(attempt => attempt + 1);
    } else if (result.status === 404) {
      setIsLeaveModalOpen(false);
      reloadProjectListWithNotice(result.messages);
    } else {
      setToast({
        id: Date.now(),
        message: result.status === 500 && message ? message : NETWORK_ERROR_MESSAGE,
      });
    }
    setIsLeaving(false);
  };

  // 終了済みプロジェクトを選択
  const handleSelectArchivedProject = (project: ArchivedProject) => {
    setViewingArchivedProject(project);
    setIsArchivedMenuOpen(false);
    setActiveNav('dashboard');
  };

  // 終了済みメニューの開閉。開くときに、ボタンの直下・右端をそろえた位置を計算する
  const handleToggleArchivedMenu = () => {
    if (!isArchivedMenuOpen && archivedFilterRef.current) {
      const rect = archivedFilterRef.current.getBoundingClientRect();
      setArchivedMenuPosition({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
    setIsArchivedMenuOpen(!isArchivedMenuOpen);
  };

  // 終了済みプロジェクト閲覧を終了して通常のプロジェクトに戻る
  const handleExitArchivedView = (projectId: string) => {
    setViewingArchivedProject(null);
    setActiveProjectId(projectId);
  };

  const handleResizeStart = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = {
      index,
      startX: e.clientX,
      startWidths: [...columnWidths],
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [columnWidths]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current || !tableRef.current) return;

      const { index, startX, startWidths } = resizingRef.current;
      const tableWidth = tableRef.current.offsetWidth;
      const deltaX = e.clientX - startX;
      const deltaPercent = (deltaX / tableWidth) * 100;

      const newWidths = [...startWidths];
      const minWidth = 8;

      const newCurrentWidth = startWidths[index] + deltaPercent;
      const newNextWidth = startWidths[index + 1] - deltaPercent;

      if (newCurrentWidth >= minWidth && newNextWidth >= minWidth) {
        newWidths[index] = newCurrentWidth;
        newWidths[index + 1] = newNextWidth;
        setColumnWidths(newWidths);
      }
    };

    const handleMouseUp = () => {
      if (resizingRef.current) {
        resizingRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // 行メニュー外クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(`.${styles.rowMenu}`) && !target.closest(`.${styles.actionDots}`)) {
        setRowMenuFile(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // プロジェクト切替でロールが管理者以外になったら、ナビをダッシュボードに戻す（仕様書2-4）。
  // 「プロジェクト設定」は管理者にしか表示されないため、ナビを戻す必要があるのはロールが変わったときだけ。
  // effectではなく描画中に前回のロールと比べて更新する（Reactの「propsの変化に合わせてstateを調整する」書き方）
  const [prevRole, setPrevRole] = useState(currentRole);
  if (currentRole !== prevRole) {
    setPrevRole(currentRole);
    if (currentRole !== '管理者') {
      setActiveNav('dashboard');
    }
  }

  // 空状態の判定（仕様書5-5、api-design.md 2-3）
  // - ファイル0件：進捗率は「0%」、プログレスバーは0%の状態
  // - ファイルはあるが対象テスト0件（progressRate が null）：進捗率は「—」、プログレスバーは空の状態
  const hasTestCases = summary.targetCount > 0;
  const isProgressUndefined = summary.fileCount > 0 && summary.progressRate === null;

  // 進捗率はAPIの値（小数第1位まで）をそのまま表示する（api-design.md 2-3：集計はバックエンドで行う）
  const progressPercent = summary.progressRate ?? 0;
  const progressDisplay = isProgressUndefined ? '—' : String(progressPercent);
  const showPercentSign = !isProgressUndefined;

  // ドーナツのパーセント計算
  const okPercent = hasTestCases ? Math.round(summary.okCount / summary.targetCount * 100) : 0;
  const ngPercent = hasTestCases ? Math.round(summary.ngCount / summary.targetCount * 100) : 0;
  const pendingPercent = hasTestCases ? Math.round(summary.notRunCount / summary.targetCount * 100) : 0;

  // タブのドラッグ&ドロップ
  const handleDragStart = (e: React.DragEvent, projectId: string) => {
    setDraggingId(projectId);
    dragStartOrderRef.current = projects.map(p => p.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  // 並び順を保存する（api-design.md 2-6。進行中プロジェクト全件の順序をまとめて送る）。
  // 保存は1件ずつ順番に送り、通信中に並び替えられたら、終わってから最新の並びだけを送る。
  // 同時に複数送ると、サーバーで書き込まれる順番が入れ替わり、古い並びが最後に残ることがあるため。
  // useCallbackにしているのは、ほかの関数から呼ぶ関数を、Reactのlint（react-hooks/purity）が
  // 描画中に呼ばれうるものとして扱い、中の Date.now() を誤って指摘するため
  const saveProjectOrder = useCallback(async (order: string[]) => {
    pendingOrderRef.current = order;
    if (isSavingOrderRef.current) {
      return;
    }
    isSavingOrderRef.current = true;

    // 保存待ちの並びを1件送り、成功したら、その間に増えた保存待ちを続けて送る
    const sendPendingOrder = async (): Promise<void> => {
      const toSave = pendingOrderRef.current;
      pendingOrderRef.current = null;
      if (toSave === null) {
        return;
      }
      // 通信中に元の並びへ戻された場合など、保存済みと同じなら送らない
      if (isSameOrder(toSave, savedOrderRef.current)) {
        return sendPendingOrder();
      }

      const result = await apiPatch('/projects/order', {
        orders: toSave.map((projectId, index) => ({ projectId, order: index })),
      });
      if (result.ok) {
        savedOrderRef.current = toSave;
        return sendPendingOrder();
      }

      // 失敗したら、保存待ちの並びも送らない（失敗した並びを元にした並びのため）
      pendingOrderRef.current = null;
      if (result.status === 401) {
        router.replace('/login');
      } else if (result.status === 400) {
        // 参加していない（終了した・外された）プロジェクトが含まれていた場合など。
        // 一覧を取り直してサーバーの実際の並びに合わせる（扱いはプロジェクトが見つからない場合と同じ）
        reloadProjectListWithNotice(result.messages);
      } else {
        // 保存前の並びに戻す。保存済みの並びにないタブ（通信中に作成したものなど）は、今の順のまま末尾に置く
        const savedOrder = savedOrderRef.current;
        const rank = (id: string) => {
          const index = savedOrder.indexOf(id);
          return index === -1 ? Infinity : index;
        };
        setProjects(prev => [...prev].sort((a, b) => rank(a.id) - rank(b.id)));
        setToast({
          id: Date.now(),
          message: result.status === 500 && result.messages.length > 0
            ? result.messages[0]
            : NETWORK_ERROR_MESSAGE,
        });
      }
    };

    await sendPendingOrder();
    isSavingOrderRef.current = false;
  }, [router, reloadProjectListWithNotice]);

  // 並びはドラッグ中（handleDragOver）にその場で入れ替わっているので、離した時点の並びを保存する。
  // タブの外で離した場合も、見えている並びを正として保存する（画面と保存内容を食い違わせないため）
  const handleDragEnd = () => {
    setDraggingId(null);
    const before = dragStartOrderRef.current;
    dragStartOrderRef.current = null;
    const after = projects.map(p => p.id);
    if (before === null || isSameOrder(before, after)) {
      return;
    }
    void saveProjectOrder(after);
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggingId || draggingId === targetId) return;

    const dragIndex = projects.findIndex(p => p.id === draggingId);
    const targetIndex = projects.findIndex(p => p.id === targetId);

    if (dragIndex === -1 || targetIndex === -1) return;

    const newProjects = [...projects];
    const [draggedProject] = newProjects.splice(dragIndex, 1);
    newProjects.splice(targetIndex, 0, draggedProject);
    setProjects(newProjects);
  };

  const displayLimitLabel = displayLimit === 'all' ? 'すべて' : `${displayLimit}件`;

  // 閲覧者以外の場合、アクション列の幅を考慮した列幅
  const effectiveColumnWidths = canEdit
    ? columnWidths
    : [40, 22, 19, 19];

  // 行メニュー
  const handleRowMenuClick = (e: React.MouseEvent, file: TestFile) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setRowMenuPosition({ top: rect.bottom + 4, left: rect.right - 160, buttonTop: rect.top });
    setRowMenuFile(rowMenuFile?.id === file.id ? null : file);
  };

  // 行メニューは、まずボタンの下に開く。下端に近い行で、下に収まらないときは、ボタンの上側に開き直す。
  // メニューの高さは表示してみないと分からないため、描画後・画面に出る前（useLayoutEffect）に測る
  useLayoutEffect(() => {
    const menu = rowMenuRef.current;
    if (!menu) {
      return;
    }
    const height = menu.offsetHeight;
    if (rowMenuPosition.top + height > window.innerHeight) {
      setRowMenuPosition(prev => ({ ...prev, top: Math.max(4, prev.buttonTop - 4 - height) }));
    }
  }, [rowMenuFile, rowMenuPosition]);

  // 更新履歴の有無は一覧APIに含まれないため、取り消せるかは押す前には分けず、4-4の400で判断する
  const handleUnregisterClick = () => {
    if (!rowMenuFile) return;
    setRowMenuFile(null);
    setCancelConfirmFile(rowMenuFile);
  };

  // 全体進捗カード・ドーナツ（詳細の進捗サマリー）を取り直す。detailAttempt を増やす取り直しだと
  // 画面全体が「読み込み中…」になるため、表示はそのままで中身だけを置き換える
  const refreshProjectDetail = async (projectId: string) => {
    const result = await apiGet<ProjectDetailResponse>(`/projects/${projectId}`);
    if (result.ok) {
      setDetailResult(prev =>
        prev?.projectId === projectId && prev.detail
          ? { ...prev, detail: toProjectDetail(result.data) }
          : prev,
      );
    } else if (result.status === 401) {
      router.replace('/login');
    } else if (result.status === 404) {
      reloadProjectListWithNotice(result.messages);
    }
    // そのほかの失敗では前の値のまま（取消の結果はトーストで伝えているため、通知を重ねない）
  };

  // 登録取消（仕様書6-9・8-2、api-design.md 4-4）。確認モーダルの「登録を取り消す」で実行する
  const handleConfirmUnregister = async () => {
    if (isUnregistering || !cancelConfirmFile || !detailTargetId) {
      return;
    }
    const projectId = detailTargetId;
    const file = cancelConfirmFile;

    setIsUnregistering(true);
    const result = await apiDelete<{ message: string }>(`/projects/${projectId}/test-files/${file.id}`);

    if (!result.ok && result.status === 401) {
      // 遷移が終わるまで、確認モーダルのボタンは押せないままにする
      router.replace('/login');
      return;
    }
    setIsUnregistering(false);
    // 通信中に別のプロジェクトへ切り替わっていたら、前のプロジェクトの結果で今の画面を書き換えない
    // （切り替えた時点でモーダルは閉じている）
    if (detailTargetIdRef.current !== projectId) {
      return;
    }

    if (result.ok) {
      // 取消で進捗が再計算されるため、一覧と全体進捗の両方を取り直す
      setCancelConfirmFile(null);
      setToast({ id: Date.now(), message: result.data.message });
      setFilesAttempt(attempt => attempt + 1);
      void refreshProjectDetail(projectId);
      return;
    }

    const message = result.messages[0];
    if (result.status === 400) {
      // 更新履歴があり取り消せない。確認モーダルから、取消不可のモーダル（仕様書6-9）に切り替える
      setCancelConfirmFile(null);
      setCancelBlockedFile(file);
    } else if (result.status === 404) {
      // 別の人が先に取り消した場合など。一覧と全体進捗を取り直して実際の状態に合わせる
      // （プロジェクト自体がなくなっていた場合は、取り直しの404で、プロジェクトが見つからない扱いになる）
      setCancelConfirmFile(null);
      setToast({ id: Date.now(), message: message ?? NETWORK_ERROR_MESSAGE });
      setFilesAttempt(attempt => attempt + 1);
      void refreshProjectDetail(projectId);
    } else if (result.status === 403) {
      // 閲覧者になっていた、終了済みになっていた場合など。詳細を取り直して最新のロール・状態に合わせる
      setCancelConfirmFile(null);
      setToast({ id: Date.now(), message: message ?? 'この操作を行う権限がありません。' });
      setDetailAttempt(attempt => attempt + 1);
    } else {
      // モーダルは開いたまま、そのまま取り消し直せるようにする
      setToast({
        id: Date.now(),
        message: result.status === 500 && message ? message : NETWORK_ERROR_MESSAGE,
      });
    }
  };

  // 選択ビューに戻す（選び直し）。同じファイルを選び直しても onChange が動くよう、入力欄の値も空にする
  const resetUploadSelection = () => {
    setUploadView('select');
    setPreviewFiles([]);
    setUploadResults([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const closeUploadModal = () => {
    setIsUploadModalOpen(false);
    resetUploadSelection();
  };

  // Excel読込プレビュー（仕様書6-4〜6-7、api-design.md 4-2）。選んだファイルをまとめて送り、
  // 解析結果で確認画面を出す。新規／更新の判定と進捗の計算はサーバーが行う
  const handleFilesSelected = async (fileList: FileList) => {
    if (isPreviewing || !detailTargetId) {
      return;
    }
    const projectId = detailTargetId;
    const selected = Array.from(fileList);
    const form = new FormData();
    for (const file of selected) {
      form.append('files', file);
    }

    setIsPreviewing(true);
    // Next.jsの上限は区切り文字も含めた本文全体にかかるため、実際に送る本文の大きさで確かめる
    const bodySize = (await new Response(form).blob()).size;
    const limitError = validateUpload(selected, bodySize);
    if (limitError) {
      setIsPreviewing(false);
      resetUploadSelection();
      setToast({ id: Date.now(), message: limitError });
      return;
    }
    const result = await apiPostForm<PreviewResponse>(`/projects/${projectId}/test-files/preview`, form);

    if (!result.ok && result.status === 401) {
      // 遷移が終わるまで、解析中の表示のままにする
      router.replace('/login');
      return;
    }
    setIsPreviewing(false);
    // 通信中に別のプロジェクトへ切り替わっていたら、前のプロジェクトの結果で今の画面を書き換えない
    // （切り替えた時点でモーダルは閉じている）
    if (detailTargetIdRef.current !== projectId) {
      return;
    }

    const showConfirm = (preview: PreviewResponse) => {
      setPreviewFiles([...preview.files].sort((a, b) => compareFileName(a.fileName, b.fileName)));
      setUploadView('confirm');
    };
    if (result.ok) {
      showConfirm(result.data);
      return;
    }
    // 全ファイルがエラーのときは400だが、本文に200と同じ files（ファイルごとの理由）が入っている
    if (result.status === 400 && isPreviewResponse(result.body)) {
      showConfirm(result.body);
      return;
    }

    const message = result.messages[0];
    if (result.status === 403) {
      // 閲覧者になっていた、終了済みになっていた場合など。詳細を取り直して最新のロール・状態に合わせる
      closeUploadModal();
      setToast({ id: Date.now(), message: message ?? 'この操作を行う権限がありません。' });
      setDetailAttempt(attempt => attempt + 1);
    } else if (result.status === 404) {
      closeUploadModal();
      reloadProjectListWithNotice(result.messages);
    } else {
      // モーダルは閉じず、選び直せるようにする。400（アップロードの上限など）はAPIの文言を出す
      resetUploadSelection();
      setToast({
        id: Date.now(),
        message: (result.status === 400 || result.status === 500) && message ? message : NETWORK_ERROR_MESSAGE,
      });
    }
  };

  // Excel読込の実行（仕様書6-8・8-1、api-design.md 4-3）。確認画面で保持している解析結果を送り返し、
  // Excelは送り直さない。エラーのファイルは送らない（確認画面で「スキップされる」と伝えている）
  const handleExecuteImport = async () => {
    if (isCommitting || !detailTargetId) {
      return;
    }
    const projectId = detailTargetId;
    const targets = previewFiles.filter(f => f.operation !== 'error');
    if (targets.length === 0) {
      return;
    }

    setIsCommitting(true);
    const result = await apiPost<CommitResponse>(`/projects/${projectId}/test-files/commit`, {
      files: targets.map(f => ({
        fileName: f.fileName,
        operation: f.operation,
        existingFileId: f.existingFileId,
        baseVersion: f.baseVersion,
        parsedData: f.parsedData,
      })),
    });

    if (!result.ok && result.status === 401) {
      // 遷移が終わるまで、実行ボタンは押せないままにする
      router.replace('/login');
      return;
    }
    setIsCommitting(false);
    // 通信中に別のプロジェクトへ切り替わっていたら、前のプロジェクトの結果で今の画面を書き換えない
    // （切り替えた時点でモーダルは閉じている）
    if (detailTargetIdRef.current !== projectId) {
      return;
    }

    if (result.ok) {
      // 一部・全部のファイルがエラーでも200。結果画面でファイルごとに成功／エラーを出す（仕様書6-8）
      setUploadResults([...result.data.files].sort((a, b) => compareFileName(a.fileName, b.fileName)));
      setUploadView('result');
      // 1件でも登録・更新されたら、一覧と全体進捗を取り直す（全体進捗は表示を残して中身だけ置き換える）
      if (result.data.summary.successCount > 0) {
        setFilesAttempt(attempt => attempt + 1);
        void refreshProjectDetail(projectId);
      }
      return;
    }

    const message = result.messages[0];
    if (result.status === 403) {
      // 閲覧者になっていた、終了済みになっていた場合など。詳細を取り直して最新のロール・状態に合わせる
      closeUploadModal();
      setToast({ id: Date.now(), message: message ?? 'この操作を行う権限がありません。' });
      setDetailAttempt(attempt => attempt + 1);
    } else if (result.status === 404) {
      // プロジェクトから外されていた場合など。取り直しの404で、プロジェクトが見つからない扱いになる
      closeUploadModal();
      setToast({ id: Date.now(), message: message ?? NETWORK_ERROR_MESSAGE });
      setFilesAttempt(attempt => attempt + 1);
      void refreshProjectDetail(projectId);
    } else {
      // 確認画面のまま、もう一度「実行」を押せるようにする
      setToast({
        id: Date.now(),
        message: (result.status === 400 || result.status === 500) && message ? message : NETWORK_ERROR_MESSAGE,
      });
    }
  };

  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }
    setIsLoggingOut(true);

    const result = await apiPost('/auth/logout');

    // 401は別タブでのログアウト済み・セッション期限切れ等で、すでにログアウトしている状態のため、成功と同じ扱いにする
    if (result.ok || result.status === 401) {
      router.push('/login');
      return;
    }

    setToast({
      id: Date.now(),
      message: result.status === 500 && result.messages.length > 0
        ? result.messages[0]
        : NETWORK_ERROR_MESSAGE,
    });
    setIsLoggingOut(false);
  };

  const closeCreateProjectModal = () => {
    setIsCreateProjectModalOpen(false);
    setNewProjectName('');
    setNewProjectNameError(null);
  };

  // プロジェクト作成（仕様書2-1、api-design.md 2-2）
  const handleCreateProject = async () => {
    if (isCreatingProject) {
      return;
    }
    const trimmed = newProjectName.trim();
    const nameError = validateProjectName(trimmed);
    if (nameError) {
      setNewProjectNameError(nameError);
      return;
    }

    setIsCreatingProject(true);
    const result = await apiPost<CreateProjectResponse>('/projects', { name: trimmed });

    if (result.ok) {
      const created = result.data;
      // 一覧は取り直さず、201の内容をタブの末尾に加える。
      // orderは既存の最大値+1で返る（api-design.md 2-2）ため、末尾に置けば一覧APIの並びと一致する
      setProjects(prev => [
        ...prev,
        { id: created.id, name: created.name, role: ROLE_LABELS[created.myRole] },
      ]);
      // 終了済みを閲覧中に作成した場合も、作成したプロジェクトへ切り替える（仕様書2-1）
      setViewingArchivedProject(null);
      setActiveProjectId(created.id);
      setActiveNav('dashboard');
      // 直前の失敗の通知が残っていると、作成にも失敗したように見えるため消す
      setToast(null);
      closeCreateProjectModal();
      setIsCreatingProject(false);
      return;
    }
    if (result.status === 401) {
      // 遷移が終わるまで作成ボタンは無効のままにする
      router.replace('/login');
      return;
    }

    if (result.status === 400 && result.messages.length > 0) {
      // 空のときの「必須」と「1文字以上」のように、同じ原因で複数の文言が返ることがあるため、先頭の1件だけを出す
      setNewProjectNameError(result.messages[0]);
    } else {
      // 入力した名前は残し、そのまま作成し直せるようにする（仕様書4-8「一部操作の失敗は短いエラー通知」）
      setToast({
        id: Date.now(),
        message: result.status === 500 && result.messages.length > 0
          ? result.messages[0]
          : NETWORK_ERROR_MESSAGE,
      });
    }
    setIsCreatingProject(false);
  };

  // 終了したプロジェクトを、進行中のタブから終了済みへ移し、閲覧専用ダッシュボードとして開いたままにする
  // （操作の結果がその場で見え、データが消えていないことも伝わるため）
  const showAsArchived = (archived: ArchivedProject) => {
    setProjects(prev => prev.filter(p => p.id !== archived.id));
    // 一覧APIでは終了済みは作成日の新しい順だが、作成日を持っていないため、直近に終了したものとして先頭に置く
    setArchivedProjects(prev => [archived, ...prev.filter(p => p.id !== archived.id)]);
    setViewingArchivedProject(archived);
    // 終了済みでは管理者ナビ・プロジェクト設定を出さない（仕様書2-6）
    setActiveNav('dashboard');
  };

  // プロジェクト終了（仕様書2-6・4-7、api-design.md 2-5）
  const handleArchiveProject = async () => {
    if (isArchivingProject || !activeProject) {
      return;
    }
    const target = { id: activeProject.id, name: activeProject.name };

    setIsArchivingProject(true);
    const result = await apiPost<ArchivedProject>(`/projects/${target.id}/archive`);

    if (result.ok) {
      showAsArchived({ id: result.data.id, name: result.data.name });
      setToast(null);
      setIsTerminateModalOpen(false);
      setIsArchivingProject(false);
      return;
    }
    if (result.status === 401) {
      // 遷移が終わるまで終了ボタンは無効のままにする
      router.replace('/login');
      return;
    }

    const message = result.messages[0];
    if (result.status === 400) {
      // 別の管理者がすでに終了していた場合。サーバーでは終了済みなので、成功時と同じ表示に合わせる
      showAsArchived(target);
      setToast({ id: Date.now(), message: message ?? 'このプロジェクトはすでに終了しています。' });
      setIsTerminateModalOpen(false);
    } else if (result.status === 404) {
      // プロジェクトから外された場合など（一覧を取り直して先頭へ移る。詳細取得時の404と同じ扱い）
      setIsTerminateModalOpen(false);
      reloadProjectListWithNotice(result.messages);
    } else if (result.status === 403) {
      // 管理者でなくなっていた場合。詳細を取り直して最新のロールに合わせる
      // （管理者以外になればナビはダッシュボードに戻る。仕様書2-4）
      setToast({ id: Date.now(), message: message ?? 'この操作を行う権限がありません。' });
      setIsTerminateModalOpen(false);
      setDetailAttempt(attempt => attempt + 1);
    } else {
      // モーダルは閉じず、そのまま終了し直せるようにする（仕様書4-8「一部操作の失敗は短いエラー通知」）
      setToast({
        id: Date.now(),
        message: result.status === 500 && message ? message : NETWORK_ERROR_MESSAGE,
      });
    }
    setIsArchivingProject(false);
  };

  const uploadErrorCount = previewFiles.filter(f => f.operation === 'error').length;
  const uploadValidCount = previewFiles.length - uploadErrorCount;
  const uploadSuccessCount = uploadResults.filter(f => f.result === 'success').length;
  const uploadFailCount = uploadResults.length - uploadSuccessCount;

  // ロール表示名
  const roleLabel = currentRole === '管理者' ? '管理者ダッシュボード'
    : currentRole === 'テスター' ? 'テスターダッシュボード'
    : '閲覧者ダッシュボード';

  // 一覧の最初の取得中は、読み込み中の表示だけにする（401ならこのままログイン画面へ移る）
  if (!hasFinishedFirstList) {
    return (
      <div className={styles.wrap}>
        <div className={`${styles.card} ${styles.loadingCard}`}>
          <div className={styles.spinner}></div>
          <div className={styles.loadingText}>読み込み中…</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {/* ===== ヘッダー ===== */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <div>
            <div className={styles.brandName}>
              Test<span className={styles.accent}>Track</span>
            </div>
            <div className={styles.brandTag}>テスト進捗をシンプルに共有</div>
          </div>
        </div>
        <div className={styles.headerRight}>
          <button
            className={styles.btnAdd}
            onClick={() => setIsCreateProjectModalOpen(true)}
          >
            ＋ プロジェクト追加
          </button>
          <div
            ref={userMenuRef}
            className={`${styles.userMenu} ${isUserMenuOpen ? styles.userMenuOpen : ''}`}
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
          >
            <span className={styles.userMenuName} title={currentUser?.displayName}>
              {currentUser?.displayName}
            </span>
            <svg className={styles.userMenuChevron} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
            {isUserMenuOpen && (
              <div className={styles.userDropdown}>
                <div className={styles.userDropdownItem} onClick={handleLogout}>
                  {isLoggingOut ? 'ログアウト中...' : 'ログアウト'}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ===== プロジェクトタブ ===== */}
      <div className={styles.tabs}>
        <div className={styles.tabList}>
          {projects.map(project => (
            <div
              key={project.id}
              className={`${styles.tab} ${!isViewingArchived && project.id === activeProjectId ? styles.tabActive : ''} ${draggingId === project.id ? styles.tabDragging : ''}`}
              onClick={() => isViewingArchived ? handleExitArchivedView(project.id) : setActiveProjectId(project.id)}
              draggable
              onDragStart={(e) => handleDragStart(e, project.id)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, project.id)}
              // 約20文字を超えると「…」で省略されるため、ホバーで全文を確認できるようにする（仕様書2-2）
              title={project.name}
            >
              {project.name}
            </div>
          ))}
        </div>
        <div
          ref={archivedFilterRef}
          className={`${styles.tabFilter} ${isViewingArchived ? styles.tabFilterSelected : ''}`}
          onClick={handleToggleArchivedMenu}
        >
          終了済み {archivedProjects.length} 件 ▾
        </div>
        {isArchivedMenuOpen && (
          <div
            ref={archivedMenuRef}
            className={styles.archivedMenu}
            style={{ top: archivedMenuPosition.top, right: archivedMenuPosition.right }}
          >
            {archivedProjects.map(project => (
              <div
                key={project.id}
                className={styles.archivedMenuItem}
                onClick={() => handleSelectArchivedProject(project)}
              >
                {project.name}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== 進行中プロジェクト0件 ===== */}
      {listStatus === 'loaded' && projects.length === 0 && !isViewingArchived && (
        <div className={`${styles.card} ${styles.noProjectCard}`}>
          <div className={styles.noProjectIcon}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
              <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
              <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
              <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
            </svg>
          </div>
          <div className={styles.noProjectTitle}>表示するプロジェクトがありません</div>
          <div className={styles.noProjectHint}>
            画面右上の「＋ プロジェクト追加」から、<br />
            新しいプロジェクトを作成できます。
          </div>
        </div>
      )}

      {/* ===== ローディング状態 ===== */}
      {showLoading && (
        <div className={`${styles.card} ${styles.loadingCard}`}>
          <div className={styles.spinner}></div>
          <div className={styles.loadingText}>読み込み中…</div>
        </div>
      )}

      {/* ===== エラー状態 ===== */}
      {showFetchError && (
        <div className={`${styles.card} ${styles.errorCard}`}>
          <div className={styles.errorIcon}>!</div>
          <div className={styles.errorTitle}>データを取得できませんでした</div>
          <div className={styles.errorDesc}>{NETWORK_ERROR_MESSAGE}</div>
          <button className={styles.btnRetry} onClick={handleRetry}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            再読み込み
          </button>
        </div>
      )}

      {/* ===== 管理者ナビゲーション（管理者のみ） ===== */}
      {projects.length > 0 && !showLoading && !showFetchError && canManage && (
        <nav className={styles.adminNav}>
          <div
            className={`${styles.adminNavItem} ${activeNav === 'dashboard' ? styles.adminNavItemActive : ''}`}
            onClick={() => setActiveNav('dashboard')}
          >
            ダッシュボード
          </div>
          <div
            className={`${styles.adminNavItem} ${activeNav === 'settings' ? styles.adminNavItemActive : ''}`}
            onClick={() => {
              // 開くたびにメンバー一覧を取り直す（ほかの管理者が変更している場合があるため）
              setMembersAttempt(attempt => attempt + 1);
              setActiveNav('settings');
            }}
          >
            プロジェクト設定
          </div>
        </nav>
      )}

      {/* ===== ダッシュボードビュー ===== */}
      {(projects.length > 0 || isViewingArchived) && !showLoading && !showFetchError && activeNav === 'dashboard' && (
        <>
          <div className={styles.pageHead}>
            {isViewingArchived ? (
              <>
                <div className={styles.pageTitleRow}>
                  <h1 className={styles.pageTitle}>{viewingArchivedProject?.name}</h1>
                  <span className={styles.archivedBadge}>終了済み</span>
                </div>
                <p className={styles.pageSub}>閲覧専用ダッシュボード</p>
              </>
            ) : (
              <>
                <h1 className={styles.pageTitle}>{activeProject?.name}</h1>
                <p className={styles.pageSub}>{roleLabel}</p>
              </>
            )}
          </div>

          {/* 全体進捗カード */}
          <div className={`${styles.card} ${styles.progressCard}`}>
            <div className={styles.progressLabel}>全体進捗</div>
            <div className={styles.progressMain}>
              <span className={styles.progressValue}>{progressDisplay}</span>
              {showPercentSign && <span className={styles.progressPercent}>%</span>}
            </div>
            <div className={`${styles.progressTrack} ${isProgressUndefined ? styles.progressTrackEmpty : ''}`}>
              <div className={styles.progressFill} style={{ width: `${progressPercent}%` }}></div>
            </div>
            <div className={styles.progressCaption}>
              {summary.completedCount} / {summary.targetCount} 件 実施済み
            </div>
          </div>

          {/* メイングリッド */}
          <div className={styles.mainGrid}>
            {/* 実施状況の内訳 */}
            <div className={styles.card}>
              <div className={styles.cardLabel}>実施状況の内訳</div>
              <div className={styles.donutWrap}>
                <div
                  className={`${styles.donut} ${!hasTestCases ? styles.donutEmpty : ''}`}
                  style={hasTestCases ? {
                    background: `conic-gradient(
                      var(--accent) 0deg ${okPercent * 3.6}deg,
                      var(--fail) ${okPercent * 3.6}deg ${(okPercent + ngPercent) * 3.6}deg,
                      var(--pending) ${(okPercent + ngPercent) * 3.6}deg 360deg
                    )`
                  } : undefined}
                >
                  <div className={styles.donutCenter}>
                    <b>{summary.targetCount}</b>
                    <span>件</span>
                  </div>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legendName}>
                  <span className={styles.dot} style={{ background: 'var(--accent)' }}></span>
                  OK
                </div>
                <div className={styles.legendFigures}>
                  <span className={styles.legendNum}>{summary.okCount}件</span>
                  <span className={styles.legendPct}>{okPercent}%</span>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legendName}>
                  <span className={styles.dot} style={{ background: 'var(--fail)' }}></span>
                  NG
                </div>
                <div className={styles.legendFigures}>
                  <span className={styles.legendNum}>{summary.ngCount}件</span>
                  <span className={styles.legendPct}>{ngPercent}%</span>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legendName}>
                  <span className={styles.dot} style={{ background: 'var(--pending)' }}></span>
                  未実施
                </div>
                <div className={styles.legendFigures}>
                  <span className={styles.legendNum}>{summary.notRunCount}件</span>
                  <span className={styles.legendPct}>{pendingPercent}%</span>
                </div>
              </div>
            </div>

            {/* テストファイル一覧 */}
            <div className={styles.card}>
              <div className={styles.filesTopRow}>
                <div className={styles.filesTitle}>テストファイル一覧</div>
                {canEdit && (
                  <button
                    className={styles.btnImport}
                    onClick={() => setIsUploadModalOpen(true)}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <polyline points="17 8 12 3 7 8"></polyline>
                      <line x1="12" y1="3" x2="12" y2="15"></line>
                    </svg>
                    ファイル読込
                  </button>
                )}
              </div>
              <div className={styles.filesHead}>
                <div className={styles.searchBox}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="7"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  <input
                    type="text"
                    placeholder="ファイル名で検索"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className={styles.segmented}>
                  <div
                    className={`${styles.segment} ${filterSegment === 'all' ? styles.segmentActive : ''}`}
                    onClick={() => setFilterSegment('all')}
                  >
                    すべて
                  </div>
                  <div
                    className={`${styles.segment} ${filterSegment === 'hasIncomplete' ? styles.segmentActive : ''}`}
                    onClick={() => setFilterSegment('hasIncomplete')}
                  >
                    未実施あり
                  </div>
                  <div
                    className={`${styles.segment} ${filterSegment === 'allComplete' ? styles.segmentActive : ''}`}
                    onClick={() => setFilterSegment('allComplete')}
                  >
                    全件実施済み
                  </div>
                </div>
                <div className={styles.sortBoxWrap} ref={sortBoxWrapRef}>
                  <div
                    className={styles.sortBox}
                    onClick={() => setIsSortMenuOpen(!isSortMenuOpen)}
                  >
                    {displayLimitLabel} ▾
                  </div>
                  {isSortMenuOpen && (
                    <div className={styles.sortMenu}>
                      <div
                        className={styles.sortMenuItem}
                        onClick={() => { setDisplayLimit(5); setIsSortMenuOpen(false); }}
                      >
                        5件
                      </div>
                      <div
                        className={styles.sortMenuItem}
                        onClick={() => { setDisplayLimit(10); setIsSortMenuOpen(false); }}
                      >
                        10件
                      </div>
                      <div
                        className={styles.sortMenuItem}
                        onClick={() => { setDisplayLimit('all'); setIsSortMenuOpen(false); }}
                      >
                        すべて
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {isLoadingFiles ? (
                <div className={`${styles.loadingCard} ${styles.sectionState}`}>
                  <div className={styles.spinner}></div>
                  <div className={styles.loadingText}>読み込み中…</div>
                </div>
              ) : filesFetchError ? (
                <div className={`${styles.errorCard} ${styles.sectionState}`}>
                  <div className={styles.errorIcon}>!</div>
                  <div className={styles.errorTitle}>テストファイルを取得できませんでした</div>
                  <div className={styles.errorDesc}>{NETWORK_ERROR_MESSAGE}</div>
                  <button
                    className={styles.btnRetry}
                    onClick={() => setFilesAttempt(attempt => attempt + 1)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10"></polyline>
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                    </svg>
                    再読み込み
                  </button>
                </div>
              ) : files.length > 0 ? (
                <>
                  <table className={styles.filesTable} ref={tableRef}>
                    <thead>
                      <tr>
                        {/* 並べ替えは見出しの中のボタンで受ける。見出し全体で受けると、
                            列幅を変えるつまみ（resizeHandle）を離したときのクリックでも並びが変わってしまうため */}
                        <th style={{ width: `${effectiveColumnWidths[0]}%` }} aria-sort={sortAriaFor('name')}>
                          <button className={styles.sortHeader} onClick={() => handleFileSortClick('name')}>
                            ファイル名<span className={styles.sortMark}>{sortMarkFor('name')}</span>
                          </button>
                          <div
                            className={styles.resizeHandle}
                            onMouseDown={(e) => handleResizeStart(0, e)}
                          />
                        </th>
                        <th style={{ width: `${effectiveColumnWidths[1]}%` }} aria-sort={sortAriaFor('progress')}>
                          <button className={styles.sortHeader} onClick={() => handleFileSortClick('progress')}>
                            進捗<span className={styles.sortMark}>{sortMarkFor('progress')}</span>
                          </button>
                          <div
                            className={styles.resizeHandle}
                            onMouseDown={(e) => handleResizeStart(1, e)}
                          />
                        </th>
                        <th style={{ width: `${effectiveColumnWidths[2]}%` }} aria-sort={sortAriaFor('updatedAt')}>
                          <button className={styles.sortHeader} onClick={() => handleFileSortClick('updatedAt')}>
                            最終更新<span className={styles.sortMark}>{sortMarkFor('updatedAt')}</span>
                          </button>
                          <div
                            className={styles.resizeHandle}
                            onMouseDown={(e) => handleResizeStart(2, e)}
                          />
                        </th>
                        <th style={{ width: `${effectiveColumnWidths[3]}%` }}>
                          最終更新者
                          {canEdit && (
                            <div
                              className={styles.resizeHandle}
                              onMouseDown={(e) => handleResizeStart(3, e)}
                            />
                          )}
                        </th>
                        {canEdit && (
                          <th style={{ width: `${effectiveColumnWidths[4]}%` }}></th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {files.map(file => (
                        <tr key={file.id}>
                          <td>
                            <div className={styles.fileCell}>
                              <div className={styles.fileName}>{file.fileName}</div>
                            </div>
                          </td>
                          <td>
                            <div className={styles.progWrap}>
                              {/* 対象テストケース0件（notApplicable）は進捗率が出せないため「—」（全体進捗カードと同じ） */}
                              {file.status !== 'notApplicable' && file.progressRate !== null ? (
                                <>
                                  <div className={styles.progBar}>
                                    <span style={{
                                      width: `${file.progressRate}%`,
                                      background: file.progressRate === 0 ? 'var(--border)' : undefined
                                    }}></span>
                                  </div>
                                  {/* 進捗率はAPIの値（小数第1位まで）をそのまま表示する（全体進捗カードと同じ） */}
                                  <div
                                    className={styles.progPct}
                                    style={{ color: file.progressRate === 0 ? 'var(--text-faint)' : undefined }}
                                  >
                                    {file.progressRate}%
                                  </div>
                                </>
                              ) : (
                                <span className={styles.progDash}>—</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className={styles.metaText}>
                              {DATE_TIME_FORMAT_JST.format(new Date(file.updatedAt))}
                            </div>
                          </td>
                          <td><div className={styles.metaName}>{file.lastUpdatedBy}</div></td>
                          {canEdit && (
                            <td>
                              <div
                                className={styles.actionDots}
                                onClick={(e) => handleRowMenuClick(e, file)}
                              >
                                ⋯
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {/* 表示件数で絞られて表示しきれていないときだけ出す（件数はAPIの totalCount） */}
                  {hasMoreFiles && (
                    <div className={styles.filesShowAll}>
                      <button className={styles.filesShowAllButton} onClick={() => setDisplayLimit('all')}>
                        すべて表示（全{filesTotalCount}件）
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className={styles.filesEmpty}>
                  {isFileListFilteredEmpty ? '検索条件に一致するファイルがありません' : '登録されているテストファイルはありません'}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ===== プロジェクト設定ビュー（管理者のみ） ===== */}
      {projects.length > 0 && !showLoading && !showFetchError && activeNav === 'settings' && canManage && (
        <>
          <div className={styles.pageHead}>
            <h1 className={styles.pageTitle}>{activeProject?.name}</h1>
            <p className={styles.pageSub}>プロジェクト設定</p>
          </div>

          {/* 基本情報 */}
          <div className={`${styles.card} ${styles.settingsSection}`}>
            <div className={styles.settingsSectionTitle}>基本情報</div>

            {/* エラー文は行の2段目に回す。1段目でラベルと入力欄の高さがそろうようにするため */}
            <div className={`${styles.settingsRow} ${styles.settingsRowWrap}`}>
              <div className={styles.settingsLabel}>プロジェクト名</div>
              {editingName === null ? (
                <div className={styles.settingsValue}>
                  <span>{activeProject?.name}</span>
                  <span
                    className={styles.editIcon}
                    onClick={() => {
                      if (activeProject) {
                        setEditingName(activeProject.name);
                        setNameError(null);
                      }
                    }}
                  >
                    ✎
                  </span>
                </div>
              ) : (
                <>
                  <div className={styles.settingsValueEdit}>
                    {/* maxLengthは付けない。超えた分が黙って切り捨てられるより、エラーで伝える方が分かりやすいため（作成モーダルと同じ） */}
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => {
                        setEditingName(e.target.value);
                        if (nameError) {
                          setNameError(null);
                        }
                      }}
                      className={nameError ? styles.inputError : ''}
                    />
                    <button
                      className={`${styles.btnMini} ${styles.btnMiniPrimary}`}
                      onClick={handleSaveProjectName}
                      disabled={isSavingName}
                    >
                      {isSavingName ? '保存中...' : '保存'}
                    </button>
                    <button
                      className={styles.btnMini}
                      onClick={closeNameEditor}
                      disabled={isSavingName}
                    >
                      キャンセル
                    </button>
                  </div>
                  {nameError && (
                    <div className={`${styles.fieldErrorSm} ${styles.settingsRowError}`}>{nameError}</div>
                  )}
                </>
              )}
            </div>

            <div className={styles.settingsRow}>
              <div className={styles.settingsLabel}>ステータス</div>
              <div className={styles.settingsValue}>
                <span className={styles.statusPill}>
                  {activeProjectDetail?.status === 'archived' ? '終了済み' : '進行中'}
                </span>
              </div>
            </div>

            <div className={styles.settingsRow}>
              <div className={styles.settingsLabel}>参加メンバー数</div>
              {/* メンバー一覧（3-1）の件数を使う。取得できるまで（取得失敗時も）は「—」 */}
              <div className={styles.settingsValue}>{members ? `${members.length}名` : '—'}</div>
            </div>

            <div className={`${styles.settingsRow} ${styles.settingsRowLast}`}>
              <div className={styles.settingsLabel}>作成日</div>
              <div className={styles.settingsValue}>
                {activeProjectDetail ? DATE_FORMAT_JST.format(new Date(activeProjectDetail.createdAt)) : '—'}
              </div>
            </div>
          </div>

          {/* メンバー管理 */}
          <div className={`${styles.card} ${styles.settingsSection}`}>
            <div className={styles.settingsSectionHead}>
              <div className={styles.settingsSectionTitle}>メンバー管理</div>
              <button
                className={styles.btnSecondary}
                onClick={() => setIsAddMemberModalOpen(true)}
              >
                ＋ メンバーを追加
              </button>
            </div>

            {isLoadingMembers ? (
              <div className={`${styles.loadingCard} ${styles.sectionState}`}>
                <div className={styles.spinner}></div>
                <div className={styles.loadingText}>読み込み中…</div>
              </div>
            ) : membersFetchError || !members ? (
              <div className={`${styles.errorCard} ${styles.sectionState}`}>
                <div className={styles.errorIcon}>!</div>
                <div className={styles.errorTitle}>メンバーを取得できませんでした</div>
                <div className={styles.errorDesc}>{NETWORK_ERROR_MESSAGE}</div>
                <button
                  className={styles.btnRetry}
                  onClick={() => setMembersAttempt(attempt => attempt + 1)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                  </svg>
                  再読み込み
                </button>
              </div>
            ) : (
              <table className={styles.memberTable}>
                <thead>
                  <tr>
                    <th style={{ width: '44%' }}>メンバー</th>
                    <th style={{ width: '20%' }}>ロール</th>
                    <th style={{ width: '36%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(member => {
                    const adminCount = members.filter(m => m.role === 'admin').length;
                    // 自分の離脱は、ほかに管理者がいるときだけできる（仕様書3-4）
                    const canLeave = !(member.isMe && member.role === 'admin' && adminCount <= 1);
                    const editedRole = roleEdits[member.id];
                    const hasRoleChange = editedRole !== undefined && editedRole !== member.role;
                    const isSavingRole = savingRoleMemberIds.includes(member.id);

                    return (
                      <tr key={member.id}>
                        <td>
                          <div className={styles.memberName}>
                            {member.displayName}
                            {member.isMe && <span className={styles.youBadge}>あなた</span>}
                          </div>
                          <div className={styles.memberEmail}>{member.email}</div>
                        </td>
                        <td>
                          {/* 管理者自身のロールは変更できない（仕様書4-6） */}
                          {member.isMe && member.role === 'admin' ? (
                            <span className={`${styles.rolePill} ${styles.roleAdmin}`}>管理者</span>
                          ) : (
                            <div className={styles.roleCell}>
                              {/* 選んだだけでは保存せず、元と違うロールを選んだときだけ「保存」を出す（仕様書4-6） */}
                              <select
                                className={styles.roleSelect}
                                value={editedRole ?? member.role}
                                onChange={(e) => {
                                  const role = e.target.value as ApiRole;
                                  setRoleEdits(prev => ({ ...prev, [member.id]: role }));
                                }}
                                disabled={isSavingRole}
                              >
                                <option value="admin">{ROLE_LABELS.admin}</option>
                                <option value="tester">{ROLE_LABELS.tester}</option>
                                <option value="viewer">{ROLE_LABELS.viewer}</option>
                              </select>
                              {hasRoleChange && (
                                <button
                                  className={`${styles.btnMini} ${styles.btnMiniPrimary}`}
                                  value={member.id}
                                  onClick={handleSaveRole}
                                  disabled={isSavingRole}
                                >
                                  {isSavingRole ? '保存中...' : '保存'}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className={styles.memberActions}>
                          {member.isMe ? (
                            <button
                              className={styles.btnMini}
                              onClick={() => setIsLeaveModalOpen(true)}
                              disabled={!canLeave}
                              title={!canLeave ? '他に管理者がいないため離脱できません' : undefined}
                            >
                              離脱
                            </button>
                          ) : (
                            <button
                              className={`${styles.btnMini} ${styles.btnMiniDanger}`}
                              onClick={() => setRemoveTarget(member)}
                            >
                              削除
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* プロジェクト終了 */}
          <div className={`${styles.card} ${styles.settingsSection} ${styles.settingsDanger}`}>
            <div className={styles.settingsSectionTitle}>プロジェクト終了</div>
            <p className={styles.settingsDangerText}>
              終了すると更新系の操作（ファイル読込・メンバー変更など）ができなくなります。
              <br />
              データは削除されず、閲覧専用になります。
            </p>
            <button
              className={styles.btnDanger}
              onClick={() => setIsTerminateModalOpen(true)}
            >
              プロジェクトを終了
            </button>
          </div>
        </>
      )}

      {/* ===== 行メニュー（管理者・テスターのみ） ===== */}
      {rowMenuFile && canEdit && (
        <div
          ref={rowMenuRef}
          className={styles.rowMenu}
          style={{ top: rowMenuPosition.top, left: rowMenuPosition.left }}
        >
          <div className={styles.rowMenuItem} onClick={handleUnregisterClick}>
            登録を取り消す
          </div>
        </div>
      )}

      {/* ===== 登録取消確認モーダル ===== */}
      {cancelConfirmFile && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            // 通信中は閉じない（メンバー削除と同じ）
            if (!isUnregistering) {
              setCancelConfirmFile(null);
            }
          }}
        >
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>登録を取り消しますか？</div>
            <p className={styles.modalDesc}>この操作は取り消すことができません。よろしいですか？</p>
            <div className={styles.modalTarget}>
              対象ファイル: <b>{cancelConfirmFile.fileName}</b>
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.btnMini}
                onClick={() => setCancelConfirmFile(null)}
                disabled={isUnregistering}
              >
                キャンセル
              </button>
              <button
                className={styles.btnDanger}
                onClick={handleConfirmUnregister}
                disabled={isUnregistering}
              >
                {isUnregistering ? '取り消し中...' : '登録を取り消す'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 登録取消不可モーダル ===== */}
      {cancelBlockedFile && (
        <div
          className={styles.modalOverlay}
          onClick={() => setCancelBlockedFile(null)}
        >
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>登録を取り消せません</div>
            <p className={styles.modalDesc}>このファイルには更新履歴が存在するため、登録を取り消せません。</p>
            <div className={styles.modalTarget}>
              対象ファイル: <b>{cancelBlockedFile.fileName}</b>
            </div>
            <div className={styles.modalActions}>
              <button
                className={`${styles.btnMini} ${styles.btnMiniPrimary}`}
                onClick={() => setCancelBlockedFile(null)}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== プロジェクト作成モーダル ===== */}
      {isCreateProjectModalOpen && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            // 作成の通信中は閉じない。閉じた後に作成が完了して、画面が切り替わるのを避けるため
            if (!isCreatingProject) {
              closeCreateProjectModal();
            }
          }}
        >
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>新規プロジェクトを作成</div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabelSm}>プロジェクト名</label>
              {/* maxLengthは付けない。超えた分が黙って切り捨てられるより、エラーで伝える方が分かりやすいため */}
              <input
                type="text"
                placeholder="プロジェクト名を入力"
                value={newProjectName}
                onChange={(e) => {
                  setNewProjectName(e.target.value);
                  if (newProjectNameError) {
                    setNewProjectNameError(null);
                  }
                }}
                className={newProjectNameError ? styles.inputError : ''}
              />
              {newProjectNameError && (
                <div className={styles.fieldErrorSm}>{newProjectNameError}</div>
              )}
            </div>

            <div className={styles.modalActions}>
              <button
                className={styles.btnMini}
                onClick={closeCreateProjectModal}
                disabled={isCreatingProject}
              >
                キャンセル
              </button>
              <button
                className={`${styles.btnMini} ${styles.btnMiniPrimary}`}
                onClick={handleCreateProject}
                disabled={isCreatingProject}
              >
                {isCreatingProject ? '作成中...' : '作成'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== メンバー追加モーダル ===== */}
      {isAddMemberModalOpen && (
        <div className={styles.modalOverlay} onClick={closeAddMemberModal}>
          <div
            className={`${styles.modalBox} ${styles.modalBoxWide}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalTitle}>メンバーを追加</div>

            <div className={styles.memberSearchBox}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                placeholder="氏名またはメールアドレスで検索"
                value={memberSearchQuery}
                onChange={(e) => {
                  // 検索語が変わったら前の結果を捨てる。入力し直して同じ語に戻したとき、前の結果（失敗の表示など）を
                  // 出さずに「検索中」から検索し直すため。空白を足しただけなど検索語が同じなら、結果はそのまま
                  if (e.target.value.trim() !== memberSearchTerm) {
                    setMemberSearchResult(null);
                  }
                  setMemberSearchQuery(e.target.value);
                }}
              />
            </div>

            {!memberSearchTerm ? (
              <div className={styles.searchHint}>
                氏名またはメールアドレスを入力すると、候補が表示されます。
              </div>
            ) : currentSearchResult === null ? (
              <div className={styles.searchHint}>検索中…</div>
            ) : currentSearchResult.results === null ? (
              <div className={`${styles.searchHint} ${styles.searchHintError}`}>
                検索できませんでした。入力し直すと、もう一度検索します。
              </div>
            ) : currentSearchResult.results.length === 0 ? (
              <div className={styles.searchHint}>該当するユーザーが見つかりません</div>
            ) : (
              <div className={styles.resultList}>
                {currentSearchResult.results.map(user => (
                  <div
                    key={user.userId}
                    className={`${styles.resultRow} ${user.alreadyJoined ? styles.resultRowJoined : ''}`}
                  >
                    <div className={styles.resultInfo}>
                      <div className={styles.resultName}>{user.displayName}</div>
                      <div className={styles.resultEmail}>{user.email}</div>
                    </div>
                    {user.alreadyJoined ? (
                      <div className={styles.joinedLabel}>参加済み</div>
                    ) : (
                      <button
                        className={styles.btnAddMember}
                        value={user.userId}
                        onClick={handleAddMember}
                        disabled={addingUserIds.includes(user.userId)}
                      >
                        {addingUserIds.includes(user.userId) ? '追加中...' : '追加'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className={styles.modalRoleNote}>
              追加されたメンバーは自動的に「テスター」としてプロジェクトに参加します。ロールは追加後にメンバー一覧から変更できます。
            </div>

            <div className={styles.modalActions}>
              <button
                className={`${styles.btnMini} ${styles.btnMiniPrimary}`}
                onClick={closeAddMemberModal}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== メンバー削除の確認モーダル（仕様書4-6） ===== */}
      {removeTarget && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            // 通信中は閉じない（プロジェクト終了と同じ）
            if (!isRemovingMember) {
              setRemoveTarget(null);
            }
          }}
        >
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>メンバーを削除しますか？</div>
            <p className={styles.modalDesc}>
              このプロジェクトから外します。アカウント自体は削除されず、あとから追加し直せます。
            </p>
            <div className={styles.modalTarget}>
              対象メンバー: <b>{removeTarget.displayName}</b>（{removeTarget.email}）
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.btnMini}
                onClick={() => setRemoveTarget(null)}
                disabled={isRemovingMember}
              >
                キャンセル
              </button>
              <button
                className={styles.btnDanger}
                onClick={handleRemoveMember}
                disabled={isRemovingMember}
              >
                {isRemovingMember ? '削除中...' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 離脱の確認モーダル（仕様書4-6） ===== */}
      {isLeaveModalOpen && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            if (!isLeaving) {
              setIsLeaveModalOpen(false);
            }
          }}
        >
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>プロジェクトから離脱しますか？</div>
            <p className={styles.modalDesc}>
              離脱すると、このプロジェクトを表示できなくなります。戻るには、ほかの管理者に追加してもらう必要があります。
            </p>
            <div className={styles.modalTarget}>
              対象プロジェクト: <b>{activeProject?.name}</b>
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.btnMini}
                onClick={() => setIsLeaveModalOpen(false)}
                disabled={isLeaving}
              >
                キャンセル
              </button>
              <button
                className={styles.btnDanger}
                onClick={handleLeaveProject}
                disabled={isLeaving}
              >
                {isLeaving ? '離脱中...' : '離脱する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== プロジェクト終了確認モーダル ===== */}
      {isTerminateModalOpen && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            // 通信中は閉じない。閉じた後に終了が完了して、画面が切り替わるのを避けるため
            if (!isArchivingProject) {
              setIsTerminateModalOpen(false);
            }
          }}
        >
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>プロジェクトを終了しますか？</div>
            <p className={styles.modalDesc}>
              終了後もデータは削除されず、閲覧専用になります。
            </p>
            <div className={styles.modalTarget}>
              対象プロジェクト: <b>{activeProject?.name}</b>
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.btnMini}
                onClick={() => setIsTerminateModalOpen(false)}
                disabled={isArchivingProject}
              >
                キャンセル
              </button>
              <button
                className={styles.btnDanger}
                onClick={handleArchiveProject}
                disabled={isArchivingProject}
              >
                {isArchivingProject ? '終了中...' : 'プロジェクトを終了'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== ファイル読込モーダル（管理者・テスターのみ） ===== */}
      {isUploadModalOpen && canEdit && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            // 解析中・実行中は閉じない（結果を受け取れる状態のまま待つ）
            if (!isPreviewing && !isCommitting) {
              closeUploadModal();
            }
          }}
        >
          <div
            className={`${styles.modalBox} ${styles.modalBoxWide}`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ===== 選択ビュー ===== */}
            {uploadView === 'select' && (
              <div>
                <div className={styles.modalTitle}>テストファイルを読み込む</div>

                {isPreviewing ? (
                  <div className={`${styles.loadingCard} ${styles.sectionState}`}>
                    <div className={styles.spinner}></div>
                    <div className={styles.loadingText}>ファイルを解析しています…</div>
                  </div>
                ) : (
                <div
                  className={`${styles.dropzone} ${isDragOver ? styles.dropzoneDragover : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragOver(false);
                    if (e.dataTransfer.files.length > 0) {
                      handleFilesSelected(e.dataTransfer.files);
                    }
                  }}
                >
                  <div className={styles.dropzoneIcon}>
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 14.9A5 5 0 0 1 6 5.3 6 6 0 0 1 17 6a4.5 4.5 0 0 1 1 8.9"></path>
                      <polyline points="9 15 12 12 15 15"></polyline>
                      <line x1="12" y1="12" x2="12" y2="21"></line>
                    </svg>
                  </div>
                  <div className={styles.dropzoneText}>ここにファイルをドラッグ&ドロップ</div>
                  <div className={styles.dropzoneText}>
                    または <span className={styles.dropzoneLink}>ファイルを選択</span>
                  </div>
                  <div className={styles.dropzoneSub}>複数ファイルを一括で選択できます</div>
                </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFilesSelected(e.target.files);
                    }
                  }}
                />

                <div className={styles.uploadNote}>
                  対応形式: .xlsx, .xls。同名ファイルは既存ファイルの更新として扱われます。
                </div>

                <div className={styles.modalActions}>
                  <button className={styles.btnMini} onClick={closeUploadModal} disabled={isPreviewing}>
                    キャンセル
                  </button>
                </div>
              </div>
            )}

            {/* ===== 確認ビュー ===== */}
            {uploadView === 'confirm' && (
              <div>
                <div className={styles.modalTitle}>読み込み内容の確認</div>
                <p className={styles.modalDesc}>以下の内容でファイルを読み込みます。</p>

                <div className={styles.confirmList}>
                  {previewFiles.map((f, i) => (
                    <div key={i} className={styles.confirmRow}>
                      <div className={styles.confirmRowTop}>
                        <div className={styles.confirmFileName}>{f.fileName}</div>
                        {f.operation === 'create' && (
                          <span className={`${styles.confirmBadge} ${styles.confirmBadgeNew}`}>新規</span>
                        )}
                        {f.operation === 'update' && (
                          <span className={`${styles.confirmBadge} ${styles.confirmBadgeUpdate}`}>更新</span>
                        )}
                        {f.operation === 'error' && (
                          <span className={`${styles.confirmBadge} ${styles.confirmBadgeError}`}>エラー</span>
                        )}
                      </div>
                      {f.operation === 'create' && (
                        <div className={styles.confirmDetailRow}>
                          <span>進捗: {formatProgress(f.newProgressRate)}</span>
                          <span className={styles.confirmSep}></span>
                          <span>新規ファイルとして登録されます</span>
                        </div>
                      )}
                      {f.operation === 'update' && (
                        <div className={styles.confirmDetailRow}>
                          <span>進捗: {formatProgress(f.currentProgressRate)} → {formatProgress(f.newProgressRate)}</span>
                          <span className={styles.confirmSep}></span>
                          <span>
                            最終更新: {f.updatedAt ? DATE_TIME_FORMAT_JST.format(new Date(f.updatedAt)) : '—'} {f.lastUpdatedBy}
                          </span>
                        </div>
                      )}
                      {f.operation === 'error' && f.errorMessage && (
                        <div className={styles.confirmErrorReason}>{f.errorMessage}</div>
                      )}
                    </div>
                  ))}
                </div>

                {uploadErrorCount > 0 && uploadValidCount === 0 && (
                  <div className={`${styles.confirmSummary} ${styles.confirmSummaryAllError}`}>
                    {ALL_FILES_ERROR_MESSAGE}
                  </div>
                )}
                {uploadErrorCount > 0 && uploadValidCount > 0 && (
                  <div className={`${styles.confirmSummary} ${styles.confirmSummaryHasError}`}>
                    エラーの{uploadErrorCount}件はスキップされ、正常な{uploadValidCount}件のみ読み込まれます。
                  </div>
                )}

                <div className={styles.modalActions}>
                  <button className={styles.btnMini} onClick={resetUploadSelection} disabled={isCommitting}>
                    ファイルを選び直す
                  </button>
                  <button
                    className={`${styles.btnMini} ${styles.btnMiniPrimary}`}
                    disabled={uploadValidCount === 0 || isCommitting}
                    onClick={handleExecuteImport}
                  >
                    {isCommitting
                      ? '読み込み中...'
                      : uploadValidCount === 0 ? 'この内容で読み込む' : (uploadErrorCount > 0 ? `正常な${uploadValidCount}件を読み込む` : 'この内容で読み込む')}
                  </button>
                </div>
              </div>
            )}

            {/* ===== 結果ビュー ===== */}
            {uploadView === 'result' && (
              <div>
                <div className={styles.modalTitle}>読み込み結果</div>
                {/* 要約は確認画面（仕様書6-6）と同じく、エラーなし・一部エラー・全件エラーで分ける */}
                {uploadFailCount === 0 && (
                  <p className={styles.modalDesc}>{uploadSuccessCount}件のファイルを読み込みました。</p>
                )}
                {uploadFailCount > 0 && uploadSuccessCount > 0 && (
                  <div className={`${styles.confirmSummary} ${styles.confirmSummaryHasError}`}>
                    {uploadSuccessCount}件を読み込みました。{uploadFailCount}件は登録／更新されていません。
                  </div>
                )}
                {uploadFailCount > 0 && uploadSuccessCount === 0 && (
                  <div className={`${styles.confirmSummary} ${styles.confirmSummaryAllError}`}>
                    すべてのファイルが登録／更新されていません。
                  </div>
                )}

                <div className={styles.confirmList}>
                  {uploadResults.map((f, i) => (
                    <div key={i} className={styles.confirmRow}>
                      <div className={styles.confirmRowTop}>
                        <div className={styles.confirmFileName}>{f.fileName}</div>
                        {f.result === 'success' && (
                          <span className={`${styles.confirmBadge} ${styles.confirmBadgeSuccess}`}>成功</span>
                        )}
                        {f.result === 'error' && (
                          <span className={`${styles.confirmBadge} ${styles.confirmBadgeError}`}>エラー</span>
                        )}
                      </div>
                      {f.result === 'success' && (
                        <div className={styles.confirmDetail}>
                          {f.operation === 'create' ? '新規登録' : '更新完了'}
                        </div>
                      )}
                      {/* 楽観ロックの競合も、理由の文言が違うだけで、ほかのエラーと同じ表示（仕様書8-1） */}
                      {f.result === 'error' && f.errorMessage && (
                        <div className={styles.confirmErrorReason}>{f.errorMessage}</div>
                      )}
                    </div>
                  ))}
                </div>

                <div className={styles.modalActions}>
                  <button className={styles.btnMini} onClick={resetUploadSelection}>
                    ファイルを再選択
                  </button>
                  <button
                    className={`${styles.btnMini} ${styles.btnMiniPrimary}`}
                    onClick={closeUploadModal}
                  >
                    閉じる
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {toast && (
        <Toast key={toast.id} message={toast.message} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

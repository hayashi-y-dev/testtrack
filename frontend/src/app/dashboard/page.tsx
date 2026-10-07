'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiGet, apiPost, NETWORK_ERROR_MESSAGE } from '@/lib/api';
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

// プロジェクト詳細（切替時に取得する最新のロールと進捗サマリー）
type ProjectDetail = {
  id: string;
  name: string;
  role: Role;
  progressSummary: ProgressSummary;
};

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

const PROJECT_NAME_MAX_LENGTH = 50;

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

type FileData = {
  id: string;
  name: string;
  progress: number | null;
  updatedAt: string;
  updatedBy: string;
  hasHistory: boolean;
};

type UploadFile = {
  name: string;
  status: 'new' | 'update' | 'error';
  before?: number;
  after?: number;
  updated?: string;
  updater?: string;
  reason?: string;
  resultStatus?: 'success' | 'conflict' | 'error';
};

// テストファイル一覧の仮データ。プロジェクトIDが実際のUUIDになったため、
// 結合5（テストファイルAPIとの結合）までは、どのプロジェクトでも同じ仮データを表示する
const MOCK_FILES: FileData[] = [
  { id: '1', name: 'EC機能テスト仕様書_v2.3.xlsx', progress: 95, updatedAt: '2026/08/30 18:42', updatedBy: '田中 美咲', hasHistory: true },
  { id: '2', name: 'EC_API結合テスト仕様書_v1.5.xlsx', progress: 88, updatedAt: '2026/08/29 14:15', updatedBy: '山田 太郎', hasHistory: true },
  { id: '3', name: 'EC_決済フロー検証テスト_v1.0.xlsx', progress: 72, updatedAt: '2026/08/28 11:07', updatedBy: '鈴木 健一', hasHistory: true },
  { id: '4', name: 'EC_管理画面テスト仕様書_v3.1.xlsx', progress: 41, updatedAt: '2026/08/27 16:30', updatedBy: '佐藤 花子', hasHistory: true },
  { id: '5', name: 'EC_レスポンシブUI確認テスト_詳細版_v2.0.xlsx', progress: 0, updatedAt: '2026/08/25 09:20', updatedBy: '高橋 裕子', hasHistory: false },
];

const MOCK_MEMBERS = [
  { id: '1', name: '佐藤 花子', email: 'hanako.sato@example.com', role: '管理者' as const, isCurrentUser: true },
  { id: '2', name: '田中 美咲', email: 'misaki.tanaka@example.com', role: 'テスター' as const, isCurrentUser: false },
  { id: '3', name: '山田 太郎', email: 'taro.yamada@example.com', role: 'テスター' as const, isCurrentUser: false },
  { id: '4', name: '鈴木 健一', email: 'kenichi.suzuki@example.com', role: 'テスター' as const, isCurrentUser: false },
  { id: '5', name: '高橋 裕子', email: 'yuko.takahashi@example.com', role: '閲覧者' as const, isCurrentUser: false },
];

// 検索対象の全ユーザー（仮データ）
const ALL_USERS = [
  { id: '1', name: '佐藤 花子', email: 'hanako.sato@example.com' },
  { id: '2', name: '田中 美咲', email: 'misaki.tanaka@example.com' },
  { id: '3', name: '山田 太郎', email: 'taro.yamada@example.com' },
  { id: '4', name: '鈴木 健一', email: 'kenichi.suzuki@example.com' },
  { id: '5', name: '高橋 裕子', email: 'yuko.takahashi@example.com' },
  { id: '6', name: '伊藤 直樹', email: 'naoki.ito@example.com' },
  { id: '7', name: '中村 恵', email: 'megumi.nakamura@example.com' },
  { id: '8', name: '渡辺 淳', email: 'jun.watanabe@example.com' },
  { id: '9', name: '小林 真一', email: 'shinichi.kobayashi@example.com' },
  { id: '10', name: '加藤 由美', email: 'yumi.kato@example.com' },
];

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
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // id は、同じ文言を続けて通知したときにもトーストを作り直して表示時間をやり直すために使う
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSegment, setFilterSegment] = useState<'all' | 'incomplete' | 'complete'>('all');
  const [displayLimit, setDisplayLimit] = useState<5 | 10 | 'all'>(5);
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileData[]>([]);

  // 終了済みプロジェクト関連
  const [viewingArchivedProject, setViewingArchivedProject] = useState<ArchivedProject | null>(null);
  const [isArchivedMenuOpen, setIsArchivedMenuOpen] = useState(false);
  // 終了済みメニューの表示位置。描画中にrefを読まないよう、開くときにボタンの位置から計算して持つ
  const [archivedMenuPosition, setArchivedMenuPosition] = useState({ top: 0, right: 0 });
  const archivedMenuRef = useRef<HTMLDivElement>(null);
  const archivedFilterRef = useRef<HTMLDivElement>(null);

  // プロジェクト設定
  const [members, setMembers] = useState(MOCK_MEMBERS);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState('');
  const [memberRoleEdits, setMemberRoleEdits] = useState<Record<string, Role>>({});

  // モーダル
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectNameError, setNewProjectNameError] = useState<string | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [isTerminateModalOpen, setIsTerminateModalOpen] = useState(false);

  // 行メニュー（登録取消用）
  const [rowMenuFile, setRowMenuFile] = useState<FileData | null>(null);
  const [rowMenuPosition, setRowMenuPosition] = useState({ top: 0, left: 0 });
  const [cancelConfirmFile, setCancelConfirmFile] = useState<FileData | null>(null);
  const [cancelBlockedFile, setCancelBlockedFile] = useState<FileData | null>(null);

  // ファイル読込モーダル
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadView, setUploadView] = useState<'select' | 'confirm' | 'result'>('select');
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
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

  // 詳細を表示する対象。終了済みを閲覧中はそのプロジェクト、それ以外は選択中のタブ
  const detailTargetId = viewingArchivedProject?.id ?? activeProjectId;

  // プロジェクトから外された場合など。一覧を取り直して先頭の進行中プロジェクトへ移り、一時的に通知する
  // （仕様書4-8「権限のない画面へアクセスした場合」の扱いに準じる）
  const handleProjectNotFound = useCallback((messages: string[]) => {
    setToast({ id: Date.now(), message: messages[0] ?? PROJECT_NOT_FOUND_MESSAGE });
    // 取り直した一覧の先頭が、以前に表示していたプロジェクトでも、古い取得結果を使わず読み込み直す
    setDetailResult(null);
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
        const { data } = result;
        setDetailResult({
          projectId: detailTargetId,
          attempt: detailAttempt,
          detail: {
            id: data.id,
            name: data.name,
            role: ROLE_LABELS[data.myRole],
            progressSummary: data.progressSummary,
          },
        });
        // ファイル一覧は結合5まで仮データ。ファイル0件のプロジェクトでは、一覧の空状態（仕様書5-5）が出るよう空にする
        setFiles(data.progressSummary.fileCount > 0 ? MOCK_FILES : []);
      } else if (result.status === 401) {
        router.replace('/login');
      } else if (result.status === 404) {
        handleProjectNotFound(result.messages);
      } else {
        setDetailResult({ projectId: detailTargetId, attempt: detailAttempt, detail: null });
      }
    });

    return () => {
      ignore = true;
    };
  }, [detailTargetId, detailAttempt, router, handleProjectNotFound]);

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

  // ロールに応じた権限（終了済みプロジェクト閲覧中は全て無効）
  const canManage = !isViewingArchived && currentRole === '管理者';
  const canEdit = !isViewingArchived && (currentRole === '管理者' || currentRole === 'テスター');

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
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggingId(null);
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

  const filteredFiles = files.filter((file: FileData) => {
    if (searchQuery && !file.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    // progressがnullの場合は「すべて」のみ表示
    if (file.progress === null) {
      return filterSegment === 'all';
    }
    if (filterSegment === 'incomplete' && file.progress === 100) {
      return false;
    }
    if (filterSegment === 'complete' && file.progress < 100) {
      return false;
    }
    return true;
  });

  const displayedFiles = displayLimit === 'all'
    ? filteredFiles
    : filteredFiles.slice(0, displayLimit);

  const displayLimitLabel = displayLimit === 'all' ? 'すべて' : `最新${displayLimit}件`;

  // 閲覧者以外の場合、アクション列の幅を考慮した列幅
  const effectiveColumnWidths = canEdit
    ? columnWidths
    : [40, 22, 19, 19];

  // 行メニュー
  const handleRowMenuClick = (e: React.MouseEvent, file: FileData) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setRowMenuPosition({ top: rect.bottom + 4, left: rect.right - 160 });
    setRowMenuFile(rowMenuFile?.id === file.id ? null : file);
  };

  const handleUnregisterClick = () => {
    if (!rowMenuFile) return;
    setRowMenuFile(null);

    if (rowMenuFile.hasHistory) {
      setCancelBlockedFile(rowMenuFile);
    } else {
      setCancelConfirmFile(rowMenuFile);
    }
  };

  const confirmUnregister = () => {
    if (cancelConfirmFile) {
      setFiles(prev => prev.filter(f => f.id !== cancelConfirmFile.id));
    }
    setCancelConfirmFile(null);
  };

  // ファイル読込モーダル
  const existingFileNames = files.map(f => f.name);

  const handleFilesSelected = (fileList: FileList) => {
    const selected = Array.from(fileList).map(f => {
      const validExt = /\.(xlsx|xls)$/i.test(f.name);
      const isUpdate = existingFileNames.includes(f.name);
      const existingFile = files.find(ef => ef.name === f.name);

      const item: UploadFile = {
        name: f.name,
        status: !validExt ? 'error' : (isUpdate ? 'update' : 'new'),
      };

      if (item.status === 'update' && existingFile) {
        const currentProgress = existingFile.progress ?? 0;
        item.before = currentProgress;
        item.after = Math.min(100, currentProgress + 5 + Math.floor(Math.random() * 10));
        item.updated = existingFile.updatedAt;
        item.updater = existingFile.updatedBy;
      }
      if (item.status === 'error') {
        item.reason = '対応外の拡張子です（.xlsx / .xls のみ対応）';
      }
      return item;
    });

    selected.sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true, sensitivity: 'base' }));
    setUploadFiles(selected);
    setUploadView('confirm');
  };

  const executeImport = () => {
    let conflictAssigned = false;
    const results = uploadFiles.map(f => {
      if (f.status === 'error') {
        return { ...f, resultStatus: 'error' as const };
      }
      if (f.status === 'update' && !conflictAssigned && f.name === 'EC機能テスト仕様書_v2.3.xlsx') {
        conflictAssigned = true;
        return { ...f, resultStatus: 'conflict' as const };
      }
      return { ...f, resultStatus: 'success' as const };
    });

    setUploadFiles(results);
    setUploadView('result');
  };

  const closeUploadModal = () => {
    setIsUploadModalOpen(false);
    setUploadView('select');
    setUploadFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
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

  const uploadErrorCount = uploadFiles.filter(f => f.status === 'error').length;
  const uploadValidCount = uploadFiles.length - uploadErrorCount;
  const uploadSuccessCount = uploadFiles.filter(f => f.resultStatus === 'success').length;
  const uploadFailCount = uploadFiles.length - uploadSuccessCount;

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
            className={`${styles.userMenu} ${isUserMenuOpen ? styles.userMenuOpen : ''}`}
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
          >
            <span className={styles.userMenuName}>佐藤 花子</span>
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
            onClick={() => setActiveNav('settings')}
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
                    className={`${styles.segment} ${filterSegment === 'incomplete' ? styles.segmentActive : ''}`}
                    onClick={() => setFilterSegment('incomplete')}
                  >
                    未実施あり
                  </div>
                  <div
                    className={`${styles.segment} ${filterSegment === 'complete' ? styles.segmentActive : ''}`}
                    onClick={() => setFilterSegment('complete')}
                  >
                    全件実施済み
                  </div>
                </div>
                <div className={styles.sortBoxWrap}>
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
                        最新5件
                      </div>
                      <div
                        className={styles.sortMenuItem}
                        onClick={() => { setDisplayLimit(10); setIsSortMenuOpen(false); }}
                      >
                        最新10件
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

              {displayedFiles.length > 0 ? (
                <table className={styles.filesTable} ref={tableRef}>
                  <thead>
                    <tr>
                      <th style={{ width: `${effectiveColumnWidths[0]}%` }}>
                        ファイル名
                        <div
                          className={styles.resizeHandle}
                          onMouseDown={(e) => handleResizeStart(0, e)}
                        />
                      </th>
                      <th style={{ width: `${effectiveColumnWidths[1]}%` }}>
                        進捗
                        <div
                          className={styles.resizeHandle}
                          onMouseDown={(e) => handleResizeStart(1, e)}
                        />
                      </th>
                      <th style={{ width: `${effectiveColumnWidths[2]}%` }}>
                        最終更新
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
                    {displayedFiles.map(file => (
                      <tr key={file.id}>
                        <td>
                          <div className={styles.fileCell}>
                            <div className={styles.fileName}>{file.name}</div>
                          </div>
                        </td>
                        <td>
                          <div className={styles.progWrap}>
                            {file.progress !== null ? (
                              <>
                                <div className={styles.progBar}>
                                  <span style={{
                                    width: `${file.progress}%`,
                                    background: file.progress === 0 ? 'var(--border)' : undefined
                                  }}></span>
                                </div>
                                <div
                                  className={styles.progPct}
                                  style={{ color: file.progress === 0 ? 'var(--text-faint)' : undefined }}
                                >
                                  {file.progress}%
                                </div>
                              </>
                            ) : (
                              <span className={styles.progDash}>—</span>
                            )}
                          </div>
                        </td>
                        <td><div className={styles.metaText}>{file.updatedAt}</div></td>
                        <td><div className={styles.metaName}>{file.updatedBy}</div></td>
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
              ) : (
                <div className={styles.filesEmpty}>
                  {searchQuery ? '検索条件に一致するファイルがありません' : '登録されているテストファイルはありません'}
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

            <div className={styles.settingsRow}>
              <div className={styles.settingsLabel}>プロジェクト名</div>
              {!isEditingName ? (
                <div className={styles.settingsValue}>
                  <span>{activeProject?.name}</span>
                  <span
                    className={styles.editIcon}
                    onClick={() => {
                      setEditingNameValue(activeProject?.name || '');
                      setIsEditingName(true);
                    }}
                  >
                    ✎
                  </span>
                </div>
              ) : (
                <div className={styles.settingsValueEdit}>
                  <input
                    type="text"
                    value={editingNameValue}
                    onChange={(e) => setEditingNameValue(e.target.value)}
                    maxLength={50}
                  />
                  <button
                    className={`${styles.btnMini} ${styles.btnMiniPrimary}`}
                    onClick={() => {
                      if (editingNameValue.trim() && activeProject) {
                        setProjects(prev => prev.map(p =>
                          p.id === activeProject.id ? { ...p, name: editingNameValue.trim() } : p
                        ));
                      }
                      setIsEditingName(false);
                    }}
                  >
                    保存
                  </button>
                  <button
                    className={styles.btnMini}
                    onClick={() => setIsEditingName(false)}
                  >
                    キャンセル
                  </button>
                </div>
              )}
            </div>

            <div className={styles.settingsRow}>
              <div className={styles.settingsLabel}>ステータス</div>
              <div className={styles.settingsValue}>
                <span className={styles.statusPill}>進行中</span>
              </div>
            </div>

            <div className={styles.settingsRow}>
              <div className={styles.settingsLabel}>参加メンバー数</div>
              <div className={styles.settingsValue}>{members.length}名</div>
            </div>

            <div className={`${styles.settingsRow} ${styles.settingsRowLast}`}>
              <div className={styles.settingsLabel}>作成日</div>
              <div className={styles.settingsValue}>2026年3月15日</div>
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
                  const editedRole = memberRoleEdits[member.id];
                  const hasRoleChange = editedRole && editedRole !== member.role;
                  const adminCount = members.filter(m => m.role === '管理者').length;
                  const canLeave = !(member.isCurrentUser && member.role === '管理者' && adminCount <= 1);

                  return (
                    <tr key={member.id}>
                      <td>
                        <div className={styles.memberName}>
                          {member.name}
                          {member.isCurrentUser && <span className={styles.youBadge}>あなた</span>}
                        </div>
                        <div className={styles.memberEmail}>{member.email}</div>
                      </td>
                      <td>
                        {member.isCurrentUser && member.role === '管理者' ? (
                          <span className={`${styles.rolePill} ${styles.roleAdmin}`}>管理者</span>
                        ) : (
                          <div className={styles.roleCell}>
                            <select
                              className={styles.roleSelect}
                              value={editedRole || member.role}
                              onChange={(e) => setMemberRoleEdits(prev => ({
                                ...prev,
                                [member.id]: e.target.value as Role
                              }))}
                            >
                              <option value="管理者">管理者</option>
                              <option value="テスター">テスター</option>
                              <option value="閲覧者">閲覧者</option>
                            </select>
                            {hasRoleChange && (
                              <button
                                className={`${styles.btnMini} ${styles.btnMiniPrimary}`}
                                onClick={() => {
                                  setMembers(prev => prev.map(m =>
                                    m.id === member.id ? { ...m, role: editedRole } : m
                                  ));
                                  setMemberRoleEdits(prev => {
                                    const next = { ...prev };
                                    delete next[member.id];
                                    return next;
                                  });
                                }}
                              >
                                保存
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className={styles.memberActions}>
                        {member.isCurrentUser ? (
                          <button
                            className={styles.btnMini}
                            disabled={!canLeave}
                            title={!canLeave ? '他に管理者がいないため離脱できません' : undefined}
                          >
                            離脱
                          </button>
                        ) : (
                          <button className={`${styles.btnMini} ${styles.btnMiniDanger}`}>
                            削除
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
          onClick={() => setCancelConfirmFile(null)}
        >
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>登録を取り消しますか？</div>
            <p className={styles.modalDesc}>この操作は取り消すことができません。よろしいですか？</p>
            <div className={styles.modalTarget}>
              対象ファイル: <b>{cancelConfirmFile.name}</b>
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.btnMini}
                onClick={() => setCancelConfirmFile(null)}
              >
                キャンセル
              </button>
              <button
                className={styles.btnDanger}
                onClick={confirmUnregister}
              >
                登録を取り消す
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
              対象ファイル: <b>{cancelBlockedFile.name}</b>
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
        <div
          className={styles.modalOverlay}
          onClick={() => {
            setIsAddMemberModalOpen(false);
            setMemberSearchQuery('');
          }}
        >
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
                onChange={(e) => setMemberSearchQuery(e.target.value)}
              />
            </div>

            {!memberSearchQuery.trim() ? (
              <div className={styles.searchHint}>
                氏名またはメールアドレスを入力すると、候補が表示されます。
              </div>
            ) : (
              <div className={styles.resultList}>
                {ALL_USERS
                  .filter(user => {
                    const query = memberSearchQuery.toLowerCase();
                    return user.name.toLowerCase().includes(query) ||
                           user.email.toLowerCase().includes(query);
                  })
                  .map(user => {
                    const isJoined = members.some(m => m.id === user.id);
                    return (
                      <div
                        key={user.id}
                        className={`${styles.resultRow} ${isJoined ? styles.resultRowJoined : ''}`}
                      >
                        <div className={styles.resultInfo}>
                          <div className={styles.resultName}>{user.name}</div>
                          <div className={styles.resultEmail}>{user.email}</div>
                        </div>
                        {isJoined ? (
                          <div className={styles.joinedLabel}>参加済み</div>
                        ) : (
                          <button
                            className={styles.btnAddMember}
                            onClick={() => {
                              setMembers(prev => [
                                ...prev,
                                {
                                  id: user.id,
                                  name: user.name,
                                  email: user.email,
                                  role: 'テスター' as const,
                                  isCurrentUser: false,
                                }
                              ]);
                            }}
                          >
                            追加
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}

            <div className={styles.modalRoleNote}>
              追加されたメンバーは自動的に「テスター」としてプロジェクトに参加します。ロールは追加後にメンバー一覧から変更できます。
            </div>

            <div className={styles.modalActions}>
              <button
                className={`${styles.btnMini} ${styles.btnMiniPrimary}`}
                onClick={() => {
                  setIsAddMemberModalOpen(false);
                  setMemberSearchQuery('');
                }}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== プロジェクト終了確認モーダル ===== */}
      {isTerminateModalOpen && (
        <div
          className={styles.modalOverlay}
          onClick={() => setIsTerminateModalOpen(false)}
        >
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>プロジェクトを終了しますか？</div>
            <p className={styles.modalDesc}>
              終了後もデータは削除されず、閲覧専用になります。
              <br />
              この操作は取り消せません。
            </p>
            <div className={styles.modalTarget}>
              対象プロジェクト: <b>{activeProject?.name}</b>
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.btnMini}
                onClick={() => setIsTerminateModalOpen(false)}
              >
                キャンセル
              </button>
              <button
                className={styles.btnDanger}
                onClick={() => {
                  setProjects(prev => prev.filter(p => p.id !== activeProjectId));
                  if (projects.length > 1) {
                    const remaining = projects.filter(p => p.id !== activeProjectId);
                    setActiveProjectId(remaining[0]?.id || '');
                  }
                  setIsTerminateModalOpen(false);
                  setActiveNav('dashboard');
                }}
              >
                プロジェクトを終了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== ファイル読込モーダル（管理者・テスターのみ） ===== */}
      {isUploadModalOpen && canEdit && (
        <div
          className={styles.modalOverlay}
          onClick={closeUploadModal}
        >
          <div
            className={`${styles.modalBox} ${styles.modalBoxWide}`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ===== 選択ビュー ===== */}
            {uploadView === 'select' && (
              <div>
                <div className={styles.modalTitle}>テストファイルを読み込む</div>

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
                  <button className={styles.btnMini} onClick={closeUploadModal}>
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
                  {uploadFiles.map((f, i) => (
                    <div key={i} className={styles.confirmRow}>
                      <div className={styles.confirmRowTop}>
                        <div className={styles.confirmFileName}>{f.name}</div>
                        {f.status === 'new' && (
                          <span className={`${styles.confirmBadge} ${styles.confirmBadgeNew}`}>新規</span>
                        )}
                        {f.status === 'update' && (
                          <span className={`${styles.confirmBadge} ${styles.confirmBadgeUpdate}`}>更新</span>
                        )}
                        {f.status === 'error' && (
                          <span className={`${styles.confirmBadge} ${styles.confirmBadgeError}`}>エラー</span>
                        )}
                      </div>
                      {f.status === 'new' && (
                        <div className={styles.confirmDetail}>新規ファイルとして登録されます</div>
                      )}
                      {f.status === 'update' && (
                        <div className={styles.confirmDetailRow}>
                          <span>進捗: {f.before}% → {f.after}%</span>
                          <span className={styles.confirmSep}></span>
                          <span>最終更新: {f.updated} {f.updater}</span>
                        </div>
                      )}
                      {f.status === 'error' && (
                        <div className={styles.confirmErrorReason}>{f.reason}</div>
                      )}
                    </div>
                  ))}
                </div>

                {uploadErrorCount > 0 && uploadValidCount === 0 && (
                  <div className={`${styles.confirmSummary} ${styles.confirmSummaryAllError}`}>
                    すべてのファイルがエラーのため読み込めません。
                  </div>
                )}
                {uploadErrorCount > 0 && uploadValidCount > 0 && (
                  <div className={`${styles.confirmSummary} ${styles.confirmSummaryHasError}`}>
                    エラーの{uploadErrorCount}件はスキップされ、正常な{uploadValidCount}件のみ読み込まれます。
                  </div>
                )}

                <div className={styles.modalActions}>
                  <button
                    className={styles.btnMini}
                    onClick={() => {
                      setUploadView('select');
                      setUploadFiles([]);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                  >
                    ファイルを選び直す
                  </button>
                  <button
                    className={`${styles.btnMini} ${styles.btnMiniPrimary}`}
                    disabled={uploadValidCount === 0}
                    onClick={executeImport}
                  >
                    {uploadValidCount === 0 ? 'この内容で読み込む' : (uploadErrorCount > 0 ? `正常な${uploadValidCount}件を読み込む` : 'この内容で読み込む')}
                  </button>
                </div>
              </div>
            )}

            {/* ===== 結果ビュー ===== */}
            {uploadView === 'result' && (
              <div>
                <div className={styles.modalTitle}>読み込み結果</div>
                <p className={styles.modalDesc}>
                  {uploadFailCount === 0
                    ? `${uploadSuccessCount}件のファイルを読み込みました。`
                    : `${uploadSuccessCount}件を読み込みました。${uploadFailCount}件は登録/更新されていません。`
                  }
                </p>

                <div className={styles.confirmList}>
                  {uploadFiles.map((f, i) => (
                    <div key={i} className={styles.confirmRow}>
                      <div className={styles.confirmRowTop}>
                        <div className={styles.confirmFileName}>{f.name}</div>
                        {f.resultStatus === 'success' && (
                          <span className={`${styles.confirmBadge} ${styles.confirmBadgeSuccess}`}>成功</span>
                        )}
                        {(f.resultStatus === 'error' || f.resultStatus === 'conflict') && (
                          <span className={`${styles.confirmBadge} ${styles.confirmBadgeError}`}>エラー</span>
                        )}
                      </div>
                      {f.resultStatus === 'success' && (
                        <div className={styles.confirmDetail}>
                          {f.status === 'new' ? '新規登録' : '更新完了'}
                        </div>
                      )}
                      {f.resultStatus === 'conflict' && (
                        <div className={styles.confirmErrorReason}>
                          このファイルは確認後に別ユーザーによって更新されました。最新状態を確認して再度実行してください。
                        </div>
                      )}
                      {f.resultStatus === 'error' && (
                        <div className={styles.confirmErrorReason}>{f.reason}</div>
                      )}
                    </div>
                  ))}
                </div>

                <div className={styles.modalActions}>
                  <button
                    className={styles.btnMini}
                    onClick={() => {
                      setUploadView('select');
                      setUploadFiles([]);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                  >
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

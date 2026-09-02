'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import styles from './dashboard.module.css';

/**
 * ダッシュボード
 * 仕様書セクション2-1, 2-2, 2-4, 3-3, 3-5に基づく実装
 * - プロジェクトごとにロールが異なる
 * - ロールに応じてUI要素の表示/非表示を切り替え
 * - プロジェクト切替時は最新のロールを再取得（2-4: ロールは他の管理者操作で変わりうる）
 */

type Role = '管理者' | 'テスター' | '閲覧者';

// GET /api/projects のレスポンス（タブ表示用、ロールはキャッシュ扱い）
type Project = {
  id: string;
  name: string;
  role: Role;
};

// GET /api/projects/:id のレスポンス（プロジェクト詳細、最新ロールを含む）
type ProjectDetail = {
  id: string;
  name: string;
  role: Role;
};

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

// 仮データ（API実装後は削除）
const MOCK_PROJECTS: Project[] = [
  { id: '1', name: 'ECサイトリニューアル 総合テスト', role: '管理者' },
  { id: '2', name: '基幹システム移行プロジェクト Phase2', role: 'テスター' },
  { id: '3', name: 'モバイルアプリ v3.0 受け入れテスト', role: '閲覧者' },
  { id: '4', name: '新規プロジェクト（ファイル0件）', role: '管理者' },
  { id: '5', name: 'テストケース0件プロジェクト', role: 'テスター' },
];

// プロジェクトごとのファイルデータ
const MOCK_FILES_BY_PROJECT: Record<string, FileData[]> = {
  '1': [
    { id: '1', name: 'EC機能テスト仕様書_v2.3.xlsx', progress: 95, updatedAt: '2026/08/30 18:42', updatedBy: '田中 美咲', hasHistory: true },
    { id: '2', name: 'EC_API結合テスト仕様書_v1.5.xlsx', progress: 88, updatedAt: '2026/08/29 14:15', updatedBy: '山田 太郎', hasHistory: true },
    { id: '3', name: 'EC_決済フロー検証テスト_v1.0.xlsx', progress: 72, updatedAt: '2026/08/28 11:07', updatedBy: '鈴木 健一', hasHistory: true },
    { id: '4', name: 'EC_管理画面テスト仕様書_v3.1.xlsx', progress: 41, updatedAt: '2026/08/27 16:30', updatedBy: '佐藤 花子', hasHistory: true },
    { id: '5', name: 'EC_レスポンシブUI確認テスト_詳細版_v2.0.xlsx', progress: 0, updatedAt: '2026/08/25 09:20', updatedBy: '高橋 裕子', hasHistory: false },
  ],
  '2': [
    { id: '1', name: '基幹システム_結合テスト仕様書_v1.0.xlsx', progress: 60, updatedAt: '2026/08/28 10:00', updatedBy: '山田 太郎', hasHistory: true },
  ],
  '3': [
    { id: '1', name: 'モバイルアプリ_UIテスト仕様書_v3.0.xlsx', progress: 100, updatedAt: '2026/08/27 15:30', updatedBy: '鈴木 健一', hasHistory: true },
  ],
  '4': [], // ファイル0件
  '5': [
    { id: '1', name: 'テストケース未定義_企画メモ_v0.1.xlsx', progress: null, updatedAt: '2026/08/31 10:05', updatedBy: '田中 美咲', hasHistory: false },
  ], // テストケース0件
};

// プロジェクトごとの統計データ
const stats_BY_PROJECT: Record<string, { total: number; ok: number; ng: number; pending: number }> = {
  '1': { total: 248, ok: 162, ng: 19, pending: 67 },
  '2': { total: 50, ok: 30, ng: 5, pending: 15 },
  '3': { total: 100, ok: 100, ng: 0, pending: 0 },
  '4': { total: 0, ok: 0, ng: 0, pending: 0 }, // ファイル0件
  '5': { total: 0, ok: 0, ng: 0, pending: 0 }, // テストケース0件
};

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
  const [projects, setProjects] = useState(MOCK_PROJECTS);
  const [activeProjectId, setActiveProjectId] = useState(MOCK_PROJECTS[0]?.id ?? '');
  const [activeProjectDetail, setActiveProjectDetail] = useState<ProjectDetail | null>(null);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [activeNav, setActiveNav] = useState<'dashboard' | 'settings'>('dashboard');
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSegment, setFilterSegment] = useState<'all' | 'incomplete' | 'complete'>('all');
  const [displayLimit, setDisplayLimit] = useState<5 | 10 | 'all'>(5);
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileData[]>(MOCK_FILES_BY_PROJECT['1'] || []);
  const [stats, setStats] = useState(stats_BY_PROJECT['1']);

  // プロジェクト設定
  const [members, setMembers] = useState(MOCK_MEMBERS);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState('');
  const [memberRoleEdits, setMemberRoleEdits] = useState<Record<string, Role>>({});

  // モーダル
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectNameError, setNewProjectNameError] = useState<string | null>(null);
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

  // プロジェクト切替時に最新のロール・ファイル・統計を取得（仕様書2-4）
  useEffect(() => {
    const fetchProjectDetail = async () => {
      setIsLoadingProject(true);

      // API未実装のため仮実装（実際は GET /api/projects/:id を呼ぶ）
      await new Promise(resolve => setTimeout(resolve, 100));

      const project = MOCK_PROJECTS.find(p => p.id === activeProjectId);
      if (project) {
        setActiveProjectDetail({
          id: project.id,
          name: project.name,
          role: project.role,
        });
        // プロジェクトごとのファイルと統計を設定
        setFiles(MOCK_FILES_BY_PROJECT[activeProjectId] || []);
        setStats(stats_BY_PROJECT[activeProjectId] || { total: 0, ok: 0, ng: 0, pending: 0 });
      }

      setIsLoadingProject(false);
    };

    if (activeProjectId) {
      fetchProjectDetail();
    }
  }, [activeProjectId]);

  // ロール判定は詳細APIから取得した最新ロールを使用
  // 詳細取得中は一覧のキャッシュをフォールバックとして使用
  const currentRole = activeProjectDetail?.role || activeProjectFromList?.role || '閲覧者';
  const activeProject = activeProjectDetail || activeProjectFromList;

  // ロールに応じた権限
  const canManage = currentRole === '管理者';
  const canEdit = currentRole === '管理者' || currentRole === 'テスター';

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

  // プロジェクト切替時にナビをリセット
  useEffect(() => {
    if (currentRole !== '管理者') {
      setActiveNav('dashboard');
    }
  }, [activeProjectId, currentRole]);

  // 空状態の判定
  const hasFiles = files.length > 0;
  const hasTestCases = stats.total > 0;

  // 進捗率の計算（テストケース0件の場合はNaN回避）
  const progressPercent = hasTestCases
    ? Math.round((stats.ok + stats.ng) / stats.total * 100)
    : 0;

  // パーセント表示（テストケース0件の場合は「—」）
  const progressDisplay = hasTestCases ? String(progressPercent) : '—';
  const showPercentSign = hasTestCases;

  // ドーナツのパーセント計算
  const okPercent = hasTestCases ? Math.round(stats.ok / stats.total * 100) : 0;
  const ngPercent = hasTestCases ? Math.round(stats.ng / stats.total * 100) : 0;
  const pendingPercent = hasTestCases ? Math.round(stats.pending / stats.total * 100) : 0;

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

  const uploadErrorCount = uploadFiles.filter(f => f.status === 'error').length;
  const uploadValidCount = uploadFiles.length - uploadErrorCount;
  const uploadSuccessCount = uploadFiles.filter(f => f.resultStatus === 'success').length;
  const uploadFailCount = uploadFiles.length - uploadSuccessCount;

  // ロール表示名
  const roleLabel = currentRole === '管理者' ? '管理者ダッシュボード'
    : currentRole === 'テスター' ? 'テスターダッシュボード'
    : '閲覧者ダッシュボード';

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
                <div className={styles.userDropdownItem}>ログアウト</div>
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
              className={`${styles.tab} ${project.id === activeProjectId ? styles.tabActive : ''} ${draggingId === project.id ? styles.tabDragging : ''}`}
              onClick={() => setActiveProjectId(project.id)}
              draggable
              onDragStart={(e) => handleDragStart(e, project.id)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, project.id)}
            >
              {project.name}
            </div>
          ))}
        </div>
        <div className={styles.tabFilter}>終了済み 3 件 ▾</div>
      </div>

      {/* ===== 進行中プロジェクト0件 ===== */}
      {projects.length === 0 && (
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

      {/* ===== 管理者ナビゲーション（管理者のみ） ===== */}
      {projects.length > 0 && canManage && (
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
      {projects.length > 0 && activeNav === 'dashboard' && (
        <>
          <div className={styles.pageHead}>
            <h1 className={styles.pageTitle}>{activeProject?.name}</h1>
            <p className={styles.pageSub}>{roleLabel}</p>
          </div>

          {/* 全体進捗カード */}
          <div className={`${styles.card} ${styles.progressCard}`}>
            <div className={styles.progressLabel}>全体進捗</div>
            <div className={styles.progressMain}>
              <span className={styles.progressValue}>{progressDisplay}</span>
              {showPercentSign && <span className={styles.progressPercent}>%</span>}
            </div>
            <div className={`${styles.progressTrack} ${!hasTestCases ? styles.progressTrackEmpty : ''}`}>
              <div className={styles.progressFill} style={{ width: `${progressPercent}%` }}></div>
            </div>
            <div className={styles.progressCaption}>
              {stats.ok + stats.ng} / {stats.total} 件 実施済み
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
                    <b>{stats.total}</b>
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
                  <span className={styles.legendNum}>{stats.ok}件</span>
                  <span className={styles.legendPct}>{okPercent}%</span>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legendName}>
                  <span className={styles.dot} style={{ background: 'var(--fail)' }}></span>
                  NG
                </div>
                <div className={styles.legendFigures}>
                  <span className={styles.legendNum}>{stats.ng}件</span>
                  <span className={styles.legendPct}>{ngPercent}%</span>
                </div>
              </div>
              <div className={styles.legendRow}>
                <div className={styles.legendName}>
                  <span className={styles.dot} style={{ background: 'var(--pending)' }}></span>
                  未実施
                </div>
                <div className={styles.legendFigures}>
                  <span className={styles.legendNum}>{stats.pending}件</span>
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
      {projects.length > 0 && activeNav === 'settings' && canManage && (
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
            setIsCreateProjectModalOpen(false);
            setNewProjectName('');
            setNewProjectNameError(null);
          }}
        >
          <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>新規プロジェクトを作成</div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabelSm}>プロジェクト名</label>
              <input
                type="text"
                placeholder="プロジェクト名を入力"
                maxLength={50}
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
                onClick={() => {
                  setIsCreateProjectModalOpen(false);
                  setNewProjectName('');
                  setNewProjectNameError(null);
                }}
              >
                キャンセル
              </button>
              <button
                className={`${styles.btnMini} ${styles.btnMiniPrimary}`}
                onClick={() => {
                  const trimmed = newProjectName.trim();
                  if (!trimmed || trimmed.length > 50) {
                    setNewProjectNameError('プロジェクト名を入力してください（1〜50文字）。');
                    return;
                  }

                  const newProject: Project = {
                    id: String(Date.now()),
                    name: trimmed,
                    role: '管理者',
                  };
                  setProjects(prev => [...prev, newProject]);
                  setActiveProjectId(newProject.id);
                  setActiveNav('dashboard');
                  setIsCreateProjectModalOpen(false);
                  setNewProjectName('');
                  setNewProjectNameError(null);
                }}
              >
                作成
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
    </div>
  );
}

'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import styles from './tester.module.css';

/**
 * テスターダッシュボード
 * 仕様書セクション2-1, 2-2に基づく実装
 * 管理者との差分:
 * - プロジェクト設定タブなし
 * - ファイル読込機能あり
 * - 登録取消機能あり
 */

// 仮データ（API実装後は削除）
const MOCK_PROJECTS = [
  { id: '1', name: 'ECサイトリニューアル 総合テスト' },
  { id: '2', name: '基幹システム移行プロジェクト Phase2' },
  { id: '3', name: 'モバイルアプリ v3.0 受け入れテスト' },
];

type FileData = {
  id: string;
  name: string;
  progress: number;
  updatedAt: string;
  updatedBy: string;
  hasHistory: boolean;
};

const MOCK_FILES: FileData[] = [
  { id: '1', name: 'EC機能テスト仕様書_v2.3.xlsx', progress: 95, updatedAt: '2026/08/30 18:42', updatedBy: '田中 美咲', hasHistory: true },
  { id: '2', name: 'EC_API結合テスト仕様書_v1.5.xlsx', progress: 88, updatedAt: '2026/08/29 14:15', updatedBy: '山田 太郎', hasHistory: true },
  { id: '3', name: 'EC_決済フロー検証テスト_v1.0.xlsx', progress: 72, updatedAt: '2026/08/28 11:07', updatedBy: '鈴木 健一', hasHistory: true },
  { id: '4', name: 'EC_管理画面テスト仕様書_v3.1.xlsx', progress: 41, updatedAt: '2026/08/27 16:30', updatedBy: '佐藤 花子', hasHistory: true },
  { id: '5', name: 'EC_レスポンシブUI確認テスト_詳細版_v2.0.xlsx', progress: 0, updatedAt: '2026/08/25 09:20', updatedBy: '高橋 裕子', hasHistory: false },
];

const MOCK_STATS = {
  total: 248,
  ok: 162,
  ng: 19,
  pending: 67,
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

export default function TesterDashboardPage() {
  const [projects, setProjects] = useState(MOCK_PROJECTS);
  const [activeProjectId, setActiveProjectId] = useState(MOCK_PROJECTS[0].id);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSegment, setFilterSegment] = useState<'all' | 'incomplete' | 'complete'>('all');
  const [displayLimit, setDisplayLimit] = useState<5 | 10 | 'all'>(5);
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [files, setFiles] = useState(MOCK_FILES);

  // 行メニュー
  const [rowMenuFile, setRowMenuFile] = useState<FileData | null>(null);
  const [rowMenuPosition, setRowMenuPosition] = useState({ top: 0, left: 0 });

  // モーダル
  const [cancelConfirmFile, setCancelConfirmFile] = useState<FileData | null>(null);
  const [cancelBlockedFile, setCancelBlockedFile] = useState<FileData | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadView, setUploadView] = useState<'select' | 'confirm' | 'result'>('select');
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 列幅リサイズ機能
  const [columnWidths, setColumnWidths] = useState([36, 20, 16, 16, 6]);
  const resizingRef = useRef<{ index: number; startX: number; startWidths: number[] } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

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

  const activeProject = projects.find(p => p.id === activeProjectId);
  const progressPercent = Math.round((MOCK_STATS.ok + MOCK_STATS.ng) / MOCK_STATS.total * 100);

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

  const okPercent = Math.round(MOCK_STATS.ok / MOCK_STATS.total * 100);
  const ngPercent = Math.round(MOCK_STATS.ng / MOCK_STATS.total * 100);
  const pendingPercent = Math.round(MOCK_STATS.pending / MOCK_STATS.total * 100);

  const filteredFiles = files.filter(file => {
    if (searchQuery && !file.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
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
        item.before = existingFile.progress;
        item.after = Math.min(100, existingFile.progress + 5 + Math.floor(Math.random() * 10));
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

  const errorCount = uploadFiles.filter(f => f.status === 'error').length;
  const validCount = uploadFiles.length - errorCount;
  const successCount = uploadFiles.filter(f => f.resultStatus === 'success').length;
  const failCount = uploadFiles.length - successCount;

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
          <div
            className={`${styles.userMenu} ${isUserMenuOpen ? styles.userMenuOpen : ''}`}
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
          >
            <span className={styles.userMenuName}>田中 美咲</span>
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

      {/* ===== ページヘッダー ===== */}
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>{activeProject?.name}</h1>
        <p className={styles.pageSub}>テスターダッシュボード</p>
      </div>

      {/* 全体進捗カード */}
      <div className={`${styles.card} ${styles.progressCard}`}>
        <div className={styles.progressLabel}>全体進捗</div>
        <div className={styles.progressMain}>
          <span className={styles.progressValue}>{progressPercent}</span>
          <span className={styles.progressPercent}>%</span>
        </div>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${progressPercent}%` }}></div>
        </div>
        <div className={styles.progressCaption}>
          {MOCK_STATS.ok + MOCK_STATS.ng} / {MOCK_STATS.total} 件 実施済み
        </div>
      </div>

      {/* メイングリッド */}
      <div className={styles.mainGrid}>
        {/* 実施状況の内訳 */}
        <div className={styles.card}>
          <div className={styles.cardLabel}>実施状況の内訳</div>
          <div className={styles.donutWrap}>
            <div
              className={styles.donut}
              style={{
                background: `conic-gradient(
                  var(--accent) 0deg ${okPercent * 3.6}deg,
                  var(--fail) ${okPercent * 3.6}deg ${(okPercent + ngPercent) * 3.6}deg,
                  var(--pending) ${(okPercent + ngPercent) * 3.6}deg 360deg
                )`
              }}
            >
              <div className={styles.donutCenter}>
                <b>{MOCK_STATS.total}</b>
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
              <span className={styles.legendNum}>{MOCK_STATS.ok}件</span>
              <span className={styles.legendPct}>{okPercent}%</span>
            </div>
          </div>
          <div className={styles.legendRow}>
            <div className={styles.legendName}>
              <span className={styles.dot} style={{ background: 'var(--fail)' }}></span>
              NG
            </div>
            <div className={styles.legendFigures}>
              <span className={styles.legendNum}>{MOCK_STATS.ng}件</span>
              <span className={styles.legendPct}>{ngPercent}%</span>
            </div>
          </div>
          <div className={styles.legendRow}>
            <div className={styles.legendName}>
              <span className={styles.dot} style={{ background: 'var(--pending)' }}></span>
              未実施
            </div>
            <div className={styles.legendFigures}>
              <span className={styles.legendNum}>{MOCK_STATS.pending}件</span>
              <span className={styles.legendPct}>{pendingPercent}%</span>
            </div>
          </div>
        </div>

        {/* テストファイル一覧 */}
        <div className={styles.card}>
          <div className={styles.filesTopRow}>
            <div className={styles.filesTitle}>テストファイル一覧</div>
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
                  <th style={{ width: `${columnWidths[0]}%` }}>
                    ファイル名
                    <div
                      className={styles.resizeHandle}
                      onMouseDown={(e) => handleResizeStart(0, e)}
                    />
                  </th>
                  <th style={{ width: `${columnWidths[1]}%` }}>
                    進捗
                    <div
                      className={styles.resizeHandle}
                      onMouseDown={(e) => handleResizeStart(1, e)}
                    />
                  </th>
                  <th style={{ width: `${columnWidths[2]}%` }}>
                    最終更新
                    <div
                      className={styles.resizeHandle}
                      onMouseDown={(e) => handleResizeStart(2, e)}
                    />
                  </th>
                  <th style={{ width: `${columnWidths[3]}%` }}>
                    最終更新者
                    <div
                      className={styles.resizeHandle}
                      onMouseDown={(e) => handleResizeStart(3, e)}
                    />
                  </th>
                  <th style={{ width: `${columnWidths[4]}%` }}></th>
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
                      </div>
                    </td>
                    <td><div className={styles.metaText}>{file.updatedAt}</div></td>
                    <td><div className={styles.metaName}>{file.updatedBy}</div></td>
                    <td>
                      <div
                        className={styles.actionDots}
                        onClick={(e) => handleRowMenuClick(e, file)}
                      >
                        ⋯
                      </div>
                    </td>
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

      {/* ===== 行メニュー ===== */}
      {rowMenuFile && (
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

      {/* ===== ファイル読込モーダル ===== */}
      {isUploadModalOpen && (
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

                {errorCount > 0 && validCount === 0 && (
                  <div className={`${styles.confirmSummary} ${styles.confirmSummaryAllError}`}>
                    すべてのファイルがエラーのため読み込めません。
                  </div>
                )}
                {errorCount > 0 && validCount > 0 && (
                  <div className={`${styles.confirmSummary} ${styles.confirmSummaryHasError}`}>
                    エラーの{errorCount}件はスキップされ、正常な{validCount}件のみ読み込まれます。
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
                    disabled={validCount === 0}
                    onClick={executeImport}
                  >
                    {validCount === 0 ? 'この内容で読み込む' : (errorCount > 0 ? `正常な${validCount}件を読み込む` : 'この内容で読み込む')}
                  </button>
                </div>
              </div>
            )}

            {/* ===== 結果ビュー ===== */}
            {uploadView === 'result' && (
              <div>
                <div className={styles.modalTitle}>読み込み結果</div>
                <p className={styles.modalDesc}>
                  {failCount === 0
                    ? `${successCount}件のファイルを読み込みました。`
                    : `${successCount}件を読み込みました。${failCount}件は登録/更新されていません。`
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

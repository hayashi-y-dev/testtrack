'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import styles from './dashboard.module.css';

/**
 * 管理者ダッシュボード
 * 仕様書セクション2-1, 2-2に基づく実装
 * - プロジェクト全体の進捗表示
 * - テスト結果内訳（ドーナツチャート）
 * - テストファイル一覧
 */

// 仮データ（API実装後は削除）
const MOCK_PROJECTS = [
  { id: '1', name: 'ECサイトリニューアル 総合テスト' },
  { id: '2', name: '基幹システム移行プロジェクト Phase2' },
  { id: '3', name: 'モバイルアプリ v3.0 受け入れテスト' },
];

const MOCK_FILES = [
  { id: '1', name: 'EC機能テスト仕様書_v2.3.xlsx', progress: 95, updatedAt: '2026/08/30 18:42', updatedBy: '田中 美咲' },
  { id: '2', name: 'EC_API結合テスト仕様書_v1.5.xlsx', progress: 88, updatedAt: '2026/08/29 14:15', updatedBy: '山田 太郎' },
  { id: '3', name: 'EC_決済フロー検証テスト_v1.0.xlsx', progress: 72, updatedAt: '2026/08/28 11:07', updatedBy: '鈴木 健一' },
  { id: '4', name: 'EC_管理画面テスト仕様書_v3.1.xlsx', progress: 41, updatedAt: '2026/08/27 16:30', updatedBy: '佐藤 花子' },
  { id: '5', name: 'EC_レスポンシブUI確認テスト_詳細版_v2.0.xlsx', progress: 0, updatedAt: '2026/08/25 09:20', updatedBy: '高橋 裕子' },
];

const MOCK_STATS = {
  total: 248,
  ok: 162,
  ng: 19,
  pending: 67,
};

const MOCK_MEMBERS = [
  { id: '1', name: '佐藤 花子', email: 'hanako.sato@example.com', role: '管理者' as const, isCurrentUser: true },
  { id: '2', name: '田中 美咲', email: 'misaki.tanaka@example.com', role: 'テスター' as const, isCurrentUser: false },
  { id: '3', name: '山田 太郎', email: 'taro.yamada@example.com', role: 'テスター' as const, isCurrentUser: false },
  { id: '4', name: '鈴木 健一', email: 'kenichi.suzuki@example.com', role: 'テスター' as const, isCurrentUser: false },
  { id: '5', name: '高橋 裕子', email: 'yuko.takahashi@example.com', role: '閲覧者' as const, isCurrentUser: false },
];

type Role = '管理者' | 'テスター' | '閲覧者';

export default function DashboardPage() {
  const [projects, setProjects] = useState(MOCK_PROJECTS);
  const [activeProjectId, setActiveProjectId] = useState(MOCK_PROJECTS[0].id);
  const [activeNav, setActiveNav] = useState<'dashboard' | 'settings'>('dashboard');
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSegment, setFilterSegment] = useState<'all' | 'incomplete' | 'complete'>('all');
  const [displayLimit, setDisplayLimit] = useState<5 | 10 | 'all'>(5);
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // プロジェクト設定
  const [members, setMembers] = useState(MOCK_MEMBERS);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingNameValue, setEditingNameValue] = useState('');
  const [memberRoleEdits, setMemberRoleEdits] = useState<Record<string, Role>>({});

  // モーダル
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectNameError, setNewProjectNameError] = useState<string | null>(null);

  // 列幅リサイズ機能
  const [columnWidths, setColumnWidths] = useState([40, 22, 19, 19]); // %単位
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
      const minWidth = 10;

      // 現在の列を広げて、次の列を縮める
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

  const filteredFiles = MOCK_FILES.filter(file => {
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

      {/* ===== 管理者ナビゲーション ===== */}
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

      {/* ===== ダッシュボードビュー ===== */}
      {activeNav === 'dashboard' && (
        <>
          <div className={styles.pageHead}>
            <h1 className={styles.pageTitle}>{activeProject?.name}</h1>
            <p className={styles.pageSub}>管理者ダッシュボード</p>
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
                      <th style={{ width: `${columnWidths[3]}%` }}>最終更新者</th>
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

      {/* ===== プロジェクト設定ビュー ===== */}
      {activeNav === 'settings' && (
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
              <button className={styles.btnSecondary}>＋ メンバーを追加</button>
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
            <button className={styles.btnDanger}>プロジェクトを終了</button>
          </div>
        </>
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

                  const newProject = {
                    id: String(Date.now()),
                    name: trimmed,
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
    </div>
  );
}

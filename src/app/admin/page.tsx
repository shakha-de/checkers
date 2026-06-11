'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Lock, 
  Unlock, 
  Trash2, 
  Eye, 
  Users, 
  ArrowLeft, 
  Loader2, 
  Search, 
  Calendar, 
  RefreshCw, 
  X,
  FileText
} from 'lucide-react';
import Image from 'next/image';
import styles from './admin.module.css';

interface AdminRoom {
  id: string;
  status: 'waiting' | 'active' | 'finished';
  players: {
    w?: string | null;
    b?: string | null;
  };
  game_state: {
    turn: 'w' | 'b';
    winner: 'w' | 'b' | 'draw' | null;
    history?: string[];
    score?: {
      w: number;
      b: number;
      draws: number;
    };
    isPrivate?: boolean;
  };
  chat?: Array<{
    id: string;
    sender: 'w' | 'b' | 'system' | 'spectator';
    text: string;
    timestamp: number;
  }>;
  created_at: string;
  updated_at: string;
}

export default function AdminDashboard() {
  const router = useRouter();

  const [passcode, setPasscode] = useState('');

  const [authenticated, setAuthenticated] = useState(false);

  const [authError, setAuthError] = useState('');
  
  // Data states
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'waiting' | 'active' | 'finished'>('all');

  // Inspection Modal
  const [inspectedRoom, setInspectedRoom] = useState<AdminRoom | null>(null);

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Fetch rooms list from admin API
  const fetchRooms = useCallback(async (tokenToUse?: string) => {
    const activeToken = tokenToUse || passcode;
    if (!activeToken) return;

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/rooms', {
        headers: {
          'Authorization': activeToken,
        },
      });

      if (res.status === 401) {
        setAuthError('Неверный пароль администратора');
        setAuthenticated(false);
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('checkers_admin_pass');
        }
        return;
      }

      if (!res.ok) {
        let message = 'Не удалось загрузить список комнат';
        try {
          const data = await res.json();
          message = data.error || message;
        } catch {
          // Keep the default message if the response body is not JSON.
        }
        throw new Error(message);
      }

      const data = await res.json();
      setRooms(data.rooms || []);
      setAuthenticated(true);
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('checkers_admin_pass', activeToken);
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Произошла непредвиденная ошибка');
    } finally {
      setLoading(false);
    }
  }, [passcode]);

  // Fetch rooms on authentication
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedPasscode = sessionStorage.getItem('checkers_admin_pass');
      if (storedPasscode) {
        setPasscode(storedPasscode);
        setAuthenticated(true);
      }
    }
  }, []);

  // Fetch rooms on authentication
  useEffect(() => {
    if (authenticated) {
      Promise.resolve().then(() => fetchRooms());
    }
  }, [authenticated, fetchRooms]);

  // Handle Admin Login
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (!passcode.trim()) {
      setAuthError('Введите пароль');
      return;
    }
    fetchRooms(passcode);
  };

  // Log out admin
  const handleLogout = () => {
    setAuthenticated(false);
    setPasscode('');
    setRooms([]);
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('checkers_admin_pass');
    }
  };

  // Delete specific room
  const handleDeleteRoom = async (roomId: string) => {
    if (!confirm(`Вы уверены, что хотите окончательно удалить комнату ${roomId}?`)) {
      return;
    }

    setActionLoading(roomId);
    try {
      const res = await fetch(`/api/admin/rooms?id=${roomId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': passcode,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Ошибка при удалении комнаты');
      }

      setRooms(prev => prev.filter(r => r.id !== roomId));
      if (inspectedRoom?.id === roomId) {
        setInspectedRoom(null);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось удалить комнату');
    } finally {
      setActionLoading(null);
    }
  };

  // Bulk-delete selected rooms
  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Вы уверены, что хотите удалить ${selectedIds.size} выбранных комнат?`)) return;

    setActionLoading('bulk');
    const ids = Array.from(selectedIds);
    try {
      const responses = await Promise.all(
        ids.map(async id => {
          const response = await fetch(`/api/admin/rooms?id=${id}`, {
            method: 'DELETE',
            headers: { Authorization: passcode },
          });

          if (!response.ok) {
            let message = 'Не удалось удалить выбранную комнату';
            try {
              const data = await response.json();
              message = data.error || message;
            } catch {
              // Ignore JSON parsing failures and use the default message.
            }

            throw new Error(message);
          }

          return response;
        })
      );

      if (responses.length !== ids.length) {
        throw new Error('Не удалось удалить все выбранные комнаты');
      }

      setRooms(prev => prev.filter(r => !selectedIds.has(r.id)));
      if (inspectedRoom && selectedIds.has(inspectedRoom.id)) setInspectedRoom(null);
      setSelectedIds(new Set());
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось удалить выбранные комнаты');
    } finally {
      setActionLoading(null);
    }
  };

  // Toggle single-row selection
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Clear rooms older than 24 hours
  const handleCleanup = async () => {
    if (!confirm('Вы уверены, что хотите удалить ВСЕ комнаты, созданные более 24 часов назад?')) {
      return;
    }

    setActionLoading('cleanup');
    try {
      const res = await fetch('/api/admin/rooms', {
        method: 'DELETE',
        headers: {
          'Authorization': passcode,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Ошибка при очистке комнат');
      }

      fetchRooms();
      alert('Устаревшие комнаты успешно удалены.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось выполнить очистку');
    } finally {
      setActionLoading(null);
    }
  };

  // Format date-time
  const formatDateTime = (isoString: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Calculate statistics
  const totalCount = rooms.length;
  const waitingCount = rooms.filter(r => r.status === 'waiting').length;
  const activeCount = rooms.filter(r => r.status === 'active').length;
  const finishedCount = rooms.filter(r => r.status === 'finished').length;

  // Search & Filter Room List
  const filteredRooms = rooms.filter(room => {
    const matchesSearch = room.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || room.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Select / deselect all currently visible rows (must come after filteredRooms)
  const allVisibleSelected = filteredRooms.length > 0 && filteredRooms.every(r => selectedIds.has(r.id));
  const someVisibleSelected = filteredRooms.some(r => selectedIds.has(r.id));
  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredRooms.forEach(r => next.delete(r.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredRooms.forEach(r => next.add(r.id));
        return next;
      });
    }
  };

  // Render Login Card
  if (!authenticated) {
    return (
      <div className={styles.container}>
        <div className={`${styles.loginCard} glass`}>
          <div className={styles.header}>
            <Image src="/logo.png" width={64} height={64} className={styles.logoAdminLogin} alt="Admin Logo" priority />
            <h1 className={styles.title}>Панель администратора</h1>
            <p className={styles.subtitle}>Введите пароль администратора для управления комнатами</p>
          </div>

          <form onSubmit={handleLogin} className={styles.form}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Пароль</label>
              <input
                type="password"
                className={styles.input}
                placeholder="••••••••"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
              />
              {authError && <span className={styles.errorText}>{authError}</span>}
            </div>

            <button type="submit" className={styles.loginBtn} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  <span>Проверка...</span>
                </>
              ) : (
                <span>Войти в панель</span>
              )}
            </button>
          </form>

          <button className={styles.backBtn} onClick={() => router.push('/')}>
            <ArrowLeft size={16} /> На главную
          </button>
        </div>
      </div>
    );
  }

  // Render Dashboard
  return (
    <div className={styles.adminLayout}>
      
      {/* Upper Navigation Row */}
      <div className={`${styles.topBar} glass`}>
        <div className={styles.brand}>
          <Image src="/logo.png" width={32} height={32} className={styles.logoMini} alt="Logo" priority />
          <div>
            <span className={styles.dashboardTitle}>Checkers Admin</span>
            <span className={styles.dashboardSubtitle}>Управление игровыми серверами</span>
          </div>
        </div>
        <div className={styles.topBarButtons}>
          <button className={styles.refreshBtn} onClick={() => fetchRooms()} title="Обновить список">
            {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
          </button>
          <button className={styles.logoutBtn} onClick={handleLogout}>
            Выйти
          </button>
          <button className={styles.homeBtn} onClick={() => router.push('/')}>
            <ArrowLeft size={14} /> На сайт
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className={styles.statsGrid}>
        <div className={`${styles.statCard} glass`}>
          <span className={styles.statLabel}>Всего комнат</span>
          <span className={styles.statValue}>{totalCount}</span>
        </div>
        <div className={`${styles.statCard} glass`} style={{ borderLeft: '4px solid var(--primary)' }}>
          <span className={styles.statLabel}>Ожидают соперника</span>
          <span className={styles.statValue} style={{ color: 'var(--primary)' }}>{waitingCount}</span>
        </div>
        <div className={`${styles.statCard} glass`} style={{ borderLeft: '4px solid var(--accent-green)' }}>
          <span className={styles.statLabel}>Активные игры</span>
          <span className={styles.statValue} style={{ color: 'var(--accent-green)' }}>{activeCount}</span>
        </div>
        <div className={`${styles.statCard} glass`} style={{ borderLeft: '4px solid var(--accent-blue)' }}>
          <span className={styles.statLabel}>Завершенные игры</span>
          <span className={styles.statValue} style={{ color: 'var(--accent-blue)' }}>{finishedCount}</span>
        </div>
      </div>

      {/* Main Table Section */}
      <div className={`${styles.tableCard} glass`}>
        <div className={styles.tableHeader}>
          <div className={styles.searchBar}>
            <Search size={16} className={styles.searchIcon} />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Поиск по ID комнаты..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className={styles.headerActions}>
            {/* Bulk action bar (visible when rows are selected) */}
            {selectedIds.size > 0 && (
              <div className={styles.bulkBar}>
                <span className={styles.bulkCount}>{selectedIds.size} выбрано</span>
                <button
                  className={styles.bulkClearBtn}
                  onClick={() => setSelectedIds(new Set())}
                  title="Снять выделение"
                >
                  <X size={13} /> Сбросить
                </button>
                <button
                  className={styles.bulkDeleteBtn}
                  onClick={handleDeleteSelected}
                  disabled={actionLoading === 'bulk'}
                >
                  {actionLoading === 'bulk' ? (
                    <><Loader2 className="animate-spin" size={13} /><span>Удаление...</span></>
                  ) : (
                    <><Trash2 size={13} /><span>Удалить выбранные</span></>
                  )}
                </button>
              </div>
            )}
            <button
              className={styles.cleanupBtn}
              onClick={handleCleanup}
              disabled={actionLoading === 'cleanup'}
            >
              {actionLoading === 'cleanup' ? (
                <>
                  <Loader2 className="animate-spin" size={14} />
                  <span>Очистка...</span>
                </>
              ) : (
                <>
                  <Trash2 size={14} />
                  <span>Удалить неактивные (24ч+)</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Tab Filters */}
        <div className={styles.tabContainer}>
          <button
            className={`${styles.tabBtn} ${statusFilter === 'all' ? styles.tabBtnActive : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            Все ({totalCount})
          </button>
          <button
            className={`${styles.tabBtn} ${statusFilter === 'waiting' ? styles.tabBtnActive : ''}`}
            onClick={() => setStatusFilter('waiting')}
          >
            Ожидающие ({waitingCount})
          </button>
          <button
            className={`${styles.tabBtn} ${statusFilter === 'active' ? styles.tabBtnActive : ''}`}
            onClick={() => setStatusFilter('active')}
          >
            Активные ({activeCount})
          </button>
          <button
            className={`${styles.tabBtn} ${statusFilter === 'finished' ? styles.tabBtnActive : ''}`}
            onClick={() => setStatusFilter('finished')}
          >
            Завершенные ({finishedCount})
          </button>
        </div>

        {/* Room List Table */}
        <div className={styles.tableWrapper}>
          {error && (
            <div className={styles.errorBanner}>
              <span>Ошибка: {error}</span>
            </div>
          )}
          {loading && rooms.length === 0 ? (
            <div className={styles.loaderArea}>
              <Loader2 className="animate-spin" size={32} style={{ color: 'var(--primary)' }} />
              <span>Загрузка данных...</span>
            </div>
          ) : filteredRooms.length === 0 ? (
            <div className={styles.emptyArea}>
              <span>Комнаты не найдены</span>
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.checkboxCol}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={allVisibleSelected}
                      ref={el => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected; }}
                      onChange={toggleSelectAll}
                      title="Выбрать все"
                    />
                  </th>
                  <th>ID Комнаты</th>
                  <th>Создана</th>
                  <th>Статус</th>
                  <th>Тип доступа</th>
                  <th>Игроки (Белые : Черные)</th>
                  <th>Ходов</th>
                  <th>Счет матча</th>
                  <th style={{ textAlign: 'right' }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {filteredRooms.map((room) => {
                  const hasWhite = !!room.players.w;
                  const hasBlack = !!room.players.b;
                  const isPrivate = room.game_state?.isPrivate;
                  const movesCount = room.game_state?.history?.length ?? 0;
                  const score = room.game_state?.score;

                  return (
                    <tr
                      key={room.id}
                      className={`${styles.tableRow} ${selectedIds.has(room.id) ? styles.tableRowSelected : ''}`}
                    >
                      <td className={styles.checkboxCol}>
                        <input
                          type="checkbox"
                          className={styles.checkbox}
                          checked={selectedIds.has(room.id)}
                          onChange={() => toggleSelect(room.id)}
                        />
                      </td>
                      <td className={styles.roomIdCell}>
                        <a
                          href={`/rooms/${room.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.roomLink}
                          title="Открыть игру в новой вкладке"
                        >
                          {room.id}
                        </a>
                      </td>
                      <td className={styles.dateCell}>
                        <div className={styles.flexIconText}>
                          <Calendar size={12} style={{ color: 'var(--text-muted)' }} />
                          <span>{formatDateTime(room.created_at)}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`${styles.badge} ${
                          room.status === 'active' 
                            ? styles.badgeActive 
                            : room.status === 'waiting'
                            ? styles.badgeWaiting
                            : styles.badgeFinished
                        }`}>
                          {room.status === 'active' && 'Игра идет'}
                          {room.status === 'waiting' && 'Ожидание'}
                          {room.status === 'finished' && 'Завершена'}
                        </span>
                      </td>
                      <td>
                        <div className={styles.flexIconText}>
                          {isPrivate ? (
                            <>
                              <Lock size={12} style={{ color: 'var(--primary)' }} />
                              <span style={{ color: 'var(--primary)' }}>Приватный</span>
                            </>
                          ) : (
                            <>
                              <Unlock size={12} style={{ color: 'var(--text-muted)' }} />
                              <span>Публичный</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className={styles.flexIconText}>
                          <Users size={12} style={{ color: 'var(--text-muted)' }} />
                          <span>
                            {hasWhite ? 'W' : '—'} : {hasBlack ? 'B' : '—'}
                          </span>
                        </div>
                      </td>
                      <td style={{ fontWeight: 600 }}>{movesCount}</td>
                      <td className={styles.scoreCell}>
                        {score ? (
                          <span>
                            {score.w} : {score.b} <span className={styles.drawsText}>({score.draws} Н)</span>
                          </span>
                        ) : (
                          <span>0 : 0</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className={styles.rowActions}>
                          <button
                            className={styles.actionBtnInspect}
                            onClick={() => setInspectedRoom(room)}
                            title="Инспектировать детали"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            className={styles.actionBtnDelete}
                            onClick={() => handleDeleteRoom(room.id)}
                            disabled={actionLoading === room.id}
                            title="Удалить комнату"
                          >
                            {actionLoading === room.id ? (
                              <Loader2 className="animate-spin" size={14} />
                            ) : (
                              <Trash2 size={14} />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* JSON Inspector Modal Overlay */}
      {inspectedRoom && (
        <div className={styles.modalOverlay}>
          <div className={`${styles.modalCard} glass`}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitleRow}>
                <FileText size={18} className={styles.modalTitleIcon} />
                <h3 className={styles.modalTitle}>Детали комнаты {inspectedRoom.id}</h3>
              </div>
              <button className={styles.closeBtn} onClick={() => setInspectedRoom(null)}>
                <X size={18} />
              </button>
            </div>

            <div className={styles.modalContent}>
              <div className={styles.jsonViewer}>
                <pre>{JSON.stringify(inspectedRoom, null, 2)}</pre>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button className={styles.modalCloseBtn} onClick={() => setInspectedRoom(null)}>
                Закрыть
              </button>
              <button 
                className={styles.modalDeleteBtn}
                onClick={() => handleDeleteRoom(inspectedRoom.id)}
                disabled={actionLoading === inspectedRoom.id}
              >
                {actionLoading === inspectedRoom.id ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  <>
                    <Trash2 size={14} />
                    <span>Удалить эту комнату</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

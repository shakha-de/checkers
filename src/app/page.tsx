'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Swords, Loader2, Lock, Unlock, Eye, Users, Trophy } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import styles from './page.module.css';

interface Room {
  id: string;
  status: 'waiting' | 'active' | 'finished';
  created_at: string;
  players: {
    w?: string | null;
    b?: string | null;
  };
  game_state: {
    turn: 'w' | 'b';
    score?: {
      w: number;
      b: number;
      draws: number;
    };
    isPrivate?: boolean;
  };
}

export default function Home() {
  const router = useRouter();
  const [color, setColor] = useState<'random' | 'w' | 'b'>('random');
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [opponentType, setOpponentType] = useState<'player' | 'ai'>('player');
  const [aiDifficulty, setAiDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');

  // Lobby states
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loadingLobby, setLoadingLobby] = useState(true);
  const [lobbyTab, setLobbyTab] = useState<'waiting' | 'active'>('waiting');

  const handleCreateGame = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ creatorColor: color, isPrivate, opponentType, aiDifficulty }),
      });

      if (!res.ok) {
        throw new Error('Failed to create room');
      }

      const data = await res.json();
      const { roomId, creatorToken } = data;

      // Store the session token locally for this room
      localStorage.setItem(`checkers_token_${roomId}`, creatorToken);

      // Redirect to the game room page
      router.push(`/rooms/${roomId}`);
    } catch (err) {
      console.error(err);
      alert('Ошибка при создании игры. Попробуйте еще раз.');
      setLoading(false);
    }
  };

  // Fetch rooms and subscribe to changes
  useEffect(() => {
    let active = true;

    const fetchRooms = async () => {
      try {
        const { data, error } = await supabase
          .from('rooms')
          .select('*')
          .in('status', ['waiting', 'active'])
          .or('game_state->isPrivate.is.null,game_state->isPrivate.eq.false')
          .order('created_at', { ascending: false });

        if (error) throw error;
        if (active && data) {
          setRooms(data);
        }
      } catch (err) {
        console.error('Failed to fetch rooms:', err);
      } finally {
        if (active) {
          setLoadingLobby(false);
        }
      }
    };

    fetchRooms();

    // Subscribe to updates in rooms table for real-time lobby updates
    const channel = supabase
      .channel('lobby-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rooms',
        },
        () => {
          fetchRooms();
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  // Format relative creation time
  const getRelativeTime = (isoString: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    
    if (seconds < 60) return 'только что';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} мин. назад`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ч. назад`;
    return date.toLocaleDateString('ru-RU');
  };

  // Filter rooms based on active tab
  const filteredRooms = rooms.filter(room => room.status === lobbyTab);

  return (
    <div className={styles.container}>
      <div className={styles.lobbyLayout}>
        
        {/* Left Column: Create Game and Rules */}
        <div className={styles.leftColumn}>
          <div className={`${styles.mainCard} glass`}>
            <div className={styles.header}>
              <div className={styles.logoContainer}>
                <Image src="/logo.png" width={96} height={96} className={styles.logoImg} alt="Checkers Logo" priority />
              </div>
              <h1 className={styles.title}>ШАШКИ ОНЛАЙН</h1>
              <p className={styles.subtitle}>
                Создайте приватную комнату или выберите открытую игру из лобби, чтобы начать партию по правилам русских шашек!
              </p>
            </div>

            {/* Color Selector */}
            <div className={styles.formGroup}>
              <label className={styles.label}>Выберите ваш цвет</label>
              <div className={styles.colorSelector}>
                <div
                  className={`${styles.colorOption} ${
                    color === 'w' ? styles.colorOptionActive : ''
                  }`}
                  onClick={() => setColor('w')}
                >
                  <div className={`${styles.colorDot} ${styles.colorDotWhite}`} />
                  <span className={styles.colorName}>Белые</span>
                </div>

                <div
                  className={`${styles.colorOption} ${
                    color === 'random' ? styles.colorOptionActive : ''
                  }`}
                  onClick={() => setColor('random')}
                >
                  <div className={`${styles.colorDot} ${styles.colorDotRandom}`} />
                  <span className={styles.colorName}>Случайно</span>
                </div>

                <div
                  className={`${styles.colorOption} ${
                    color === 'b' ? styles.colorOptionActiveBlack : ''
                  }`}
                  onClick={() => setColor('b')}
                >
                  <div className={`${styles.colorDot} ${styles.colorDotBlack}`} />
                  <span className={styles.colorName}>Черные</span>
                </div>
              </div>
            </div>

            {/* Opponent Selector */}
            <div className={styles.formGroup}>
              <label className={styles.label}>Режим игры</label>
              <div className={styles.opponentSelector}>
                <div
                  className={`${styles.opponentOption} ${
                    opponentType === 'player' ? styles.opponentOptionActive : ''
                  }`}
                  onClick={() => setOpponentType('player')}
                >
                  <Users size={16} />
                  <span className={styles.opponentOptionText}>Против Игрока</span>
                </div>

                <div
                  className={`${styles.opponentOption} ${
                    opponentType === 'ai' ? styles.opponentOptionActive : ''
                  }`}
                  onClick={() => setOpponentType('ai')}
                >
                  <Swords size={16} />
                  <span className={styles.opponentOptionText}>Против ИИ</span>
                </div>
              </div>
            </div>

            {/* AI Difficulty Selector */}
            {opponentType === 'ai' && (
              <div className={styles.formGroup}>
                <label className={styles.label}>Сложность ИИ</label>
                <div className={styles.difficultySelector}>
                  <div
                    className={`${styles.difficultyOption} ${
                      aiDifficulty === 'easy' ? styles.difficultyOptionActiveEasy : ''
                    }`}
                    onClick={() => setAiDifficulty('easy')}
                  >
                    Легкий
                  </div>
                  <div
                    className={`${styles.difficultyOption} ${
                      aiDifficulty === 'medium' ? styles.difficultyOptionActiveMedium : ''
                    }`}
                    onClick={() => setAiDifficulty('medium')}
                  >
                    Средний
                  </div>
                  <div
                    className={`${styles.difficultyOption} ${
                      aiDifficulty === 'hard' ? styles.difficultyOptionActiveHard : ''
                    }`}
                    onClick={() => setAiDifficulty('hard')}
                  >
                    Сложный
                  </div>
                </div>
              </div>
            )}

            {/* Privacy Switch */}
            <div className={styles.formGroup}>
              <label className={styles.label}>Настройки конфиденциальности</label>
              <div
                className={`${styles.privacyToggle} ${isPrivate ? styles.privacyTogglePrivate : ''}`}
                onClick={() => setIsPrivate(!isPrivate)}
              >
                {isPrivate ? <Lock size={18} /> : <Unlock size={18} />}
                <div className={styles.privacyToggleText}>
                  <span className={styles.privacyToggleTitle}>
                    {isPrivate ? 'Приватная игра' : 'Публичная игра'}
                  </span>
                  <span className={styles.privacyToggleDesc}>
                    {isPrivate 
                      ? 'Доступ только по прямой ссылке' 
                      : 'Будет отображаться в общем списке игр'}
                  </span>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <button
              className={styles.submitBtn}
              onClick={handleCreateGame}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  <span>Создание комнаты...</span>
                </>
              ) : (
                <>
                  <Swords size={20} />
                  <span>Создать игру</span>
                </>
              )}
            </button>

            {/* Rules Section */}
            <div className={styles.rules}>
              <h3 className={styles.rulesTitle}>Правила Русских Шашек:</h3>
              <ul className={styles.rulesList}>
                <li className={styles.ruleItem}>
                  Простые шашки ходят по диагонали вперед, а бьют вперед и назад.
                </li>
                <li className={styles.ruleItem}>
                  Взятие (битье) соперника обязательно. Если есть бой, другие ходы делать нельзя.
                </li>
                <li className={styles.ruleItem}>
                  Дамка может ходить на любое число клеток по диагонали и бить на любом расстоянии.
                </li>
                <li className={styles.ruleItem}>
                  Если простая шашка достигает последнего ряда при взятии, она сразу становится дамкой и продолжает бой (если возможно).
                </li>
                <li className={styles.ruleItem}>
                  Срубленные шашки убираются с поля только в конце хода (правило турецкого удара).
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Right Column: Public Lobby */}
        <div className={styles.rightColumn}>
          <div className={`${styles.lobbyCard} glass`}>
            <div className={styles.lobbyHeader}>
              <div className={styles.lobbyTitleGroup}>
                <Users size={20} className={styles.lobbyIcon} />
                <h2 className={styles.lobbyTitle}>Лобби матчей</h2>
              </div>
              {loadingLobby && <Loader2 className={`${styles.lobbySpinner} animate-spin`} size={16} />}
            </div>

            {/* Lobby Tabs */}
            <div className={styles.lobbyTabs}>
              <button
                className={`${styles.lobbyTabBtn} ${lobbyTab === 'waiting' ? styles.lobbyTabBtnActive : ''}`}
                onClick={() => setLobbyTab('waiting')}
              >
                Открытые вызовы
                <span className={styles.tabBadge}>
                  {rooms.filter(r => r.status === 'waiting').length}
                </span>
              </button>
              <button
                className={`${styles.lobbyTabBtn} ${lobbyTab === 'active' ? styles.lobbyTabBtnActive : ''}`}
                onClick={() => setLobbyTab('active')}
              >
                Игры в эфире
                <span className={styles.tabBadge} style={{ background: 'var(--secondary)' }}>
                  {rooms.filter(r => r.status === 'active').length}
                </span>
              </button>
            </div>

            {/* Lobby Content */}
            <div className={styles.lobbyListContainer}>
              {loadingLobby && rooms.length === 0 ? (
                <div className={styles.lobbyMessage}>
                  <Loader2 className="animate-spin" size={24} style={{ marginBottom: '0.5rem', opacity: 0.5 }} />
                  <span>Загрузка списка игр...</span>
                </div>
              ) : filteredRooms.length === 0 ? (
                <div className={styles.lobbyMessage}>
                  <Users size={32} style={{ marginBottom: '0.75rem', opacity: 0.2 }} />
                  <span>
                    {lobbyTab === 'waiting' 
                      ? 'Нет свободных вызовов. Создайте игру, чтобы бросить вызов!' 
                      : 'В данный момент активных игр нет.'}
                  </span>
                </div>
              ) : (
                <div className={styles.lobbyGrid}>
                  {filteredRooms.map((room) => {
                    const creatorIsWhite = !!room.players.w && !room.players.b;
                    const elapsed = getRelativeTime(room.created_at);

                    return (
                      <div key={room.id} className={styles.roomItem}>
                        <div className={styles.roomInfoCol}>
                          <div className={styles.roomIdRow}>
                            <span className={styles.roomName}>Комната {room.id}</span>
                            <span className={styles.roomTime}>{elapsed}</span>
                          </div>
                          
                          {room.status === 'waiting' ? (
                            <div className={styles.roomStatusDesc}>
                              <div className={`${styles.colorDotMini} ${creatorIsWhite ? styles.colorDotWhite : styles.colorDotBlack}`} />
                              <span>
                                {creatorIsWhite 
                                  ? 'Ожидание игрока за Черных' 
                                  : 'Ожидание игрока за Белых'}
                              </span>
                            </div>
                          ) : (
                            <div className={styles.roomStatusDesc}>
                              <span className={styles.turnLabel}>
                                {room.game_state?.turn === 'w' ? 'Ход белых' : 'Ход черных'}
                              </span>
                              <span className={styles.scoreLabelLobby}>
                                <Trophy size={12} style={{ marginRight: '3px', color: 'var(--primary)' }} />
                                {room.game_state?.score?.w ?? 0} : {room.game_state?.score?.b ?? 0}
                              </span>
                            </div>
                          )}
                        </div>

                        <button
                          className={`${styles.lobbyJoinBtn} ${room.status === 'active' ? styles.lobbySpectateBtn : ''}`}
                          onClick={() => router.push(`/rooms/${room.id}`)}
                        >
                          {room.status === 'waiting' ? (
                            <>
                              <Swords size={14} />
                              <span>Играть</span>
                            </>
                          ) : (
                            <>
                              <Eye size={14} />
                              <span>Смотреть</span>
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
      <div className={styles.footer}>Разработано с заботой по правилам ФШР • 2026</div>
    </div>
  );
}


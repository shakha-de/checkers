'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Crown,
  Copy,
  Send,
  ArrowLeft,
  Check,
  X,
  Swords,
  Users,
  MessageSquare,
  History,
  Trophy,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { GameState, Position, Move, getValidMoves, posEq, hasPos, colToLetter, rowToNumber } from '@/lib/checkers';
import { ChatMessage } from '@/lib/roomsStore';
import styles from './room.module.css';

export default function GameRoom() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.id as string;

  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<'w' | 'b' | 'spectator' | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [players, setPlayers] = useState<{ w: boolean; b: boolean } | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<'waiting' | 'active' | 'finished' | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [selectedPiece, setSelectedPiece] = useState<Position | null>(null);
  const [validDestinations, setValidDestinations] = useState<Move[]>([]);

  // UI state
  const [chatText, setChatText] = useState('');
  const [copied, setCopied] = useState(false);

  // Refs for auto scrolling chat
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // 1. Initial join and token setup
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const storedToken = localStorage.getItem(`checkers_token_${roomId}`);

    const joinRoom = async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}/join`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token: storedToken }),
        });

        if (!res.ok) {
          if (res.status === 404) {
            setError('Комната не найдена');
          } else {
            setError('Ошибка при входе в комнату');
          }
          setLoading(false);
          return;
        }

        const data = await res.json();
        localStorage.setItem(`checkers_token_${roomId}`, data.token);
        setToken(data.token);
        setRole(data.color);
      } catch (err) {
        console.error(err);
        setError('Не удалось подключиться к серверу');
        setLoading(false);
      }
    };

    joinRoom();
  }, [roomId]);

  // 2. Establish SSE connection
  useEffect(() => {
    if (!token) return;

    const eventSource = new EventSource(`/api/rooms/${roomId}/events?token=${token}`);

    eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'sync') {
          const payload = message.payload;
          setGameState(payload.gameState);
          setPlayers(payload.players);
          setChat(payload.chat);
          setStatus(payload.status);
          
          if (payload.role) {
            setRole(payload.role);
          }
          
          setLoading(false);
        }
      } catch (err) {
        console.error('Error parsing SSE event:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE Error:', err);
      // Wait before retrying is handled automatically by EventSource,
      // but we can check if it was closed
      if (eventSource.readyState === EventSource.CLOSED) {
        console.log('SSE connection closed. Reconnecting...');
      }
    };

    return () => {
      eventSource.close();
    };
  }, [roomId, token]);

  // 3. Auto-scroll chat to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chat]);

  // 4. Confetti effect on victory
  useEffect(() => {
    if (gameState?.winner && role) {
      if (gameState.winner === role) {
        confetti({
          particleCount: 150,
          spread: 80,
          origin: { y: 0.6 },
        });
      }
    }
  }, [gameState?.winner, role]);

  if (loading) {
    return (
      <div className={styles.layout} style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="glass" style={{ padding: '3rem', textAlign: 'center' }}>
          <div className="glow-text" style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem' }}>
            Загрузка игры...
          </div>
          <div className={styles.turnIndicatorDot} style={{ background: '#d4af37', margin: '0 auto', animation: 'pulseGold 1.5s infinite' }} />
        </div>
      </div>
    );
  }

  if (error || !gameState) {
    return (
      <div className={styles.layout} style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="glass" style={{ padding: '3rem', textAlign: 'center', maxWidth: '400px' }}>
          <div className="glow-text" style={{ fontSize: '1.5rem', fontWeight: 700, color: '#e53e3e', marginBottom: '1.5rem' }}>
            Ошибка
          </div>
          <p style={{ color: '#9e9cb0', marginBottom: '2rem' }}>{error || 'Не удалось загрузить игру'}</p>
          <button className={styles.controlBtn} onClick={() => router.push('/')} style={{ margin: '0 auto' }}>
            <ArrowLeft size={16} /> На главную
          </button>
        </div>
      </div>
    );
  }

  const { board, turn, activePiece, capturedPositions, winner, drawProposedBy } = gameState;

  // Verify if the current user can make a move
  const isMyTurn = turn === role && !winner;

  // Retrieve valid moves for the active player
  const validMoves = getValidMoves(board, turn, activePiece, capturedPositions);

  // Filter valid moves that are allowed to start a move
  // (In multi-jump, only the activePiece is allowed)
  const movablePositions = validMoves.map(m => m.from);

  // Copy invitation link to clipboard
  const handleCopyLink = () => {
    if (typeof window === 'undefined') return;
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Handle clicking a square
  const handleSquareClick = async (r: number, c: number) => {
    if (!isMyTurn) return;

    const clickedPos = { r, c };
    const piece = board[r][c];

    // 1. If clicking a cell that is a valid destination for the selected piece
    const matchedMove = validDestinations.find(d => d.to.r === r && d.to.c === c);
    if (matchedMove) {
      setSelectedPiece(null);
      setValidDestinations([]);
      
      // Post move action to server
      try {
        const res = await fetch(`/api/rooms/${roomId}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            actionType: 'move',
            data: { move: matchedMove },
          }),
        });
        if (!res.ok) {
          const errData = await res.json();
          alert(errData.error || 'Ошибка хода');
        }
      } catch (err) {
        console.error(err);
        alert('Не удалось отправить ход');
      }
      return;
    }

    // 2. Otherwise, check if clicking one of my own movable pieces
    if (piece && piece.player === role) {
      const isMovable = movablePositions.some(p => p.r === r && p.c === c);
      if (isMovable) {
        setSelectedPiece(clickedPos);
        const destinations = validMoves.filter(m => m.from.r === r && m.from.c === c);
        setValidDestinations(destinations);
      } else {
        // Not movable (must capture with another piece or not your turn)
        setSelectedPiece(null);
        setValidDestinations([]);
      }
    } else {
      // Clicked empty square (not valid destination) or opponent's piece
      setSelectedPiece(null);
      setValidDestinations([]);
    }
  };

  // Perform standard game actions
  const triggerAction = async (actionType: string, data: any = {}) => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, actionType, data }),
      });
      if (!res.ok) {
        const errData = await res.json();
        alert(errData.error || 'Ошибка действия');
      }
    } catch (err) {
      console.error(err);
      alert('Не удалось выполнить действие');
    }
  };

  // Send chat message
  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatText.trim()) return;
    triggerAction('chat', { text: chatText });
    setChatText('');
  };

  // Formatting move history list
  const formattedMoves: { white: string; black: string }[] = [];
  for (let i = 0; i < gameState.history.length; i += 2) {
    formattedMoves.push({
      white: gameState.history[i],
      black: gameState.history[i + 1] || '',
    });
  }

  // Render board rows & columns. Reverse if Black for correct perspective.
  const rowOrder = role === 'b' ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const colOrder = role === 'b' ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  const piecesToRender: { piece: any; r: number; c: number }[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = board[r][c];
      if (cell) {
        piecesToRender.push({ piece: cell, r, c });
      }
    }
  }

  return (
    <div className={styles.layout}>
      {/* Victory / Defeat Overlay */}
      {winner && (
        <div className={styles.overlay}>
          <div className={`${styles.overlayCard} glass`}>
            <div
              className={`${styles.overlayIconContainer} ${
                winner === 'w'
                  ? styles.overlayIconWinnerW
                  : winner === 'b'
                  ? styles.overlayIconWinnerB
                  : ''
              }`}
            >
              {winner === 'draw' ? <Users size={40} /> : <Trophy size={40} />}
            </div>
            <h2 className={styles.overlayTitle}>
              {winner === 'draw'
                ? 'Ничья!'
                : winner === role
                ? 'Победа!'
                : role === 'spectator'
                ? `Победа ${winner === 'w' ? 'Белых' : 'Черных'}!`
                : 'Поражение!'}
            </h2>
            <p className={styles.overlayDesc}>
              {winner === 'draw'
                ? 'Партия закончилась мирным соглашением сторон.'
                : winner === role
                ? 'Отличная игра! Вы разгромили соперника.'
                : role === 'spectator'
                ? 'Партия успешно завершена.'
                : 'Не расстраивайтесь, в следующей партии вам обязательно повезет!'}
            </p>
            {role !== 'spectator' && (
              <button
                className={styles.overlayActionBtn}
                onClick={() => triggerAction('restart')}
              >
                Играть снова
              </button>
            )}
            <button
              className={styles.controlBtn}
              onClick={() => router.push('/')}
              style={{ width: '100%' }}
            >
              На главную
            </button>
          </div>
        </div>
      )}

      {/* Left Area (Board & Header Controls) */}
      <div className={styles.mainArea}>
        {/* Header Controls */}
        <div className={`${styles.headerPanel} glass`}>
          <div className={styles.headerTop}>
            <div className={styles.roomInfo}>
              <div className={styles.roomTitle}>
                <Swords size={20} className="damkaCrown" />
                <span>Комната {roomId}</span>
              </div>
              <span className={styles.roomStatusText}>
                {role === 'w' && 'Вы играете за Белых (внизу)'}
                {role === 'b' && 'Вы играете за Черных (внизу)'}
                {role === 'spectator' && 'Режим зрителя'}
              </span>
            </div>

            <div className={styles.gameControls}>
              {role !== 'spectator' && !winner && (
                <>
                  <button
                    className={styles.controlBtn}
                    onClick={() => triggerAction('proposeDraw')}
                    disabled={drawProposedBy === role}
                  >
                    Предложить ничью
                  </button>
                  <button
                    className={`${styles.controlBtn} ${styles.controlBtnResign}`}
                    onClick={() => {
                      if (confirm('Вы уверены, что хотите сдаться?')) {
                        triggerAction('resign');
                      }
                    }}
                  >
                    Сдаться
                  </button>
                </>
              )}
              {winner && role !== 'spectator' && (
                <button
                  className={`${styles.controlBtn} ${styles.controlBtnRestart}`}
                  onClick={() => triggerAction('restart')}
                >
                  Начать заново
                </button>
              )}
              <button className={styles.controlBtn} onClick={() => router.push('/')}>
                <ArrowLeft size={14} /> Выйти
              </button>
            </div>
          </div>

          {/* Turn Banner */}
          {!winner && (
            <div
              className={`${styles.turnBanner} ${
                turn === 'w' ? styles.turnBannerWhite : styles.turnBannerBlack
              }`}
            >
              <div
                className={`${styles.turnIndicatorDot} ${
                  turn === 'w' ? styles.turnIndicatorDotWhite : styles.turnIndicatorDotBlack
                }`}
              />
              <span>
                {turn === role
                  ? 'Ваш ход!'
                  : `Ход ${turn === 'w' ? 'Белых' : 'Черных'}`}
                {activePiece && ' (вы обязаны завершить серию взятий)'}
              </span>
            </div>
          )}

          {/* Draw Proposal Banner */}
          {drawProposedBy && drawProposedBy !== role && !winner && (
            <div className={styles.proposalBanner}>
              <span className={styles.proposalText}>Соперник предлагает ничью!</span>
              <div className={styles.proposalButtons}>
                <button
                  className={styles.proposalAcceptBtn}
                  onClick={() => triggerAction('acceptDraw')}
                >
                  <Check size={14} style={{ display: 'inline', marginRight: '3px' }} /> Принять
                </button>
                <button
                  className={styles.proposalDeclineBtn}
                  onClick={() => triggerAction('declineDraw')}
                >
                  <X size={14} style={{ display: 'inline', marginRight: '3px' }} /> Отклонить
                </button>
              </div>
            </div>
          )}

          {/* Draw Proposal Pending */}
          {drawProposedBy && drawProposedBy === role && !winner && (
            <div className={styles.proposalBanner} style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
              <span className={styles.proposalText} style={{ color: 'var(--text-muted)' }}>
                Предложение ничьей отправлено. Ожидание ответа...
              </span>
            </div>
          )}
        </div>

        {/* Invite Link Card (Only shown when waiting for player) */}
        {status === 'waiting' && (
          <div className={`${styles.invitePanel} glass`}>
            <span className={styles.inviteLabel}>Пригласите друга для игры:</span>
            <div className={styles.inviteInputContainer}>
              <input
                type="text"
                readOnly
                className={styles.inviteInput}
                value={typeof window !== 'undefined' ? window.location.href : ''}
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button className={styles.copyBtn} onClick={handleCopyLink}>
                {copied ? (
                  <>
                    <Check size={16} />
                    <span>Скопировано!</span>
                  </>
                ) : (
                  <>
                    <Copy size={16} />
                    <span>Копировать</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Board Component */}
        <div className={styles.boardWrapper}>
          <div className={styles.boardContainer}>
            {rowOrder.map((r) => (
              <div className={styles.boardRow} key={`row-${r}`}>
                {colOrder.map((c) => {
                  const isDark = (r + c) % 2 === 1;
                  
                  // Highlights
                  const isSelected = selectedPiece && posEq(selectedPiece, { r, c });
                  const validMove = validDestinations.find(d => d.to.r === r && d.to.c === c);
                  const isValidDest = !!validMove;
                  const isCapture = validMove?.isCapture;

                  return (
                    <div
                      className={`${styles.cell} ${isDark ? styles.cellDark : styles.cellLight} ${
                        isSelected ? styles.cellSelected : ''
                      } ${isValidDest ? styles.cellValidMove : ''} ${
                        isValidDest && isCapture ? styles.cellValidCapture : ''
                      }`}
                      key={`cell-${r}-${c}`}
                      onClick={() => handleSquareClick(r, c)}
                    >
                      {/* Render labels on dark cells along bottom and left */}
                      {isDark && (role === 'b' ? r === 0 : r === 7) && (
                        <span className={`${styles.cellLabel} ${styles.cellLabelCol}`}>
                          {colToLetter(c)}
                        </span>
                      )}
                      {isDark && (role === 'b' ? c === 7 : c === 0) && (
                        <span className={`${styles.cellLabel} ${styles.cellLabelRow}`}>
                          {rowToNumber(r)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Absolute overlay for checker pieces to enable smooth movement transitions */}
            <div style={{ position: 'absolute', top: '12px', left: '12px', right: '12px', bottom: '12px', pointerEvents: 'none' }}>
              {piecesToRender.map(({ piece, r, c }) => {
                const topPercent = role === 'b' ? (7 - r) * 12.5 : r * 12.5;
                const leftPercent = role === 'b' ? (7 - c) * 12.5 : c * 12.5;
                
                const isSelected = selectedPiece && posEq(selectedPiece, { r, c });
                const hasMove = movablePositions.some(p => p.r === r && p.c === c);
                const isCapturedObstacle = hasPos(capturedPositions, { r, c });

                return (
                  <div
                    key={piece.id}
                    className={`${styles.pieceWrapper} ${isSelected ? styles.pieceWrapperSelected : ''}`}
                    style={{
                      top: `${topPercent}%`,
                      left: `${leftPercent}%`,
                    }}
                  >
                    <div
                      className={`${styles.piece} ${
                        piece.player === 'w' ? styles.pieceWhite : styles.pieceBlack
                      } ${isSelected ? styles.pieceSelected : ''} ${
                        isMyTurn && hasMove ? styles.pieceMovable : ''
                      } ${isCapturedObstacle ? styles.cellCapturedObstacle : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSquareClick(r, c);
                      }}
                    >
                      <div className={styles.pieceInnerRing} />
                      {piece.type === 'damka' && (
                        <Crown size={22} className={styles.damkaCrown} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Right Area (Move History & Chat) */}
      <div className={styles.sidebar}>
        {/* Move History */}
        <div className={`${styles.historyPanel} glass`}>
          <div className={styles.panelTitle}>
            <History size={16} />
            <span>История ходов</span>
          </div>
          <div className={styles.movesScroll}>
            {formattedMoves.length === 0 ? (
              <div className={styles.noMovesText}>Ходов еще не сделано</div>
            ) : (
              <div className={styles.movesGrid}>
                {formattedMoves.map((m, idx) => (
                  <div key={`history-row-${idx}`} style={{ display: 'contents' }}>
                    <span className={styles.moveIndex}>{idx + 1}.</span>
                    <span className={styles.moveNotation}>{m.white}</span>
                    <span className={styles.moveNotation} style={{ color: '#ffa3a3' }}>
                      {m.black}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Live Chat */}
        <div className={`${styles.chatPanel} glass`}>
          <div className={styles.panelTitle}>
            <MessageSquare size={16} />
            <span>Чат</span>
          </div>
          <div className={styles.chatScroll} ref={chatScrollRef}>
            {chat.map((msg) => {
              let senderClass = '';
              if (msg.sender === 'w') senderClass = styles.chatSenderW;
              else if (msg.sender === 'b') senderClass = styles.chatSenderB;
              else if (msg.sender === 'system') senderClass = styles.chatSystem;
              else senderClass = styles.chatSenderSpectator;

              return (
                <div key={msg.id} className={`${styles.chatMessage} ${senderClass}`}>
                  {msg.sender !== 'system' && (
                    <div className={styles.chatLabel}>
                      {msg.sender === 'w' ? 'Белые' : msg.sender === 'b' ? 'Черные' : 'Зритель'}
                    </div>
                  )}
                  <div>{msg.text}</div>
                </div>
              );
            })}
          </div>
          <form className={styles.chatForm} onSubmit={handleSendChat}>
            <input
              type="text"
              className={styles.chatInput}
              placeholder="Напишите сообщение..."
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
            />
            <button type="submit" className={styles.chatSendBtn}>
              <Send size={16} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

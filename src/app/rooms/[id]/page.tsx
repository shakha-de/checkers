'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Crown,
  Copy,
  Send,
  ArrowLeft,
  Check,
  X,
  Users,
  MessageSquare,
  History,
  Trophy,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import confetti from 'canvas-confetti';
import { GameState, Position, Move, getValidMoves, posEq, hasPos, colToLetter, rowToNumber, Piece, getCheckerJumps, getDamkaJumps, shouldPromote } from '@/lib/checkers';
import { supabase } from '@/lib/supabase';
import { playMoveSound, playCaptureSound, playPromotionSound } from '@/lib/sounds';
import { exportToPDN, reconstructBoardAtHistoryIndex } from '@/lib/pdn';
import styles from './room.module.css';

export interface ChatMessage {
  id: string;
  sender: 'w' | 'b' | 'system' | 'spectator';
  text: string;
  timestamp: number;
}

interface JumpStep {
  to: Position;
  captured: Position;
  steps: JumpStep[];
}

function getJumpTree(
  board: (Piece | null)[][],
  r: number,
  c: number,
  player: 'w' | 'b',
  captured: Position[]
): JumpStep[] {
  const piece = board[r][c];
  if (!piece) return [];

  let immediateJumps: Move[] = [];
  if (piece.type === 'checker') {
    immediateJumps = getCheckerJumps(board, r, c, player, captured);
  } else {
    immediateJumps = getDamkaJumps(board, r, c, player, captured);
  }

  const result: JumpStep[] = [];

  for (const jump of immediateJumps) {
    if (!jump.capturedPiece) continue;

    // Simulate board state after this jump
    const nextBoard = board.map(row => [...row]);
    const p = nextBoard[jump.from.r][jump.from.c];
    nextBoard[jump.from.r][jump.from.c] = null;
    nextBoard[jump.to.r][jump.to.c] = p;

    // Promote if needed
    if (p && shouldPromote(p, jump.to.r)) {
      p.type = 'damka';
    }

    const nextCaptured = [...captured, jump.capturedPiece];
    const subSteps = getJumpTree(nextBoard, jump.to.r, jump.to.c, player, nextCaptured);

    result.push({
      to: jump.to,
      captured: jump.capturedPiece,
      steps: subSteps
    });
  }

  return result;
}

interface FlattenedStep {
  to: Position;
  captured: Position;
  step: number;
}

function flattenPaths(
  tree: JumpStep[],
  currentPath: FlattenedStep[] = []
): FlattenedStep[][] {
  if (tree.length === 0) {
    return [currentPath];
  }

  const paths: FlattenedStep[][] = [];
  for (const node of tree) {
    const nextStep = currentPath.length + 1;
    const subPaths = flattenPaths(node.steps, [
      ...currentPath,
      { to: node.to, captured: node.captured, step: nextStep }
    ]);
    paths.push(...subPaths);
  }
  return paths;
}

export default function GameRoom() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.id as string;

  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<'w' | 'b' | 'spectator' | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<'waiting' | 'active' | 'finished' | null>(null);
  const [rawPlayers, setRawPlayers] = useState<{ w: string | null; b: string | null } | null>(null);
  const [aiCalculating, setAiCalculating] = useState(false);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [selectedPiece, setSelectedPiece] = useState<Position | null>(null);
  const [validDestinations, setValidDestinations] = useState<Move[]>([]);
  const [pendingAutoTarget, setPendingAutoTarget] = useState<Position | null>(null);

  // UI state
  const [chatText, setChatText] = useState('');
  const [copied, setCopied] = useState(false);
  const [isChatMinimized, setIsChatMinimized] = useState(false);
  const [isHistoryMinimized, setIsHistoryMinimized] = useState(false);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);

  // Refs for auto scrolling chat
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Send chat message
  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatText.trim()) return;
    triggerAction('chat', { text: chatText });
    setChatText('');
  };

  // Perform standard game actions
  const triggerAction = useCallback(async (actionType: string, data: Record<string, unknown> = {}) => {
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
  }, [roomId, token]);

  // Hook to handle AI player moves
  useEffect(() => {
    if (replayIndex !== null) return;
    if (!gameState || status !== 'active' || !rawPlayers || role === 'spectator' || !role) return;

    const currentTurn = gameState.turn;
    const opponentToken = currentTurn === 'w' ? rawPlayers.w : rawPlayers.b;
    const isOpponentAI = opponentToken?.startsWith('ai_') || false;

    if (!isOpponentAI || currentTurn === role) return;

    const difficulty = opponentToken!.replace('ai_', '') as 'easy' | 'medium' | 'hard';

    const calculateAndMove = async () => {
      // Set calculating state asynchronously to avoid React state in effect warnings
      Promise.resolve().then(() => setAiCalculating(true));
      
      // Delay the calculation slightly to make it feel natural and give a sense of "thinking"
      await new Promise(resolve => setTimeout(resolve, 800));

      try {
        const { getBestMove } = await import('@/lib/ai');
        const bestMove = getBestMove(gameState, difficulty);

        if (bestMove) {
          await triggerAction('move', { move: bestMove });
        }
      } catch (err) {
        console.error('AI calculation failed:', err);
      } finally {
        Promise.resolve().then(() => setAiCalculating(false));
      }
    };

    calculateAndMove();
  }, [gameState, status, rawPlayers, role, triggerAction, replayIndex]);

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

  // 2. Establish Supabase Realtime connection and fetch initial state
  useEffect(() => {
    if (!token) return;

    const fetchInitialRoomState = async () => {
      try {
        const { data: room, error: fetchErr } = await supabase
          .from('rooms')
          .select('*')
          .eq('id', roomId)
          .maybeSingle();

        if (fetchErr) {
          throw fetchErr;
        }

        if (room) {
          setGameState(room.game_state);
          setRawPlayers(room.players);
          setChat(room.chat || []);
          setStatus(room.status);
        }
        setLoading(false);
      } catch (err) {
        console.error('Error fetching initial room state:', err);
        setError('Не удалось получить состояние комнаты');
        setLoading(false);
      }
    };

    fetchInitialRoomState();

    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          const updatedRoom = payload.new as { game_state: GameState; players: { w: string | null; b: string | null }; chat: ChatMessage[]; status: 'waiting' | 'active' | 'finished' };
          if (updatedRoom) {
            setGameState(updatedRoom.game_state);
            setRawPlayers(updatedRoom.players);
            setChat(updatedRoom.chat || []);
            setStatus(updatedRoom.status);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, token]);

  // Audio state tracking
  const prevHistoryLenRef = useRef<number>(0);
  const prevDamkaCountRef = useRef<number>(0);
  const isFirstLoadRef = useRef<boolean>(true);

  // Hook to handle sound effects when the game state updates
  useEffect(() => {
    if (!gameState) return;

    const countDamkas = (b: (Piece | null)[][]) => {
      let count = 0;
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          if (b[r]?.[c]?.type === 'damka') {
            count++;
          }
        }
      }
      return count;
    };

    const currentLen = gameState.history.length;
    const currentDamkas = countDamkas(gameState.board);

    if (isFirstLoadRef.current) {
      prevHistoryLenRef.current = currentLen;
      prevDamkaCountRef.current = currentDamkas;
      isFirstLoadRef.current = false;
      return;
    }

    const prevLen = prevHistoryLenRef.current;
    const prevDamkas = prevDamkaCountRef.current;

    if (currentLen > prevLen) {
      const lastMove = gameState.history[currentLen - 1];
      const isCapture = lastMove.includes(':');

      if (currentDamkas > prevDamkas) {
        playPromotionSound();
      } else if (isCapture) {
        playCaptureSound();
      } else {
        playMoveSound();
      }
    }

    prevHistoryLenRef.current = currentLen;
    prevDamkaCountRef.current = currentDamkas;
  }, [gameState]);

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

  // 5. Auto-submit remaining jumps in a multi-jump path
  useEffect(() => {
    if (replayIndex !== null) return;
    if (!gameState) return;

    const isCurrentMyTurn = gameState.turn === role && !gameState.winner;
    if (!isCurrentMyTurn) {
      if (pendingAutoTarget !== null) {
        Promise.resolve().then(() => setPendingAutoTarget(null));
      }
      return;
    }

    if (!pendingAutoTarget) return;

    const { board, activePiece, capturedPositions, turn } = gameState;
    
    // If no activePiece is locked, we are waiting for the server to process the first jump of our turn.
    // We do not clear the pending target; we just wait.
    if (!activePiece) {
      return;
    }

    // Get valid moves for the active piece
    const validMovesForActive = getValidMoves(board, turn, activePiece, capturedPositions);

    // If the active piece is already at the target, we are done
    if (posEq(activePiece, pendingAutoTarget)) {
      if (pendingAutoTarget !== null) {
        Promise.resolve().then(() => setPendingAutoTarget(null));
      }
      return;
    }

    // Otherwise, calculate the jump tree from the active piece
    const currentJumpPaths = flattenPaths(
      getJumpTree(board, activePiece.r, activePiece.c, turn, capturedPositions)
    );

    // Find a path that leads to the pendingAutoTarget
    const pathForTarget = currentJumpPaths.find(path =>
      path.some(step => posEq(step.to, pendingAutoTarget))
    );

    if (pathForTarget) {
      // Find the first step of this path
      const firstStep = pathForTarget.find(step => step.step === 1);
      const matchedMove = firstStep
        ? validMovesForActive.find(d => posEq(d.to, firstStep.to))
        : null;

      if (matchedMove) {
        // Auto-submit this move with a delay for animations and sound effects
        const timer = setTimeout(async () => {
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
              alert(errData.error || 'Ошибка авто-хода');
              setPendingAutoTarget(null);
            }
          } catch (err) {
            console.error(err);
            setPendingAutoTarget(null);
          }
        }, 550);
        return () => clearTimeout(timer);
      }
    } else {
      // Target is no longer reachable, clear
      if (pendingAutoTarget !== null) {
        Promise.resolve().then(() => setPendingAutoTarget(null));
      }
    }
  }, [gameState, pendingAutoTarget, role, token, roomId, replayIndex]);

  // Replay Navigation handlers
  const handleReplayFirst = () => {
    setReplayIndex(0);
  };

  const handleReplayPrev = () => {
    setReplayIndex((prev) => {
      const historyLen = gameState?.history?.length ?? 0;
      if (prev === null) {
        return historyLen > 0 ? historyLen - 1 : null;
      }
      return prev > 0 ? prev - 1 : 0;
    });
  };

  const handleReplayNext = () => {
    setReplayIndex((prev) => {
      const historyLen = gameState?.history?.length ?? 0;
      if (prev === null) return null;
      if (prev < historyLen) return prev + 1;
      return null;
    });
  };

  const handleReplayLast = () => {
    setReplayIndex(null);
  };

  const handleExportPDN = () => {
    if (!gameState) return;
    const pdnContent = exportToPDN({
      game_state: gameState,
      players: rawPlayers ?? { w: null, b: null },
      id: roomId,
    });
    const blob = new Blob([pdnContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `checkers_${roomId}.pdn`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Keyboard navigation for history replay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }
      
      const historyLen = gameState?.history?.length ?? 0;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setReplayIndex((prev) => {
          if (prev === null) {
            return historyLen > 0 ? historyLen - 1 : null;
          }
          return prev > 0 ? prev - 1 : 0;
        });
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setReplayIndex((prev) => {
          if (prev === null) return null;
          if (prev < historyLen) return prev + 1;
          return null;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState?.history?.length]);

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

  const { board, turn, activePiece, capturedPositions, winner, drawProposedBy, score, mode } = gameState;

  const isReplaying = replayIndex !== null;
  const activeBoard = isReplaying 
    ? reconstructBoardAtHistoryIndex(gameState.history, replayIndex) 
    : board;

  const activeCapturedPositions = isReplaying ? [] : capturedPositions;

  // Verify if the current user can make a move
  const isMyTurn = !isReplaying && turn === role && !winner;

  // Retrieve valid moves for the active player
  const validMoves = isReplaying ? [] : getValidMoves(activeBoard, turn, activePiece, activeCapturedPositions);

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
    if (isReplaying || !isMyTurn) return;

    const clickedPos = { r, c };
    const piece = activeBoard[r][c];

    // 1. If clicking a cell that is a valid destination for the selected piece
    const matchedMove = validDestinations.find(d => d.to.r === r && d.to.c === c);
    if (matchedMove) {
      setPendingAutoTarget(null);
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

    // 2. Clicked a future destination cell in one of the paths (Step 2+)
    const pathForTarget = selectedJumpPaths.find(path =>
      path.some(step => posEq(step.to, clickedPos))
    );
    if (pathForTarget) {
      const firstStep = pathForTarget.find(step => step.step === 1);
      const matchedFirstMove = firstStep
        ? validDestinations.find(d => posEq(d.to, firstStep.to))
        : null;

      if (matchedFirstMove) {
        setPendingAutoTarget(clickedPos);
        setSelectedPiece(null);
        setValidDestinations([]);
        
        try {
          const res = await fetch(`/api/rooms/${roomId}/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token,
              actionType: 'move',
              data: { move: matchedFirstMove },
            }),
          });
          if (!res.ok) {
            const errData = await res.json();
            alert(errData.error || 'Ошибка хода');
            setPendingAutoTarget(null);
          }
        } catch (err) {
          console.error(err);
          alert('Не удалось отправить ход');
          setPendingAutoTarget(null);
        }
        return;
      }
    }

    // 3. Otherwise, check if clicking one of my own movable pieces
    if (piece && piece.player === role) {
      const isMovable = movablePositions.some(p => p.r === r && p.c === c);
      if (isMovable) {
        setPendingAutoTarget(null);
        setSelectedPiece(clickedPos);
        const destinations = validMoves.filter(m => m.from.r === r && m.from.c === c);
        setValidDestinations(destinations);
      } else {
        // Not movable (must capture with another piece or not your turn)
        setPendingAutoTarget(null);
        setSelectedPiece(null);
        setValidDestinations([]);
      }
    } else {
      // Clicked empty square (not valid destination) or opponent's piece
      setPendingAutoTarget(null);
      setSelectedPiece(null);
      setValidDestinations([]);
    }
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

  // If a piece is selected, calculate all its complete jump paths
  const selectedJumpPaths = selectedPiece
    ? flattenPaths(getJumpTree(activeBoard, selectedPiece.r, selectedPiece.c, turn, activeCapturedPositions))
    : [];

  const piecesToRender: { piece: Piece; r: number; c: number }[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = activeBoard[r][c];
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
                ? (mode === 'giveaway'
                    ? 'Вы первыми отдали все шашки или остались без ходов. Победа!'
                    : 'Отличная игра! Вы разгромили соперника.')
                : role === 'spectator'
                ? 'Партия успешно завершена.'
                : (mode === 'giveaway'
                    ? 'Соперник успел избавиться от всех шашек. Не расстраивайтесь!'
                    : 'Не расстраивайтесь, в следующей партии вам обязательно повезет!')}
            </p>
            {role !== 'spectator' && (
              <>
                {gameState.rematchProposedBy === role ? (
                  <div className={styles.rematchStatus}>
                    <span className={styles.rematchStatusText}>Ожидание согласия соперника...</span>
                  </div>
                ) : gameState.rematchProposedBy && gameState.rematchProposedBy !== role ? (
                  <div className={styles.rematchOfferGroup}>
                    <div className={styles.rematchOfferText}>Соперник предлагает реванш</div>
                    <div className={styles.rematchOfferButtons}>
                      <button
                        className={`${styles.overlayActionBtn} ${styles.rematchAcceptBtn}`}
                        onClick={() => triggerAction('restart')}
                      >
                        Принять
                      </button>
                      <button
                        className={`${styles.controlBtn} ${styles.rematchDeclineBtn}`}
                        onClick={() => triggerAction('declineRematch')}
                      >
                        Отклонить
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className={styles.overlayActionBtn}
                    onClick={() => triggerAction('restart')}
                  >
                    Играть снова
                  </button>
                )}
              </>
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
                <Link href="/" className={styles.logoLink} title="На главную">
                  <Image src="/logo.png" width={24} height={24} className={styles.logoMini} alt="Logo" priority />
                </Link>
                <span>Комната {roomId}</span>
                {mode === 'giveaway' && (
                  <span className={styles.modeBadge}>Поддавки</span>
                )}
              </div>
              <span className={styles.roomStatusText}>
                {role === 'w' && 'Вы играете за Белых (внизу)'}
                {role === 'b' && 'Вы играете за Черных (внизу)'}
                {role === 'spectator' && 'Режим зрителя'}
              </span>
            </div>

            {/* Scoreboard */}
            <div className={styles.scoreBoard} title="Счет матча (Белые : Черные)">
              <div className={styles.scorePlayer}>
                <span className={styles.scoreLabel}>Белые</span>
                <span className={`${styles.scoreNumber} ${styles.scoreNumberWhite}`}>
                  {score?.w ?? 0}
                </span>
              </div>
              <div className={styles.scoreColon}>:</div>
              <div className={styles.scorePlayer}>
                <span className={styles.scoreLabel}>Черные</span>
                <span className={`${styles.scoreNumber} ${styles.scoreNumberBlack}`}>
                  {score?.b ?? 0}
                </span>
              </div>
              {(score?.draws ?? 0) > 0 && (
                <div className={styles.scoreDrawsText} title="Ничьи">
                  ({score?.draws} Н)
                </div>
              )}
            </div>

            <div className={styles.gameControls}>
              {role !== 'spectator' && !winner && (
                <>
                  {mode !== 'giveaway' && (
                    <button
                      className={styles.controlBtn}
                      onClick={() => triggerAction('proposeDraw')}
                      disabled={drawProposedBy === role}
                    >
                      Предложить ничью
                    </button>
                  )}
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
                <>
                  {gameState.rematchProposedBy === role ? (
                    <div className={styles.rematchStatus} style={{ marginBottom: '0.5rem' }}>
                      <span className={styles.rematchStatusText}>Ожидание согласия соперника...</span>
                    </div>
                  ) : gameState.rematchProposedBy && gameState.rematchProposedBy !== role ? (
                    <div className={styles.rematchOfferGroup} style={{ marginBottom: '0.5rem' }}>
                      <div className={styles.rematchOfferText}>Соперник предлагает реванш</div>
                      <div className={styles.rematchOfferButtons}>
                        <button
                          className={`${styles.controlBtn} ${styles.controlBtnRestart}`}
                          onClick={() => triggerAction('restart')}
                          style={{ margin: 0 }}
                        >
                          Принять
                        </button>
                        <button
                          className={`${styles.controlBtn} ${styles.rematchDeclineBtn}`}
                          onClick={() => triggerAction('declineRematch')}
                          style={{ margin: 0 }}
                        >
                          Отклонить
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className={`${styles.controlBtn} ${styles.controlBtnRestart}`}
                      onClick={() => triggerAction('restart')}
                    >
                      Начать заново
                    </button>
                  )}
                </>
              )}
              <button className={styles.controlBtn} onClick={() => router.push('/')}>
                <ArrowLeft size={14} /> Выйти
              </button>
            </div>
          </div>

          {/* Replay / Turn Banner */}
          {replayIndex !== null ? (
            <div className={styles.replayBanner}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <History size={16} style={{ color: '#d4af37' }} />
                <span>Просмотр истории (ход {replayIndex} из {gameState.history.length})</span>
              </div>
              <button className={styles.replayBannerBtn} onClick={() => setReplayIndex(null)}>
                Вернуться к игре
              </button>
            </div>
          ) : (
            !winner && (
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
                  {aiCalculating && ' (ИИ думает...)'}
                </span>
              </div>
            )
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

                  // Find steps in the complete paths that land on (r, c)
                  const pathSteps = selectedJumpPaths
                    .flatMap(path => path)
                    .filter(step => posEq(step.to, { r, c }));
                  
                  const isFutureDest = pathSteps.length > 0 && !isValidDest;
                  const showStepNumber = pathSteps.length > 0;
                  const stepNumbers = showStepNumber
                    ? Array.from(new Set(pathSteps.map(s => s.step))).sort().join('/')
                    : '';

                  return (
                    <div
                      className={`${styles.cell} ${isDark ? styles.cellDark : styles.cellLight} ${
                        isSelected ? styles.cellSelected : ''
                      } ${isValidDest ? styles.cellValidMove : ''} ${
                        isValidDest && isCapture ? styles.cellValidCapture : ''
                      } ${isFutureDest ? styles.cellValidMove : ''}`}
                      key={`cell-${r}-${c}`}
                      onClick={() => handleSquareClick(r, c)}
                    >
                      {showStepNumber && (
                        <div className={styles.futureDestIndicator}>
                          <span>{stepNumbers}</span>
                        </div>
                      )}
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
                const isCapturedObstacle = hasPos(activeCapturedPositions, { r, c });

                // Find if this piece is captured in the selected piece's paths
                const captureSteps = selectedJumpPaths
                  .flatMap(path => path)
                  .filter(step => posEq(step.captured, { r, c }));
                const isTargetOfCapture = captureSteps.length > 0;
                const captureStepNumbers = isTargetOfCapture
                  ? Array.from(new Set(captureSteps.map(s => s.step))).sort().join('/')
                  : '';

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
                    {isTargetOfCapture && (
                      <div className={styles.captureTargetBadge}>
                        <span>⚔️ {captureStepNumbers}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Replay Controls */}
        {gameState.history.length > 0 && (
          <div className={styles.replayControls}>
            <button
              className={styles.replayNavBtn}
              onClick={handleReplayFirst}
              disabled={replayIndex === 0}
              title="В начало"
            >
              <ChevronsLeft size={18} />
            </button>
            <button
              className={styles.replayNavBtn}
              onClick={handleReplayPrev}
              disabled={replayIndex === 0}
              title="Назад"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className={styles.replayNavBtn}
              onClick={handleReplayNext}
              disabled={replayIndex === null}
              title="Вперед"
            >
              <ChevronRight size={18} />
            </button>
            <button
              className={styles.replayNavBtn}
              onClick={handleReplayLast}
              disabled={replayIndex === null}
              title="В реальное время"
            >
              <ChevronsRight size={18} />
            </button>
          </div>
        )}
      </div>

      {/* Right Area (Move History & Chat) */}
      <div className={styles.sidebar}>
        {/* Move History */}
        <div className={`${styles.historyPanel} glass ${isHistoryMinimized ? styles.panelMinimized : ''}`}>
          <div 
            className={`${styles.panelTitle} ${styles.panelTitleInteractive}`} 
            onClick={() => setIsHistoryMinimized(!isHistoryMinimized)}
          >
            <div className={styles.panelTitleText}>
              <History size={16} />
              <span>История ходов</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {!isHistoryMinimized && gameState.history.length > 0 && (
                <button
                  className={styles.pdnExportBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExportPDN();
                  }}
                  title="Скачать PDN (.pdn)"
                >
                  <Download size={14} />
                  <span>PDN</span>
                </button>
              )}
              {isHistoryMinimized ? <ChevronDown size={16} className={styles.chevronIcon} /> : <ChevronUp size={16} className={styles.chevronIcon} />}
            </div>
          </div>
          {!isHistoryMinimized && (
            <div className={styles.movesScroll}>
              {formattedMoves.length === 0 ? (
                <div className={styles.noMovesText}>Ходов еще не сделано</div>
              ) : (
                <div className={styles.movesGrid}>
                  {formattedMoves.map((m, idx) => {
                    const whiteIndex = 2 * idx + 1;
                    const blackIndex = 2 * idx + 2;
                    return (
                      <div key={`history-row-${idx}`} style={{ display: 'contents' }}>
                        <span className={styles.moveIndex}>{idx + 1}.</span>
                        <span 
                          className={`${styles.moveNotation} ${styles.moveNotationInteractive} ${replayIndex === whiteIndex ? styles.moveNotationActive : ''}`}
                          onClick={() => setReplayIndex(whiteIndex)}
                        >
                          {m.white}
                        </span>
                        {m.black && (
                          <span 
                            className={`${styles.moveNotation} ${styles.moveNotationInteractive} ${replayIndex === blackIndex ? styles.moveNotationActive : ''}`}
                            style={{ color: '#ffa3a3' }}
                            onClick={() => setReplayIndex(blackIndex)}
                          >
                            {m.black}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live Chat */}
        <div className={`${styles.chatPanel} glass ${isChatMinimized ? styles.panelMinimized : ''}`}>
          <div 
            className={`${styles.panelTitle} ${styles.panelTitleInteractive}`} 
            onClick={() => setIsChatMinimized(!isChatMinimized)}
          >
            <div className={styles.panelTitleText}>
              <MessageSquare size={16} />
              <span>Чат</span>
            </div>
            {isChatMinimized ? <ChevronDown size={16} className={styles.chevronIcon} /> : <ChevronUp size={16} className={styles.chevronIcon} />}
          </div>
          {!isChatMinimized && (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}

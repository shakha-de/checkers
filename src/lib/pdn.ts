import { Board, Position, initializeBoard } from './checkers';

/**
 * Converts a checkers notation coordinate (e.g. "a1", "h8") to row/col indexes.
 * Column: 'a' -> 0, 'b' -> 1, ..., 'h' -> 7
 * Row: '8' -> 0, '7' -> 1, ..., '1' -> 7
 */
export function notationToPos(notation: string): Position {
  if (!notation || notation.length < 2) {
    return { r: 0, c: 0 };
  }
  const colLetter = notation.charAt(0).toLowerCase();
  const rowNumStr = notation.substring(1);
  const c = colLetter.charCodeAt(0) - 97; // 'a' is 97
  const r = 8 - parseInt(rowNumStr, 10);
  return {
    r: Math.max(0, Math.min(7, r)),
    c: Math.max(0, Math.min(7, c)),
  };
}

/**
 * Reconstructs the board state after applying a specific number of moves from history.
 * targetIndex = 0 means starting position.
 * targetIndex = 1 means after history[0] has been played.
 * targetIndex = N means after history[N-1] has been played.
 */
export function reconstructBoardAtHistoryIndex(history: string[], targetIndex: number): Board {
  const board = initializeBoard();
  const stepsToApply = Math.max(0, Math.min(history.length, targetIndex));

  for (let i = 0; i < stepsToApply; i++) {
    const moveNotation = history[i];
    if (!moveNotation) continue;

    const isCapture = moveNotation.includes(':');
    const parts = moveNotation.split(/[-:]/);
    if (parts.length < 2) continue;

    const startPos = notationToPos(parts[0]);
    const piece = board[startPos.r][startPos.c];
    if (!piece) {
      // Piece should always be found in valid game history
      continue;
    }

    // Move the piece
    board[startPos.r][startPos.c] = null;

    const capturedPositions: Position[] = [];
    let currentPos = startPos;

    for (let pIdx = 1; pIdx < parts.length; pIdx++) {
      const nextPos = notationToPos(parts[pIdx]);

      if (isCapture) {
        // Find any piece along the diagonal between currentPos and nextPos
        const dr = Math.sign(nextPos.r - currentPos.r);
        const dc = Math.sign(nextPos.c - currentPos.c);

        let checkR = currentPos.r + dr;
        let checkC = currentPos.c + dc;
        while (checkR !== nextPos.r && checkC !== nextPos.c) {
          if (board[checkR][checkC] !== null) {
            capturedPositions.push({ r: checkR, c: checkC });
          }
          checkR += dr;
          checkC += dc;
        }
      }

      // Promote checker to damka if it lands on the promotion row at any point during its turn
      if (piece.type === 'checker') {
        if (
          (piece.player === 'w' && nextPos.r === 0) ||
          (piece.player === 'b' && nextPos.r === 7)
        ) {
          piece.type = 'damka';
        }
      }

      currentPos = nextPos;
    }

    // Place the piece at its final destination
    board[currentPos.r][currentPos.c] = piece;

    // Remove all captured pieces at the end of the turn (Russian checkers rule)
    for (const capPos of capturedPositions) {
      board[capPos.r][capPos.c] = null;
    }
  }

  return board;
}

export interface PDNRoom {
  game_state: {
    history: string[];
    winner: 'w' | 'b' | 'draw' | null;
  };
  players: {
    w: string | null;
    b: string | null;
  };
  id: string;
}

/**
 * Compiles metadata and moves to build a Portable Draughts Notation (.pdn) string.
 */
export function exportToPDN(room: PDNRoom): string {
  const gameState = room.game_state;
  const history = gameState.history || [];
  const players = room.players || {};
  const winner = gameState.winner;

  // Format players' names
  const resolvePlayerName = (token: string | null, colorLabel: string) => {
    if (!token) return colorLabel;
    if (token.startsWith('ai_')) {
      const difficulty = token.replace('ai_', '');
      const diffRu =
        difficulty === 'easy' ? 'Easy' : difficulty === 'hard' ? 'Hard' : 'Medium';
      return `AI (${diffRu})`;
    }
    return `Player (${colorLabel})`;
  };

  const whitePlayerName = resolvePlayerName(players.w, 'White');
  const blackPlayerName = resolvePlayerName(players.b, 'Black');

  // Format date
  const dateObj = new Date();
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const dateStr = `${year}.${month}.${day}`;

  // Resolve result
  let resultStr = '*'; // Active
  if (winner === 'w') {
    resultStr = '1-0';
  } else if (winner === 'b') {
    resultStr = '0-1';
  } else if (winner === 'draw') {
    resultStr = '1/2-1/2';
  }

  const headers = [
    `[Event "Online Checkers Game"]`,
    `[Site "Checkers Online"]`,
    `[Date "${dateStr}"]`,
    `[Round "1"]`,
    `[White "${whitePlayerName}"]`,
    `[Black "${blackPlayerName}"]`,
    `[Result "${resultStr}"]`,
    `[GameType "25"]`, // Russian checkers (Draughts-64 / Russian)
  ];

  // Group moves into white-black pairs
  const moves: string[] = [];
  for (let i = 0; i < history.length; i += 2) {
    const whiteMove = history[i];
    const blackMove = history[i + 1] || '';
    const moveIndex = Math.floor(i / 2) + 1;
    if (blackMove) {
      moves.push(`${moveIndex}. ${whiteMove} ${blackMove}`);
    } else {
      moves.push(`${moveIndex}. ${whiteMove}`);
    }
  }

  const movesBlock = moves.join(' ') + (moves.length > 0 ? ` ${resultStr}` : `${resultStr}`);

  return `${headers.join('\n')}\n\n${movesBlock}\n`;
}

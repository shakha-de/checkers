export type Player = 'w' | 'b'; // w = White, b = Black

export type PieceType = 'checker' | 'damka';

export interface Piece {
  id: string; // Unique ID for keying React elements and animations
  player: Player;
  type: PieceType;
}

export type Cell = Piece | null;

export type Board = Cell[][];

export interface Position {
  r: number;
  c: number;
}

export interface Move {
  from: Position;
  to: Position;
  isCapture: boolean;
  capturedPiece?: Position;
}

export interface GameState {
  board: Board;
  turn: Player;
  activePiece: Position | null; // Locked piece in the middle of a multi-jump
  capturedPositions: Position[]; // Pieces jumped in the current turn but not yet removed
  history: string[]; // Standard notation history, e.g., ["e3-d4", "d6-c5"]
  winner: Player | 'draw' | null;
  drawProposedBy: Player | null;
}

// Check if two positions are equal
export function posEq(p1: Position | null, p2: Position | null): boolean {
  if (!p1 || !p2) return false;
  return p1.r === p2.r && p1.c === p2.c;
}

// Check if a position is in a list of positions
export function hasPos(list: Position[], pos: Position): boolean {
  return list.some(p => posEq(p, pos));
}

// Convert column index to letter (A-H)
export function colToLetter(c: number): string {
  return String.fromCharCode(97 + c); // 0 -> 'a', 1 -> 'b', etc.
}

// Convert row index to standard checkers row (8-1)
export function rowToNumber(r: number): string {
  return (8 - r).toString(); // r=0 -> '8', r=7 -> '1'
}

// Convert position to notation, e.g., {r:7, c:0} -> "a1"
export function posToNotation(pos: Position): string {
  return `${colToLetter(pos.c)}${rowToNumber(pos.r)}`;
}

// Initialize board for Russian Checkers
// White is at the bottom (rows 5, 6, 7), Black at the top (rows 0, 1, 2)
// Dark squares are those where (row + col) is odd.
export function initializeBoard(): Board {
  const board: Board = Array(8)
    .fill(null)
    .map(() => Array(8).fill(null));

  let pieceIdCounter = 1;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) {
        if (r <= 2) {
          board[r][c] = {
            id: `b-${pieceIdCounter++}`,
            player: 'b',
            type: 'checker',
          };
        } else if (r >= 5) {
          board[r][c] = {
            id: `w-${pieceIdCounter++}`,
            player: 'w',
            type: 'checker',
          };
        }
      }
    }
  }

  return board;
}

// Deep copy board
export function copyBoard(board: Board): Board {
  return board.map(row => row.map(cell => (cell ? { ...cell } : null)));
}

// Get all possible jumps for a simple checker at (r, c)
export function getCheckerJumps(
  board: Board,
  r: number,
  c: number,
  player: Player,
  capturedPositions: Position[]
): Move[] {
  const jumps: Move[] = [];
  const opponent = player === 'w' ? 'b' : 'w';
  const directions = [
    { dr: -1, dc: -1 },
    { dr: -1, dc: 1 },
    { dr: 1, dc: -1 },
    { dr: 1, dc: 1 },
  ];

  for (const { dr, dc } of directions) {
    const oppR = r + dr;
    const oppC = c + dc;
    const landR = r + dr * 2;
    const landC = c + dc * 2;

    // Check bounds
    if (landR >= 0 && landR < 8 && landC >= 0 && landC < 8) {
      const oppPiece = board[oppR][oppC];
      const landPiece = board[landR][landC];

      // Jump is valid if:
      // 1. There is an opponent piece on the intermediate cell
      // 2. It has NOT already been captured in this turn
      // 3. The landing square is empty
      if (
        oppPiece &&
        oppPiece.player === opponent &&
        !hasPos(capturedPositions, { r: oppR, c: oppC }) &&
        landPiece === null
      ) {
        jumps.push({
          from: { r, c },
          to: { r: landR, c: landC },
          isCapture: true,
          capturedPiece: { r: oppR, c: oppC },
        });
      }
    }
  }

  return jumps;
}

// Get all possible jumps for a damka at (r, c)
export function getDamkaJumps(
  board: Board,
  r: number,
  c: number,
  player: Player,
  capturedPositions: Position[]
): Move[] {
  const jumps: Move[] = [];
  const opponent = player === 'w' ? 'b' : 'w';
  const directions = [
    { dr: -1, dc: -1 },
    { dr: -1, dc: 1 },
    { dr: 1, dc: -1 },
    { dr: 1, dc: 1 },
  ];

  for (const { dr, dc } of directions) {
    let currR = r + dr;
    let currC = c + dc;
    let foundOpponent: Position | null = null;

    // Scan along diagonal
    while (currR >= 0 && currR < 8 && currC >= 0 && currC < 8) {
      const piece = board[currR][currC];

      if (piece) {
        // If we hit a piece already captured, it acts as a blocker
        if (hasPos(capturedPositions, { r: currR, c: currC })) {
          break;
        }

        if (piece.player === player) {
          // Hit friendly piece, path is blocked
          break;
        } else {
          // Hit opponent piece
          if (foundOpponent) {
            // Cannot jump over two pieces on the same diagonal
            break;
          }
          foundOpponent = { r: currR, c: currC };
        }
      } else {
        // Empty square
        if (foundOpponent) {
          // This is a valid landing square behind the opponent piece
          jumps.push({
            from: { r, c },
            to: { r: currR, c: currC },
            isCapture: true,
            capturedPiece: foundOpponent,
          });
        }
      }

      currR += dr;
      currC += dc;
    }
  }

  return jumps;
}

// Get simple moves for a checker at (r, c)
export function getCheckerSimpleMoves(board: Board, r: number, c: number, player: Player): Move[] {
  const moves: Move[] = [];
  // Simple checkers can only move forward
  const dr = player === 'w' ? -1 : 1;
  const dcs = [-1, 1];

  for (const dc of dcs) {
    const targetR = r + dr;
    const targetC = c + dc;

    if (targetR >= 0 && targetR < 8 && targetC >= 0 && targetC < 8) {
      if (board[targetR][targetC] === null) {
        moves.push({
          from: { r, c },
          to: { r: targetR, c: targetC },
          isCapture: false,
        });
      }
    }
  }

  return moves;
}

// Get simple moves for a damka at (r, c)
export function getDamkaSimpleMoves(board: Board, r: number, c: number): Move[] {
  const moves: Move[] = [];
  const directions = [
    { dr: -1, dc: -1 },
    { dr: -1, dc: 1 },
    { dr: 1, dc: -1 },
    { dr: 1, dc: 1 },
  ];

  for (const { dr, dc } of directions) {
    let currR = r + dr;
    let currC = c + dc;

    while (currR >= 0 && currR < 8 && currC >= 0 && currC < 8) {
      if (board[currR][currC] === null) {
        moves.push({
          from: { r, c },
          to: { r: currR, c: currC },
          isCapture: false,
        });
      } else {
        // Blocked by any piece
        break;
      }
      currR += dr;
      currC += dc;
    }
  }

  return moves;
}

// Check if the player has ANY capture moves available on the board
export function playerHasCaptures(board: Board, player: Player, capturedPositions: Position[]): boolean {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && piece.player === player) {
        let jumps: Move[] = [];
        if (piece.type === 'checker') {
          jumps = getCheckerJumps(board, r, c, player, capturedPositions);
        } else {
          jumps = getDamkaJumps(board, r, c, player, capturedPositions);
        }
        if (jumps.length > 0) {
          return true;
        }
      }
    }
  }
  return false;
}

// Get all valid moves for the current state
export function getValidMoves(
  board: Board,
  player: Player,
  activePiece: Position | null,
  capturedPositions: Position[]
): Move[] {
  // If in a multi-jump, we are locked into the active piece
  if (activePiece) {
    const piece = board[activePiece.r][activePiece.c];
    if (!piece) return [];

    if (piece.type === 'checker') {
      return getCheckerJumps(board, activePiece.r, activePiece.c, player, capturedPositions);
    } else {
      return getDamkaJumps(board, activePiece.r, activePiece.c, player, capturedPositions);
    }
  }

  // Otherwise, check if ANY piece has captures (mandatory capturing rule)
  const hasCaptures = playerHasCaptures(board, player, capturedPositions);

  const validMoves: Move[] = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && piece.player === player) {
        if (hasCaptures) {
          // If captures are available, only return captures
          if (piece.type === 'checker') {
            validMoves.push(...getCheckerJumps(board, r, c, player, capturedPositions));
          } else {
            validMoves.push(...getDamkaJumps(board, r, c, player, capturedPositions));
          }
        } else {
          // Simple moves
          if (piece.type === 'checker') {
            validMoves.push(...getCheckerSimpleMoves(board, r, c, player));
          } else {
            validMoves.push(...getDamkaSimpleMoves(board, r, c));
          }
        }
      }
    }
  }

  return validMoves;
}

// Check if a piece should be promoted to a damka
export function shouldPromote(piece: Piece, r: number): boolean {
  if (piece.type === 'damka') return false;
  return (piece.player === 'w' && r === 0) || (piece.player === 'b' && r === 7);
}

// Check if player has any legal moves left
export function hasAnyLegalMoves(board: Board, player: Player): boolean {
  const moves = getValidMoves(board, player, null, []);
  return moves.length > 0;
}

// Execute a move on the board
// Returns the updated board, and whether the turn should continue (in case of multi-jump)
export function makeMove(
  state: GameState,
  move: Move
): {
  nextState: GameState;
  turnEnded: boolean;
} {
  const nextBoard = copyBoard(state.board);
  const { from, to, isCapture, capturedPiece } = move;

  const piece = nextBoard[from.r][from.c];
  if (!piece) {
    return { nextState: state, turnEnded: true };
  }

  // Move the piece
  nextBoard[from.r][from.c] = null;
  nextBoard[to.r][to.c] = piece;

  const nextCapturedPositions = [...state.capturedPositions];
  if (isCapture && capturedPiece) {
    nextCapturedPositions.push(capturedPiece);
  }

  // Immediate promotion during a jump or normal move
  let promotedThisMove = false;
  if (shouldPromote(piece, to.r)) {
    piece.type = 'damka';
    promotedThisMove = true;
  }

  // Check if turn ends
  let turnEnded = true;
  let nextActivePiece: Position | null = null;

  if (isCapture) {
    // Check if the piece has more jumps from its new position
    // Note: It checks with the updated piece type (could be damka now!)
    let furtherJumps: Move[] = [];
    if (piece.type === 'checker') {
      furtherJumps = getCheckerJumps(nextBoard, to.r, to.c, state.turn, nextCapturedPositions);
    } else {
      furtherJumps = getDamkaJumps(nextBoard, to.r, to.c, state.turn, nextCapturedPositions);
    }

    if (furtherJumps.length > 0) {
      // Must continue jumping
      turnEnded = false;
      nextActivePiece = { r: to.r, c: to.c };
    }
  }

  // Create move notation
  // Simple move: e3-d4. Capture: e3:c5 or e3:a7
  const notationFrom = posToNotation(from);
  const notationTo = posToNotation(to);
  const notationSeparator = isCapture ? ':' : '-';
  const moveNotation = `${notationFrom}${notationSeparator}${notationTo}`;

  let nextHistory = [...state.history];

  if (state.activePiece) {
    // If it was a continuation of a multi-jump, append to the last move in history
    const lastIdx = nextHistory.length - 1;
    if (lastIdx >= 0) {
      nextHistory[lastIdx] = `${nextHistory[lastIdx]}:${notationTo}`;
    } else {
      nextHistory.push(moveNotation);
    }
  } else {
    nextHistory.push(moveNotation);
  }

  // If the turn ended, clean up captured pieces and reset active states
  let nextTurn = state.turn;
  if (turnEnded) {
    // Remove all captured pieces from board
    for (const pos of nextCapturedPositions) {
      nextBoard[pos.r][pos.c] = null;
    }
    // Switch turn
    nextTurn = state.turn === 'w' ? 'b' : 'w';
    nextCapturedPositions.length = 0; // Clear captures
  }

  // Check win/loss conditions for the NEXT player
  let nextWinner: Player | 'draw' | null = null;
  if (turnEnded) {
    if (!hasAnyLegalMoves(nextBoard, nextTurn)) {
      // If the next player has no moves, the current player wins!
      nextWinner = state.turn;
    }
  }

  // Create the next state
  const nextState: GameState = {
    board: nextBoard,
    turn: nextTurn,
    activePiece: nextActivePiece,
    capturedPositions: nextCapturedPositions,
    history: nextHistory,
    winner: nextWinner || state.winner,
    drawProposedBy: null, // Clear draw proposal on any move
  };

  return {
    nextState,
    turnEnded,
  };
}

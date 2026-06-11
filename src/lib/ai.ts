import { Board, Player, GameState, Move, getValidMoves, makeMove } from './checkers';

/**
 * Heuristic evaluation function for Russian Checkers.
 * Positive score favors activePlayer. Negative score favors the opponent.
 */
export function evaluateBoard(board: Board, activePlayer: Player): number {
  let score = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;

      const isMe = piece.player === activePlayer;
      const multiplier = isMe ? 1 : -1;

      // 1. Material Base Value
      // Kings (damka) are highly valuable, usually worth 3 to 4 normal checkers
      const pieceVal = piece.type === 'damka' ? 375 : 100;
      
      // 2. Positional Heuristics
      let posVal = 0;

      // Central Ring Control: controlling the center limits opponent movement
      if (r >= 2 && r <= 5 && c >= 2 && c <= 5) {
        posVal += 15;
      }

      // Checkers Progression: normal checkers gain value as they approach promotion rank
      if (piece.type === 'checker') {
        if (piece.player === 'w') {
          // White advances up towards row 0
          posVal += (7 - r) * 5;
        } else {
          // Black advances down towards row 7
          posVal += r * 5;
        }
      }

      // Home Rank Defense: keeping pieces on the back row blocks opponent promotions
      if (piece.type === 'checker') {
        if (piece.player === 'w' && r === 7) {
          posVal += 25;
        } else if (piece.player === 'b' && r === 0) {
          posVal += 25;
        }
      }

      score += (pieceVal + posVal) * multiplier;
    }
  }

  return score;
}

/**
 * Minimax algorithm with Alpha-Beta pruning.
 */
function minimax(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  isMaximizing: boolean,
  aiColor: Player
): { score: number; move: Move | null } {
  // 1. Terminal Node Checks
  if (state.winner) {
    if (state.winner === 'draw') return { score: 0, move: null };
    // Prefer winning faster and losing slower
    const winScore = state.winner === aiColor ? (100000 + depth) : (-100000 - depth);
    return { score: winScore, move: null };
  }

  const validMoves = getValidMoves(
    state.board,
    state.turn,
    state.activePiece,
    state.capturedPositions
  );

  if (validMoves.length === 0) {
    // If turn player has no moves, they lose
    const winScore = state.turn === aiColor ? (-100000 - depth) : (100000 + depth);
    return { score: winScore, move: null };
  }

  if (depth === 0) {
    return { score: evaluateBoard(state.board, aiColor), move: null };
  }

  // 2. Minimax Branches
  if (isMaximizing) {
    let maxScore = -Infinity;
    let bestMove: Move | null = null;

    for (const move of validMoves) {
      const { nextState, turnEnded } = makeMove(state, move);
      
      // If turn did not end (continuation of multi-jump), the next depth search is still maximizing!
      const nextIsMaximizing = turnEnded ? false : true;
      const nextDepth = turnEnded ? depth - 1 : depth;

      const result = minimax(nextState, nextDepth, alpha, beta, nextIsMaximizing, aiColor);
      
      if (result.score > maxScore) {
        maxScore = result.score;
        bestMove = move;
      }
      alpha = Math.max(alpha, result.score);
      if (beta <= alpha) {
        break; // beta pruning
      }
    }

    return { score: maxScore, move: bestMove };
  } else {
    let minScore = Infinity;
    let bestMove: Move | null = null;

    for (const move of validMoves) {
      const { nextState, turnEnded } = makeMove(state, move);

      // If turn did not end (continuation of multi-jump), the next depth search is still minimizing!
      const nextIsMaximizing = turnEnded ? true : false;
      const nextDepth = turnEnded ? depth - 1 : depth;

      const result = minimax(nextState, nextDepth, alpha, beta, nextIsMaximizing, aiColor);

      if (result.score < minScore) {
        minScore = result.score;
        bestMove = move;
      }
      beta = Math.min(beta, result.score);
      if (beta <= alpha) {
        break; // alpha pruning
      }
    }

    return { score: minScore, move: bestMove };
  }
}

/**
 * Calculates the best move for the AI opponent based on difficulty settings.
 */
export function getBestMove(state: GameState, difficulty: 'easy' | 'medium' | 'hard'): Move | null {
  const validMoves = getValidMoves(
    state.board,
    state.turn,
    state.activePiece,
    state.capturedPositions
  );

  if (validMoves.length === 0) return null;

  // 1. Easy Mode: Searches at shallow depth (2) and has a 30% chance to play a random move
  if (difficulty === 'easy') {
    if (Math.random() < 0.3) {
      const randomIdx = Math.floor(Math.random() * validMoves.length);
      return validMoves[randomIdx];
    }
    const result = minimax(state, 2, -Infinity, Infinity, true, state.turn);
    return result.move || validMoves[0];
  }

  // 2. Medium Mode: Searches 4 plys deep, solid casual play
  if (difficulty === 'medium') {
    const result = minimax(state, 4, -Infinity, Infinity, true, state.turn);
    return result.move || validMoves[0];
  }

  // 3. Hard Mode: Searches 6 plys deep, optimal heuristic decision tree
  const result = minimax(state, 6, -Infinity, Infinity, true, state.turn);
  return result.move || validMoves[0];
}

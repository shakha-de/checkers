import { NextResponse } from 'next/server';
import { getValidMoves, makeMove, initializeBoard, Player } from '@/lib/checkers';
import { supabase } from '@/lib/supabase';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    const { data: room, error: fetchError } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    const { token, actionType, data } = await request.json();

    // Verify player color based on token
    let playerColor: Player | null = null;
    if (room.players.w === token) playerColor = 'w';
    else if (room.players.b === token) playerColor = 'b';

    if (!playerColor && actionType !== 'chat') {
      // Spectators can only chat, they cannot make moves or resign
      return NextResponse.json({ error: 'Unauthorized action' }, { status: 403 });
    }

    const sysMsgId = () => `sys-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    // Clone mutable objects
    let gameState = { ...room.game_state };
    if (!gameState.score) {
      gameState.score = { w: 0, b: 0, draws: 0 };
    }
    let status = room.status;
    let chat = [...room.chat];

    switch (actionType) {
      case 'move': {
        if (!playerColor) return NextResponse.json({ error: 'Spectators cannot move' }, { status: 403 });
        if (gameState.winner) return NextResponse.json({ error: 'Game already finished' }, { status: 400 });
        if (gameState.turn !== playerColor) {
          return NextResponse.json({ error: 'Not your turn' }, { status: 400 });
        }

        const moveInput = data.move;
        
        // Retrieve valid moves from engine
        const validMoves = getValidMoves(
          gameState.board,
          gameState.turn,
          gameState.activePiece,
          gameState.capturedPositions
        );

        // Find matches in valid moves
        const matchedMove = validMoves.find(
          m =>
            m.from.r === moveInput.from.r &&
            m.from.c === moveInput.from.c &&
            m.to.r === moveInput.to.r &&
            m.to.c === moveInput.to.c
        );

        if (!matchedMove) {
          return NextResponse.json({ error: 'Illegal move' }, { status: 400 });
        }

        // Apply move
        const { nextState } = makeMove(gameState, matchedMove);
        nextState.score = gameState.score; // Preserve score
        gameState = nextState;

        // If winner is decided, update room status
        if (gameState.winner) {
          status = 'finished';
          const winnerText = gameState.winner === 'draw'
            ? 'Игра завершилась вничью!'
            : `Игра окончена! Победили ${gameState.winner === 'w' ? 'Белые' : 'Черные'}.`;
          
          chat.push({
            id: sysMsgId(),
            sender: 'system',
            text: winnerText,
            timestamp: Date.now(),
          });
        }

        break;
      }

      case 'resign': {
        if (!playerColor) return NextResponse.json({ error: 'Spectators cannot resign' }, { status: 403 });
        if (gameState.winner) return NextResponse.json({ error: 'Game already finished' }, { status: 400 });

        const opponentColor = playerColor === 'w' ? 'b' : 'w';
        gameState.winner = opponentColor;
        status = 'finished';

        chat.push({
          id: sysMsgId(),
          sender: 'system',
          text: `${playerColor === 'w' ? 'Белые' : 'Черные'} сдались. Победили ${opponentColor === 'w' ? 'Белые' : 'Черные'}!`,
          timestamp: Date.now(),
        });
        break;
      }

      case 'proposeDraw': {
        if (!playerColor) return NextResponse.json({ error: 'Spectators cannot propose draw' }, { status: 403 });
        if (gameState.winner) return NextResponse.json({ error: 'Game already finished' }, { status: 400 });

        const opponentColor = playerColor === 'w' ? 'b' : 'w';

        if (gameState.drawProposedBy === opponentColor) {
          // Both proposed, it is a draw!
          gameState.winner = 'draw';
          gameState.drawProposedBy = null;
          status = 'finished';
          chat.push({
            id: sysMsgId(),
            sender: 'system',
            text: 'Оба игрока согласились на ничью. Ничья!',
            timestamp: Date.now(),
          });
        } else {
          gameState.drawProposedBy = playerColor;
          chat.push({
            id: sysMsgId(),
            sender: 'system',
            text: `${playerColor === 'w' ? 'Белые' : 'Черные'} предлагают ничью.`,
            timestamp: Date.now(),
          });
        }
        break;
      }

      case 'acceptDraw': {
        if (!playerColor) return NextResponse.json({ error: 'Spectators cannot accept draw' }, { status: 403 });
        if (gameState.winner) return NextResponse.json({ error: 'Game already finished' }, { status: 400 });

        const opponentColor = playerColor === 'w' ? 'b' : 'w';
        if (gameState.drawProposedBy === opponentColor) {
          gameState.winner = 'draw';
          gameState.drawProposedBy = null;
          status = 'finished';
          chat.push({
            id: sysMsgId(),
            sender: 'system',
            text: `${playerColor === 'w' ? 'Белые' : 'Черные'} приняли предложение о ничьей. Ничья!`,
            timestamp: Date.now(),
          });
        }
        break;
      }

      case 'declineDraw': {
        if (!playerColor) return NextResponse.json({ error: 'Spectators cannot decline draw' }, { status: 403 });
        if (gameState.winner) return NextResponse.json({ error: 'Game already finished' }, { status: 400 });

        const opponentColor = playerColor === 'w' ? 'b' : 'w';
        if (gameState.drawProposedBy === opponentColor) {
          gameState.drawProposedBy = null;
          chat.push({
            id: sysMsgId(),
            sender: 'system',
            text: `${playerColor === 'w' ? 'Белые' : 'Черные'} отклонили предложение о ничьей.`,
            timestamp: Date.now(),
          });
        }
        break;
      }

      case 'restart': {
        if (!playerColor) return NextResponse.json({ error: 'Spectators cannot restart' }, { status: 403 });
        if (!gameState.winner) return NextResponse.json({ error: 'Cannot restart active game' }, { status: 400 });

        const opponentColor = playerColor === 'w' ? 'b' : 'w';

        if (gameState.rematchProposedBy === opponentColor) {
          // Both agreed, reset board and status
          gameState = {
            board: initializeBoard(),
            turn: 'w',
            activePiece: null,
            capturedPositions: [],
            history: [],
            winner: null,
            drawProposedBy: null,
            rematchProposedBy: null,
            score: gameState.score, // Preserve score
          };
          status = 'active';

          chat.push({
            id: sysMsgId(),
            sender: 'system',
            text: 'Реванш принят! Игра перезапущена. Ход белых.',
            timestamp: Date.now(),
          });
        } else {
          // Propose rematch
          gameState.rematchProposedBy = playerColor;
          chat.push({
            id: sysMsgId(),
            sender: 'system',
            text: `${playerColor === 'w' ? 'Белые' : 'Черные'} предлагают реванш.`,
            timestamp: Date.now(),
          });
        }
        break;
      }

      case 'declineRematch': {
        if (!playerColor) return NextResponse.json({ error: 'Spectators cannot decline rematch' }, { status: 403 });
        if (!gameState.winner) return NextResponse.json({ error: 'Game is not finished' }, { status: 400 });

        const opponentColor = playerColor === 'w' ? 'b' : 'w';
        if (gameState.rematchProposedBy === opponentColor) {
          gameState.rematchProposedBy = null;
          chat.push({
            id: sysMsgId(),
            sender: 'system',
            text: `${playerColor === 'w' ? 'Белые' : 'Черные'} отклонили предложение о реванше.`,
            timestamp: Date.now(),
          });
        }
        break;
      }

      case 'chat': {
        const text = data.text?.trim();
        if (!text) {
          return NextResponse.json({ error: 'Empty message' }, { status: 400 });
        }

        const senderRole = playerColor || 'spectator';
        const newMessage = {
          id: `chat-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          sender: senderRole,
          text: text,
          timestamp: Date.now(),
        };

        chat.push(newMessage);
        break;
      }

      default:
        return NextResponse.json({ error: 'Unknown action type' }, { status: 400 });
    }

    // If the game just finished, increment the score
    if (status === 'finished' && room.status !== 'finished') {
      if (gameState.winner === 'w') gameState.score.w++;
      else if (gameState.winner === 'b') gameState.score.b++;
      else if (gameState.winner === 'draw') gameState.score.draws++;
    }

    // Save updated values to Supabase
    const { error: updateError } = await supabase
      .from('rooms')
      .update({
        game_state: gameState,
        status,
        chat,
      })
      .eq('id', id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error handling action', error);
    return NextResponse.json({ error: error?.message || 'Failed to process action' }, { status: 500 });
  }
}

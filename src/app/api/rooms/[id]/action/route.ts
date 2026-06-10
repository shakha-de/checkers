import { NextResponse } from 'next/server';
import { roomsStore, broadcastToRoom, ChatMessage } from '@/lib/roomsStore';
import { getValidMoves, makeMove, initializeBoard, Player } from '@/lib/checkers';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const room = roomsStore.get(id);

    if (!room) {
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

    switch (actionType) {
      case 'move': {
        if (!playerColor) return NextResponse.json({ error: 'Spectators cannot move' }, { status: 403 });
        if (room.gameState.winner) return NextResponse.json({ error: 'Game already finished' }, { status: 400 });
        if (room.gameState.turn !== playerColor) {
          return NextResponse.json({ error: 'Not your turn' }, { status: 400 });
        }

        const moveInput = data.move;
        
        // Retrieve valid moves from engine
        const validMoves = getValidMoves(
          room.gameState.board,
          room.gameState.turn,
          room.gameState.activePiece,
          room.gameState.capturedPositions
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
        const { nextState, turnEnded } = makeMove(room.gameState, matchedMove);
        room.gameState = nextState;

        // If winner is decided, update room status
        if (room.gameState.winner) {
          room.status = 'finished';
          const winnerText = room.gameState.winner === 'draw'
            ? 'Игра завершилась вничью!'
            : `Игра окончена! Победили ${room.gameState.winner === 'w' ? 'Белые' : 'Черные'}.`;
          
          room.chat.push({
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
        if (room.gameState.winner) return NextResponse.json({ error: 'Game already finished' }, { status: 400 });

        const opponentColor = playerColor === 'w' ? 'b' : 'w';
        room.gameState.winner = opponentColor;
        room.status = 'finished';

        room.chat.push({
          id: sysMsgId(),
          sender: 'system',
          text: `${playerColor === 'w' ? 'Белые' : 'Черные'} сдались. Победили ${opponentColor === 'w' ? 'Белые' : 'Черные'}!`,
          timestamp: Date.now(),
        });
        break;
      }

      case 'proposeDraw': {
        if (!playerColor) return NextResponse.json({ error: 'Spectators cannot propose draw' }, { status: 403 });
        if (room.gameState.winner) return NextResponse.json({ error: 'Game already finished' }, { status: 400 });

        const opponentColor = playerColor === 'w' ? 'b' : 'w';

        if (room.gameState.drawProposedBy === opponentColor) {
          // Both proposed, it is a draw!
          room.gameState.winner = 'draw';
          room.gameState.drawProposedBy = null;
          room.status = 'finished';
          room.chat.push({
            id: sysMsgId(),
            sender: 'system',
            text: 'Оба игрока согласились на ничью. Ничья!',
            timestamp: Date.now(),
          });
        } else {
          room.gameState.drawProposedBy = playerColor;
          room.chat.push({
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
        if (room.gameState.winner) return NextResponse.json({ error: 'Game already finished' }, { status: 400 });

        const opponentColor = playerColor === 'w' ? 'b' : 'w';
        if (room.gameState.drawProposedBy === opponentColor) {
          room.gameState.winner = 'draw';
          room.gameState.drawProposedBy = null;
          room.status = 'finished';
          room.chat.push({
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
        if (room.gameState.winner) return NextResponse.json({ error: 'Game already finished' }, { status: 400 });

        const opponentColor = playerColor === 'w' ? 'b' : 'w';
        if (room.gameState.drawProposedBy === opponentColor) {
          room.gameState.drawProposedBy = null;
          room.chat.push({
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
        
        // Reset the board and state
        room.gameState = {
          board: initializeBoard(),
          turn: 'w',
          activePiece: null,
          capturedPositions: [],
          history: [],
          winner: null,
          drawProposedBy: null,
        };
        room.status = 'active';

        room.chat.push({
          id: sysMsgId(),
          sender: 'system',
          text: 'Игра перезапущена! Ход белых.',
          timestamp: Date.now(),
        });
        break;
      }

      case 'chat': {
        const text = data.text?.trim();
        if (!text) {
          return NextResponse.json({ error: 'Empty message' }, { status: 400 });
        }

        const senderRole = playerColor || 'spectator';
        const senderName = senderRole === 'w' 
          ? 'Белые' 
          : senderRole === 'b' 
            ? 'Черные' 
            : 'Зритель';

        const newMessage: ChatMessage = {
          id: `chat-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          sender: senderRole,
          text: text,
          timestamp: Date.now(),
        };

        room.chat.push(newMessage);
        break;
      }

      default:
        return NextResponse.json({ error: 'Unknown action type' }, { status: 400 });
    }

    // Broadcast the updated state to all connected SSE clients
    broadcastToRoom(room, 'sync', {
      gameState: room.gameState,
      players: {
        w: room.players.w ? true : false,
        b: room.players.b ? true : false,
      },
      chat: room.chat,
      status: room.status,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error handling action', error);
    return NextResponse.json({ error: 'Failed to process action' }, { status: 500 });
  }
}

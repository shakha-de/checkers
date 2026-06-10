import { NextResponse } from 'next/server';
import { roomsStore, broadcastToRoom } from '@/lib/roomsStore';

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

    const body = await request.json().catch(() => ({}));
    const existingToken = body.token;

    // 1. If player already has a token for this room, return their color
    if (existingToken) {
      if (room.players.w === existingToken) {
        return NextResponse.json({ token: existingToken, color: 'w' });
      }
      if (room.players.b === existingToken) {
        return NextResponse.json({ token: existingToken, color: 'b' });
      }
    }

    // 2. Otherwise, assign an empty slot
    const newToken = Math.random().toString(36).substring(2, 15);
    let assignedColor: 'w' | 'b' | 'spectator' = 'spectator';

    if (!room.players.w) {
      room.players.w = newToken;
      assignedColor = 'w';
    } else if (!room.players.b) {
      room.players.b = newToken;
      assignedColor = 'b';
    }

    if (assignedColor !== 'spectator') {
      const isGameStarting = room.players.w && room.players.b;
      if (isGameStarting) {
        room.status = 'active';
        room.chat.push({
          id: `sys-start-${Date.now()}`,
          sender: 'system',
          text: 'Соперник присоединился. Игра началась! Ход белых.',
          timestamp: Date.now(),
        });
      } else {
        room.chat.push({
          id: `sys-join-${Date.now()}`,
          sender: 'system',
          text: `Игрок присоединился за ${assignedColor === 'w' ? 'белых' : 'черных'}. Ожидание второго игрока...`,
          timestamp: Date.now(),
        });
      }

      // Broadcast room update to all SSE subscribers
      broadcastToRoom(room, 'sync', {
        gameState: room.gameState,
        players: {
          w: room.players.w ? true : false,
          b: room.players.b ? true : false,
        },
        chat: room.chat,
        status: room.status,
      });

      return NextResponse.json({
        token: newToken,
        color: assignedColor,
      });
    }

    // Spectator mode if room is full
    return NextResponse.json({
      token: existingToken || newToken,
      color: 'spectator',
    });
  } catch (error) {
    console.error('Error joining room', error);
    return NextResponse.json({ error: 'Failed to join room' }, { status: 500 });
  }
}

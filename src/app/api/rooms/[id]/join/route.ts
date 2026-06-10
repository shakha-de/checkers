import { NextResponse } from 'next/server';
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

    const players = { ...room.players };
    const chat = [...room.chat];
    let status = room.status;

    if (!players.w) {
      players.w = newToken;
      assignedColor = 'w';
    } else if (!players.b) {
      players.b = newToken;
      assignedColor = 'b';
    }

    if (assignedColor !== 'spectator') {
      const isGameStarting = players.w && players.b;
      if (isGameStarting) {
        status = 'active';
        chat.push({
          id: `sys-start-${Date.now()}`,
          sender: 'system',
          text: 'Соперник присоединился. Игра началась! Ход белых.',
          timestamp: Date.now(),
        });
      } else {
        chat.push({
          id: `sys-join-${Date.now()}`,
          sender: 'system',
          text: `Игрок присоединился за ${assignedColor === 'w' ? 'белых' : 'черных'}. Ожидание второго игрока...`,
          timestamp: Date.now(),
        });
      }

      // Update in Supabase (Realtime will broadcast this update automatically)
      const { error: updateError } = await supabase
        .from('rooms')
        .update({
          players,
          chat,
          status,
        })
        .eq('id', id);

      if (updateError) {
        throw new Error(updateError.message);
      }

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
  } catch (error: any) {
    console.error('Error joining room', error);
    return NextResponse.json({ error: error?.message || 'Failed to join room' }, { status: 500 });
  }
}

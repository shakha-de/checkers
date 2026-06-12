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
    let existingToken = body.token;

    // Clean up empty, invalid, or stringified null/undefined tokens
    if (
      !existingToken ||
      existingToken === 'null' ||
      existingToken === 'undefined' ||
      existingToken === 'spectator' ||
      typeof existingToken !== 'string' ||
      existingToken.trim() === ''
    ) {
      existingToken = null;
    }

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
    const tokenToAssign = existingToken || 'usr_' + Math.random().toString(36).substring(2, 15);
    let assignedColor: 'w' | 'b' | 'spectator' = 'spectator';

    const players = { ...room.players };
    const chat = [...room.chat];
    let status = room.status;

    if (!players.w) {
      players.w = tokenToAssign;
      assignedColor = 'w';
    } else if (!players.b) {
      players.b = tokenToAssign;
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
        token: tokenToAssign,
        color: assignedColor,
      });
    }

    // Spectator mode if room is full
    return NextResponse.json({
      token: existingToken || tokenToAssign,
      color: 'spectator',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to join room';
    console.error('Error joining room', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

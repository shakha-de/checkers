import { NextResponse } from 'next/server';
import { initializeBoard } from '@/lib/checkers';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const { creatorColor } = await request.json();
    
    // Generate simple readable room ID
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // Choose actual color for creator
    let wPlayer: string | null = null;
    let bPlayer: string | null = null;
    
    const chosenColor = creatorColor === 'random' 
      ? (Math.random() < 0.5 ? 'w' : 'b') 
      : creatorColor;

    // Create session token for the creator
    const creatorToken = Math.random().toString(36).substring(2, 15);
    
    if (chosenColor === 'w') {
      wPlayer = creatorToken;
    } else {
      bPlayer = creatorToken;
    }

    const { error } = await supabase
      .from('rooms')
      .insert({
        id: roomId,
        game_state: {
          board: initializeBoard(),
          turn: 'w',
          activePiece: null,
          capturedPositions: [],
          history: [],
          winner: null,
          drawProposedBy: null,
        },
        players: {
          w: wPlayer,
          b: bPlayer,
        },
        chat: [
          {
            id: 'sys-start',
            sender: 'system',
            text: 'Игра создана. Ожидание соперника...',
            timestamp: Date.now(),
          }
        ],
        status: 'waiting',
      });

    if (error) {
      console.error('Supabase insertion error:', error);
      throw new Error(error.message);
    }

    return NextResponse.json({
      roomId,
      creatorColor: chosenColor,
      creatorToken,
    });
  } catch (error: any) {
    console.error('Error creating room', error);
    return NextResponse.json({ error: error?.message || 'Failed to create room' }, { status: 500 });
  }
}

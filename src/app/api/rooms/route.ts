import { NextResponse } from 'next/server';
import { roomsStore, Room } from '@/lib/roomsStore';
import { initializeBoard } from '@/lib/checkers';

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

    const newRoom: Room = {
      id: roomId,
      gameState: {
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
      subscribers: new Set(),
    };

    roomsStore.set(roomId, newRoom);

    return NextResponse.json({
      roomId,
      creatorColor: chosenColor,
      creatorToken,
    });
  } catch (error) {
    console.error('Error creating room', error);
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 });
  }
}

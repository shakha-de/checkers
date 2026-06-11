import { NextResponse } from 'next/server';
import { initializeBoard } from '@/lib/checkers';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const { creatorColor, isPrivate, opponentType, aiDifficulty, gameMode } = await request.json();
    
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
      if (opponentType === 'ai') {
        bPlayer = `ai_${aiDifficulty || 'medium'}`;
      }
    } else {
      bPlayer = creatorToken;
      if (opponentType === 'ai') {
        wPlayer = `ai_${aiDifficulty || 'medium'}`;
      }
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
          score: { w: 0, b: 0, draws: 0 },
          isPrivate: !!isPrivate,
          mode: gameMode === 'giveaway' ? 'giveaway' : 'standard',
        },
        players: {
          w: wPlayer,
          b: bPlayer,
        },
        chat: [
          {
            id: 'sys-start',
            sender: 'system',
            text: opponentType === 'ai'
              ? `Игра против ИИ (${aiDifficulty === 'easy' ? 'Легкий' : aiDifficulty === 'hard' ? 'Сложный' : 'Средний'}) началась${gameMode === 'giveaway' ? ' — режим Поддавки' : ''}. Ход белых.`
              : `Игра создана${gameMode === 'giveaway' ? ' (режим Поддавки)' : ''}. Ожидание соперника...`,
            timestamp: Date.now(),
          }
        ],
        status: opponentType === 'ai' ? 'active' : 'waiting',
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
  } catch (error) {
    console.error('Error creating room', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to create room';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

import { GameState, initializeBoard, Player } from './checkers';

export interface ChatMessage {
  id: string;
  sender: Player | 'system' | 'spectator';
  text: string;
  timestamp: number;
}

export interface Room {
  id: string;
  gameState: GameState;
  players: {
    w: string | null; // session or player token representing White
    b: string | null; // session or player token representing Black
  };
  chat: ChatMessage[];
  status: 'waiting' | 'active' | 'finished';
  subscribers: Set<(data: string) => void>;
}

// Persist the map across hot-reloading in dev mode
declare global {
  var gameRoomsStore: Map<string, Room> | undefined;
}

if (!globalThis.gameRoomsStore) {
  globalThis.gameRoomsStore = new Map();
}

export const roomsStore = globalThis.gameRoomsStore!;

// Helper to broadcast events to all subscribers of a room
export function broadcastToRoom(room: Room, eventType: string, payload: any) {
  const message = JSON.stringify({ type: eventType, payload });
  room.subscribers.forEach(send => {
    try {
      send(message);
    } catch (err) {
      console.error('Error sending message to subscriber', err);
    }
  });
}

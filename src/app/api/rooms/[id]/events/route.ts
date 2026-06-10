import { roomsStore } from '@/lib/roomsStore';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const room = roomsStore.get(id);

    if (!room) {
      return new Response('Room not found', { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    let clientRole: 'w' | 'b' | 'spectator' = 'spectator';
    if (token === room.players.w) {
      clientRole = 'w';
    } else if (token === room.players.b) {
      clientRole = 'b';
    }

    // Set headers for SSE stream
    const headers = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    };

    const responseStream = new ReadableStream({
      start(controller) {
        const sendEvent = (data: string) => {
          controller.enqueue(`data: ${data}\n\n`);
        };

        // Add client send function to the room subscribers
        room.subscribers.add(sendEvent);

        // Immediately send initial sync state
        const syncState = {
          role: clientRole,
          gameState: room.gameState,
          players: {
            w: room.players.w ? true : false,
            b: room.players.b ? true : false,
          },
          chat: room.chat,
          status: room.status,
        };
        sendEvent(JSON.stringify({ type: 'sync', payload: syncState }));

        // Keep connection alive with heartbeat interval
        const heartbeatInterval = setInterval(() => {
          try {
            controller.enqueue(': heartbeat\n\n');
          } catch (e) {
            clearInterval(heartbeatInterval);
          }
        }, 15000);

        // Clean up on abort
        request.signal.addEventListener('abort', () => {
          clearInterval(heartbeatInterval);
          room.subscribers.delete(sendEvent);
        });
      },
    });

    return new Response(responseStream, { headers });
  } catch (error) {
    console.error('SSE Error:', error);
    return new Response('SSE connection error', { status: 500 });
  }
}

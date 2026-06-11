import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-project.supabase.co';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const adminSupabase = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

// Helper to verify admin passcode
function isAuthorized(request: Request): boolean {
  const authHeader = request.headers.get('Authorization');
  const adminPass = process.env.SUPABASE_PASS;
  return authHeader === adminPass;
}

export async function GET(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { data: rooms, error } = await supabase
      .from('rooms')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ rooms });
  } catch (error) {
    console.error('Error fetching admin rooms:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch rooms';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!adminSupabase) {
      return NextResponse.json(
        { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured' },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get('id');

    if (roomId) {
      // Delete specific room
      const { error } = await adminSupabase
        .from('rooms')
        .delete()
        .eq('id', roomId);

      if (error) {
        throw new Error(error.message);
      }

      return NextResponse.json({ success: true, message: `Room ${roomId} deleted successfully.` });
    } else {
      // Bulk delete rooms older than 24 hours
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const { error } = await adminSupabase
        .from('rooms')
        .delete()
        .lt('created_at', cutoff);

      if (error) {
        throw new Error(error.message);
      }

      return NextResponse.json({ success: true, message: 'All rooms older than 24 hours cleaned up.' });
    }
  } catch (error) {
    console.error('Error deleting rooms:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete room(s)';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

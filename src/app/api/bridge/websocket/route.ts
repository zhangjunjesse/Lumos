import { NextResponse } from 'next/server';
import { WebSocketManager } from '@/lib/bridge/websocket/websocket-manager';
import { handleFeishuMessage } from '@/lib/bridge/message-handler';

let listenerStarted = false;

export async function GET() {
  return NextResponse.json({ status: listenerStarted ? 'running' : 'stopped' });
}

export async function POST() {
  if (listenerStarted) {
    return NextResponse.json({ status: 'already_running' });
  }

  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;

  if (!appId || !appSecret) {
    return NextResponse.json(
      { error: 'Missing FEISHU_APP_ID or FEISHU_APP_SECRET' },
      { status: 400 }
    );
  }

  try {
    const manager = WebSocketManager.getInstance();
    await manager.start({ appId, appSecret, onMessage: handleFeishuMessage });
    listenerStarted = true;
    console.log('[Bridge] WebSocket listener started');
    return NextResponse.json({ status: 'started' });
  } catch (error) {
    console.error('[Bridge] Failed to start listener:', error);
    return NextResponse.json(
      { error: 'Failed to start listener' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  if (!listenerStarted) {
    return NextResponse.json({ status: 'not_running' });
  }

  try {
    const manager = WebSocketManager.getInstance();
    manager.stop();
    listenerStarted = false;
    console.log('[Bridge] WebSocket listener stopped');
    return NextResponse.json({ status: 'stopped' });
  } catch (error) {
    console.error('[Bridge] Failed to stop listener:', error);
    return NextResponse.json(
      { error: 'Failed to stop listener' },
      { status: 500 }
    );
  }
}

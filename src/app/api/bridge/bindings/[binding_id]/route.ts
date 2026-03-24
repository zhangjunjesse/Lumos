import { NextRequest, NextResponse } from 'next/server';
import { getBridgeService } from '@/lib/bridge/app/bridge-service';
import type { BridgeBindingRecord } from '@/lib/bridge/core/binding-service';

function toBindingPayload(binding: BridgeBindingRecord | null) {
  if (!binding) return null;
  return {
    id: binding.id,
    session_id: binding.sessionId,
    sessionId: binding.sessionId,
    platform: binding.platform,
    platform_chat_id: binding.channelId,
    chatId: binding.channelId,
    platform_chat_name: binding.channelName,
    share_link: binding.shareLink,
    status: binding.status,
    created_at: binding.createdAt,
    createdAt: binding.createdAt,
    updated_at: binding.updatedAt,
  };
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ binding_id: string }> }
) {
  const { binding_id } = await params;
  try {
    const bridgeService = getBridgeService();
    const binding = bridgeService.getBinding(parseInt(binding_id, 10));
    if (!binding) {
      return NextResponse.json({ error: 'Binding not found' }, { status: 404 });
    }
    return NextResponse.json(toBindingPayload(binding));
  } catch (error: unknown) {
    return NextResponse.json({ error: toErrorMessage(error, 'Failed to load binding') }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ binding_id: string }> }
) {
  const { binding_id } = await params;
  try {
    const { status } = await req.json();

    if (!['active', 'inactive', 'expired'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status', code: 'INVALID_PARAMETER' },
        { status: 400 }
      );
    }

    const bridgeService = getBridgeService();
    const binding = bridgeService.updateBindingStatus(
      parseInt(binding_id, 10),
      status as 'active' | 'inactive' | 'expired',
    );

    return NextResponse.json({
      success: true,
      binding: toBindingPayload(binding),
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to update binding', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ binding_id: string }> }
) {
  const { binding_id } = await params;
  try {
    const bridgeService = getBridgeService();
    bridgeService.deleteBinding(parseInt(binding_id, 10));
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: toErrorMessage(error, 'Failed to delete binding') }, { status: 500 });
  }
}

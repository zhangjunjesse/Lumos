import { NextRequest, NextResponse } from 'next/server';
import { listProviderPresets } from '@/lib/provider-presets';
import type { ProviderCapability, ProviderPresetModule } from '@/types';

function normalizeCapability(raw: string | null): ProviderCapability | null {
  switch ((raw || '').trim()) {
    case 'agent-chat':
      return 'agent-chat';
    case 'text-gen':
      return 'text-gen';
    case 'image-gen':
      return 'image-gen';
    case 'embedding':
      return 'embedding';
    default:
      return null;
  }
}

function normalizeModule(raw: string | null): ProviderPresetModule | null {
  switch ((raw || '').trim()) {
    case 'chat':
      return 'chat';
    case 'knowledge':
      return 'knowledge';
    case 'workflow':
      return 'workflow';
    case 'image':
      return 'image';
    default:
      return null;
  }
}

export async function GET(request: NextRequest) {
  const capability = normalizeCapability(request.nextUrl.searchParams.get('capability'));
  const moduleKey = normalizeModule(request.nextUrl.searchParams.get('module'));
  return NextResponse.json({
    presets: listProviderPresets({ capability, moduleKey }),
  });
}

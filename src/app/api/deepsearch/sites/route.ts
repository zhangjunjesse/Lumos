import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { listDeepSearchSitesView, saveDeepSearchSite } from '@/lib/deepsearch/service';

const upsertDeepSearchSiteSchema = z.object({
  siteKey: z.string().trim().min(1),
  displayName: z.string().trim().optional(),
  baseUrl: z.string().trim().optional(),
  cookieValue: z.string().optional().nullable(),
  cookieStatus: z.enum(['missing', 'valid', 'expired', 'unknown']).optional(),
  cookieExpiresAt: z.string().optional().nullable(),
  lastValidatedAt: z.string().optional().nullable(),
  validationMessage: z.string().optional(),
  notes: z.string().optional(),
  minFetchCount: z.number().int().min(1).max(20).optional(),
}).strict();

export async function GET() {
  try {
    const sites = await listDeepSearchSitesView();
    return NextResponse.json({
      sites,
      total: sites.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list DeepSearch sites' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = upsertDeepSearchSiteSchema.parse(body);
    const site = await saveDeepSearchSite(input);
    return NextResponse.json({ site });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save DeepSearch site' },
      { status: 400 }
    );
  }
}

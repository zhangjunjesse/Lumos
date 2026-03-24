import { NextResponse } from 'next/server';
import { listDrafts, listPackages } from '@/lib/db/capabilities';
import { initializeCapabilities } from '@/lib/capability/init';

export async function GET() {
  try {
    await initializeCapabilities();
    const packages = listPackages();
    const publishedIds = new Set(packages.map((item) => item.id));
    const drafts = listDrafts().filter((item) => !publishedIds.has(item.id));

    const items = [
      ...packages.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        version: item.version,
        status: item.status,
        kind: item.kind,
        category: item.category,
        riskLevel: item.riskLevel,
        updatedAt: item.updatedAt,
      })),
      ...drafts.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        version: '待发布',
        status: 'draft' as const,
        kind: item.kind,
        category: item.category,
        riskLevel: item.riskLevel,
        updatedAt: item.updatedAt,
      })),
    ].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

    return NextResponse.json(items);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list capabilities' },
      { status: 500 }
    );
  }
}

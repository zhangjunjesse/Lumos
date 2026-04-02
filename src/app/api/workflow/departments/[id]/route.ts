import { NextRequest, NextResponse } from 'next/server';
import { updateDepartment, deleteDepartment, getDepartment } from '@/lib/db/team-departments';

interface RouteContext { params: Promise<{ id: string }> }

export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await request.json() as { name?: string; description?: string; sortOrder?: number };
  const dept = updateDepartment(id, {
    name: body.name?.trim(),
    description: body.description?.trim(),
    sortOrder: body.sortOrder,
  });
  if (!dept) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ department: dept });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!getDepartment(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  deleteDepartment(id);
  return NextResponse.json({ success: true });
}

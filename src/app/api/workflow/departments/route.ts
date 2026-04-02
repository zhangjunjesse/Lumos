import { NextRequest, NextResponse } from 'next/server';
import { listDepartments, createDepartment } from '@/lib/db/team-departments';

export async function GET() {
  const departments = listDepartments();
  return NextResponse.json({ departments });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as { name?: string; description?: string };
  if (!body.name?.trim()) {
    return NextResponse.json({ error: '部门名称不能为空' }, { status: 400 });
  }
  const dept = createDepartment({ name: body.name.trim(), description: body.description?.trim() });
  return NextResponse.json({ department: dept }, { status: 201 });
}

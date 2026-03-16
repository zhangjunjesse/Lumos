import { NextResponse } from 'next/server';
import { listTasks } from '@/lib/task-management';

export async function GET() {
  try {
    const result = listTasks({ limit: 50 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list tasks' },
      { status: 500 }
    );
  }
}

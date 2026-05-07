import { NextResponse } from 'next/server';

import {
  APP_BUILDER_TEMPLATES,
  BLANK_APP_BUILDER_TEMPLATE_ID,
} from '@/lib/app/builder/templates';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    templates: [
      {
        id: BLANK_APP_BUILDER_TEMPLATE_ID,
        name: '空白应用',
        description: '从一句需求开始，由右侧 AI 对话生成第一版应用。',
        category: '自由创建',
        prompt: '',
        highlights: ['AI 对话', '自由生成'],
      },
      ...APP_BUILDER_TEMPLATES,
    ],
  });
}

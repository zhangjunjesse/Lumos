import { NextRequest, NextResponse } from 'next/server';
import {
  getProvider,
  updateProvider,
  deleteProvider,
  ProviderValidationError,
  ProviderDeletionBlockedError,
  ProviderUpdateBlockedError,
} from '@/lib/db';
import type { ProviderResponse, ErrorResponse, UpdateProviderRequest, ApiProvider } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function maskApiKey(provider: ApiProvider): ApiProvider {
  let maskedKey = provider.api_key;
  if (maskedKey && maskedKey.length > 8) {
    maskedKey = '***' + maskedKey.slice(-8);
  }
  return { ...provider, api_key: maskedKey };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const provider = getProvider(id);
    if (!provider) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Provider not found' },
        { status: 404 }
      );
    }

    return NextResponse.json<ProviderResponse>({ provider: maskApiKey(provider) });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to get provider' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const body: UpdateProviderRequest = await request.json();

    const existing = getProvider(id);
    if (!existing) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Provider not found' },
        { status: 404 }
      );
    }

    if (existing.provider_origin === 'system') {
      // system 服务商的连接配置由管理员下发,本地修改会被同步覆盖。
      // 但 default_model 是用户偏好(默认用哪个模型),user 可以自由设定,
      // 不会被 provisioner 覆盖——provisioner 不写这一列。
      const fieldsTouched = Object.keys(body).filter((k) => body[k as keyof UpdateProviderRequest] !== undefined);
      const onlyDefaultModel = fieldsTouched.length === 1 && fieldsTouched[0] === 'default_model';
      if (!onlyDefaultModel) {
        return NextResponse.json<ErrorResponse>(
          { error: '系统下发的服务商连接信息不可修改，如需调整请联系管理员在后台更新' },
          { status: 409 }
        );
      }
    }

    // If api_key starts with ***, the client sent back a masked value — don't update it
    if (body.api_key && body.api_key.startsWith('***')) {
      delete body.api_key;
    }

    const updated = updateProvider(id, body);
    if (!updated) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Failed to update provider' },
        { status: 500 }
      );
    }

    return NextResponse.json<ProviderResponse>({ provider: maskApiKey(updated) });
  } catch (error) {
    if (error instanceof ProviderValidationError) {
      return NextResponse.json<ErrorResponse>(
        { error: error.message },
        { status: 400 }
      );
    }
    if (error instanceof ProviderUpdateBlockedError) {
      return NextResponse.json<ErrorResponse>(
        { error: error.message },
        { status: 409 }
      );
    }
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to update provider' },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const existing = getProvider(id);
    if (existing?.provider_origin === 'system') {
      return NextResponse.json<ErrorResponse>(
        { error: '系统下发的服务商不可删除，如需下架请联系管理员在后台操作' },
        { status: 409 }
      );
    }

    const deleted = deleteProvider(id);
    if (!deleted) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Provider not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ProviderDeletionBlockedError) {
      return NextResponse.json<ErrorResponse>(
        { error: error.message },
        { status: 409 }
      );
    }
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to delete provider' },
      { status: 500 }
    );
  }
}

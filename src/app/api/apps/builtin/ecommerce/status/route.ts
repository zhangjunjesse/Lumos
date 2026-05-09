import { NextResponse } from 'next/server';

import { getAppPlatformService } from '@/lib/app/service';
import { resolveProviderForCapability, ProviderResolutionError } from '@/lib/provider-resolver';
import { providerSupportsCapability } from '@/lib/provider-config';
import {
  ECOMMERCE_ASSISTANT_APP_ID,
  ECOMMERCE_ASSISTANT_VERSION,
} from '@/lib/ecommerce-assistant/constants';
import { getEcommerceStore } from '@/lib/ecommerce-assistant/storage';
import type { ImageJobRecord } from '@/lib/ecommerce-assistant/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let installedVersion: string | null = null;
  let installError: string | null = null;
  try {
    const svc = getAppPlatformService();
    const row = svc.db
      .prepare('SELECT version FROM lumos_app_apps WHERE id = ?')
      .get(ECOMMERCE_ASSISTANT_APP_ID) as { version: string } | undefined;
    installedVersion = row?.version ?? null;
  } catch (err) {
    installError = err instanceof Error ? err.message : String(err);
  }

  const imageProvider = checkImageProvider();
  const analysisProvider = checkAnalysisProvider();

  let inputCount = 0;
  let runningJobs = 0;
  let lastJob: ImageJobRecord | null = null;
  let storeError: string | null = null;
  try {
    const store = getEcommerceStore();
    inputCount = store.count('product_inputs', { status: 'ready' });
    // SOP has many non-terminal statuses; count all that aren't finished.
    const allJobs = store.query<ImageJobRecord>('image_jobs', { limit: 500 });
    runningJobs = allJobs.filter(
      (job) => !['completed', 'failed', 'cancelled'].includes(job.status),
    ).length;
    lastJob = [...allJobs].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0] ?? null;
  } catch (err) {
    storeError = err instanceof Error ? err.message : String(err);
  }

  const ready =
    installedVersion !== null &&
    imageProvider.ok &&
    analysisProvider.ok &&
    !storeError;
  const phase = !installedVersion
    ? 'needs-install'
    : !analysisProvider.ok
      ? 'needs-analysis-provider'
      : !imageProvider.ok
        ? 'needs-image-provider'
        : storeError
          ? 'failed'
          : 'ready';

  return NextResponse.json({
    app: {
      id: ECOMMERCE_ASSISTANT_APP_ID,
      name: '电商商品助手',
      version: installedVersion ?? ECOMMERCE_ASSISTANT_VERSION,
      source: 'builtin',
      category: 'productivity',
      status: phase,
    },
    install: {
      installed: installedVersion !== null,
      version: installedVersion,
      error: installError,
    },
    providers: {
      analysis: analysisProvider,
      image: imageProvider,
    },
    inventory: {
      ready: !storeError,
      inputCount,
      runningJobs,
      storeError,
    },
    lastJob: lastJob
      ? {
          id: lastJob.id,
          status: lastJob.status,
          stage: lastJob.stage,
          progress: lastJob.progress,
          updatedAt: lastJob.updated_at,
          failureReason: lastJob.failure_reason,
        }
      : null,
    ready,
    phase,
  });
}

function checkImageProvider(): { ok: boolean; name?: string; reason?: string } {
  try {
    const provider = resolveProviderForCapability({
      moduleKey: 'image',
      capability: 'image-gen',
    });
    if (!provider) return { ok: false, reason: '未解析到默认图像服务商。' };
    return { ok: true, name: provider.name };
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof ProviderResolutionError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err),
    };
  }
}

function checkAnalysisProvider(): { ok: boolean; name?: string; reason?: string } {
  try {
    const provider = resolveProviderForCapability({
      moduleKey: 'agent',
      capability: 'agent-chat',
    });
    if (!provider) return { ok: false, reason: '未解析到默认分析 provider。' };
    if (!providerSupportsCapability(provider, 'text-gen')) {
      return {
        ok: false,
        name: provider.name,
        reason: `Provider「${provider.name}」不支持文本生成（structured output）。`,
      };
    }
    return { ok: true, name: provider.name };
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof ProviderResolutionError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err),
    };
  }
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

interface CapabilityDetail {
  id: string;
  name: string;
  description: string;
  version?: string;
  status?: string;
  kind?: 'code' | 'prompt';
  category: string;
  riskLevel: 'low' | 'medium' | 'high';
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  runtimePolicy?: Record<string, unknown>;
  docs?: {
    summary?: string;
    usageExamples?: string[];
  };
}

export default function CapabilityDetailPage() {
  const router = useRouter();
  const params = useParams();
  const [capability, setCapability] = useState<CapabilityDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/capabilities/${params.id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to load capability');
        }
        setCapability(data);
      })
      .catch(err => console.error('Failed to load capability:', err))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return <div className="flex items-center justify-center h-full">加载中...</div>;
  }

  if (!capability) {
    return <div className="flex items-center justify-center h-full">能力不存在</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold">{capability.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">{capability.description}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h3 className="text-lg font-medium mb-2">基本信息</h3>
            <div className="bg-muted rounded-lg p-4 space-y-2">
              <div><span className="font-medium">类型:</span> {capability.kind === 'prompt' ? 'Prompt 节点' : '代码节点'}</div>
              <div><span className="font-medium">状态:</span> {capability.status === 'published' ? '已发布' : '待发布'}</div>
              <div><span className="font-medium">版本:</span> {capability.version || '待发布'}</div>
              <div><span className="font-medium">分类:</span> {capability.category}</div>
              <div><span className="font-medium">风险等级:</span> {capability.riskLevel}</div>
            </div>
          </div>

          {capability.docs?.summary ? (
            <div>
              <h3 className="text-lg font-medium mb-2">能力摘要</h3>
              <div className="bg-muted rounded-lg p-4 text-sm">
                {capability.docs.summary}
              </div>
            </div>
          ) : null}

          <div>
            <h3 className="text-lg font-medium mb-2">当前使用方式</h3>
            <div className="bg-muted rounded-lg p-4 text-sm space-y-2">
              {capability.kind === 'prompt' ? (
                <>
                  <p>这个 Prompt 节点发布后已经可以被工作流中的 agent 步骤使用。</p>
                  <p>最稳的触发方式是在任务描述里明确写出能力 ID 或能力名称，例如：使用能力 {capability.id} 处理这项任务。</p>
                  <p>调度层命中后，会把这个能力挂到工作流 agent 步骤里。</p>
                </>
              ) : (
                <>
                  <p>这个代码节点发布后已经可以被工作流正式调用。</p>
                  <p>当前最稳的触发方式是在任务描述里明确写出能力 ID 或能力名称，并提供结构化 JSON 参数。</p>
                  <p>例如：使用能力 {capability.id}，参数：{"{"}"sourcePath":"./demo.docx","targetFormat":"markdown"{"}"}</p>
                  <p>调度层命中后，会创建一个真实的能力步骤来直接执行这个已发布代码节点。</p>
                </>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-medium mb-2">输入参数</h3>
            <pre className="bg-muted rounded-lg p-4 overflow-auto text-sm">
              {JSON.stringify(capability.inputSchema, null, 2)}
            </pre>
          </div>

          <div>
            <h3 className="text-lg font-medium mb-2">输出结果</h3>
            <pre className="bg-muted rounded-lg p-4 overflow-auto text-sm">
              {JSON.stringify(capability.outputSchema, null, 2)}
            </pre>
          </div>

          {capability.permissions ? (
            <div>
              <h3 className="text-lg font-medium mb-2">权限范围</h3>
              <pre className="bg-muted rounded-lg p-4 overflow-auto text-sm">
                {JSON.stringify(capability.permissions, null, 2)}
              </pre>
            </div>
          ) : null}

          {capability.runtimePolicy ? (
            <div>
              <h3 className="text-lg font-medium mb-2">运行策略</h3>
              <pre className="bg-muted rounded-lg p-4 overflow-auto text-sm">
                {JSON.stringify(capability.runtimePolicy, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

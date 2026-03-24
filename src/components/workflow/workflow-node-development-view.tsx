import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const FORMAL_NODE_TYPES = [
  {
    type: 'agent',
    status: '已上线',
    description: '负责分析、汇总、生成文本结果，以及在受控边界内调用系统能力。',
  },
  {
    type: 'browser',
    status: '已上线',
    description: '当前正式动作仍以打开页面、点击、填充、截图为主。',
  },
  {
    type: 'notification',
    status: '已上线',
    description: '负责把最终结果写回系统通知和主 Agent 对话。',
  },
] as const;

const CAPABILITY_PACKS = [
  '网页登录、会话保持、二次跳转',
  '文件上传、文件下载、等待下载完成',
  'Excel 读取、写入、跨表复制、公式结果提取',
  'Word / PDF / Excel 等导出与产物管理',
  '定时执行、失败重试、执行记录回放',
] as const;

const CURRENT_GAPS = [
  '当前还没有“可发布的节点能力包”正式运行链路。',
  '当前还没有“用户通过界面让 LLM 生成新能力定义，再发布给工作流使用”的管理页。',
  '当前还没有把登录、下载、上传、Excel 操作这些能力标准化成正式可调度节点。',
  '当前页面先解决“07 有正式产品入口”，不代表 07 已按完整实现标准验收通过。',
] as const;

export function WorkflowNodeDevelopmentView() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">07 工作流节点开发</h1>
            <Badge className="border border-violet-500/20 bg-violet-500/10 text-violet-700">
              正式入口
            </Badge>
            <Badge variant="outline">先收进产品</Badge>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            这里先把 07 收进正式产品导航。当前目标不是给每个用户做私有节点，而是把通用执行能力沉淀成可管理、可发布、可复用的标准能力包，再让工作流正式调用。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/workflow">返回 Workflow Center</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/workflow/agents">查看 Workflow 角色</Link>
          </Button>
        </div>
      </div>

      <Card className="border-border/60 bg-muted/10">
        <CardHeader>
          <CardTitle>当前边界</CardTitle>
          <CardDescription>
            07 现在先做正式入口，不改动 01 ~ 06 的主链边界。当前正式工作流节点类型仍然只有 agent / browser / notification。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {FORMAL_NODE_TYPES.map((node) => (
            <div key={node.type} className="rounded-2xl border border-border/60 bg-background/80 px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-foreground">{node.type}</p>
                <Badge variant="outline">{node.status}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{node.description}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>07 要补的系统能力</CardTitle>
            <CardDescription>
              推荐方向不是无限增加新节点类型，而是先补一个更强的通用执行节点，并把高频能力做成标准能力包，让工作流可组合调用。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-4">
              <p className="text-sm font-medium text-foreground">推荐主线</p>
              <div className="mt-2 space-y-2 text-sm text-muted-foreground">
                <p>1. 先补“通用执行节点”，负责调用已发布能力，不要求每次都新增一种 DSL 节点类型。</p>
                <p>2. 再建设“标准能力包”，把登录、上传、下载、Excel、导出这些场景沉淀成可复用能力。</p>
                <p>3. 用户后续可在管理界面里通过 LLM 生成能力草稿，经过校验、测试、发布后再给工作流使用。</p>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-4">
              <p className="text-sm font-medium text-foreground">优先能力包</p>
              <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                {CAPABILITY_PACKS.map((item) => (
                  <li key={item}>- {item}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>当前仍未完成</CardTitle>
            <CardDescription>
              下面这些缺口还在，所以 07 现在只能算“正式入口已建”，还不能算“完整实现”。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {CURRENT_GAPS.map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

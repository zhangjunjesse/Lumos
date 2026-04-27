'use client';

import { useState } from 'react';
import { AlertCircle, ChevronDown, Copy, ExternalLink, Loader2, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useWeChatExport } from './use-wechat-export';

const WECHAT_APP_STORE_URL = 'macappstore://apps.apple.com/cn/app/wechat/id836500024';

function StepRow({
  ok,
  detail,
  hint,
  label,
}: {
  ok: boolean;
  detail: string;
  hint?: string;
  label: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-xs">
      <div className="flex items-start gap-2 min-w-0">
        <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          ok ? 'bg-green-500/15 text-green-700 dark:text-green-400' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
        }`}>{ok ? '✓' : '!'}</span>
        <div className="min-w-0">
          <div className="font-medium text-foreground/90">{label}</div>
          <div className="text-muted-foreground truncate" title={detail}>{detail}</div>
          {!ok && hint ? (
            <div className="mt-1 inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="font-mono bg-muted/60 px-1.5 py-0.5 rounded">{hint}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* user-blocked clipboard, no fallback */ }
  };
  return (
    <div className="flex items-stretch gap-1.5 rounded-md border border-border/60 bg-muted/30 p-1 font-mono text-xs">
      <code className="flex-1 px-2 py-1.5 break-all leading-relaxed">{command}</code>
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-1 rounded px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Copy className="h-3 w-3" />
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  );
}

function DisclaimerCard({ panel }: { panel: ReturnType<typeof useWeChatExport> }) {
  const consent = panel.status?.consent;
  const [riskAck, setRiskAck] = useState(false);
  const [scopeAck, setScopeAck] = useState(false);
  const [showFull, setShowFull] = useState(false);
  if (!consent) return null;
  const ready = riskAck && scopeAck;
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck className="h-4 w-4 text-amber-500" />
        <h3 className="font-semibold text-sm">启用前请确认 (免责声明 {consent.version})</h3>
      </div>
      <ul className="space-y-1.5 text-xs text-muted-foreground leading-relaxed">
        {consent.summary.map((line, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-foreground/70 font-semibold shrink-0">{i + 1}.</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setShowFull((v) => !v)}
        className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        <ChevronDown className={`h-3 w-3 transition-transform ${showFull ? 'rotate-180' : ''}`} />
        {showFull ? '收起完整声明' : '展开完整声明'}
      </button>

      {showFull && (
        <pre className="mt-3 max-h-80 overflow-auto rounded-md border border-border/40 bg-muted/30 p-3 text-[11px] leading-relaxed whitespace-pre-wrap font-sans text-muted-foreground">
          {consent.body}
        </pre>
      )}

      <div className="mt-4 space-y-2">
        <label className="flex items-start gap-2 text-xs">
          <Checkbox checked={riskAck} onCheckedChange={(v) => setRiskAck(v === true)} />
          <span>我已阅读上述声明并接受全部风险</span>
        </label>
        <label className="flex items-start gap-2 text-xs">
          <Checkbox checked={scopeAck} onCheckedChange={(v) => setScopeAck(v === true)} />
          <span>我承诺仅用于读取自己授权的微信账号</span>
        </label>
      </div>

      <div className="mt-4 flex justify-end">
        <Button
          size="sm"
          disabled={!ready || panel.busy === 'consent'}
          onClick={() => void panel.acceptConsent()}
        >
          {panel.busy === 'consent' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          接受并继续
        </Button>
      </div>
    </div>
  );
}

function EnvCard({ panel }: { panel: ReturnType<typeof useWeChatExport> }) {
  const env = panel.status?.env;
  if (!env) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-sm">环境检查</h3>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => void panel.refresh()}>
          <RefreshCw className="h-3 w-3 mr-1" />
          重新检测
        </Button>
      </div>
      <div className="divide-y divide-border/30">
        <StepRow label="微信版本" {...env.wechat} />
        <StepRow label="Xcode 命令行工具" {...env.xcodeCLT} />
        <StepRow label="sqlcipher" {...env.sqlcipher} />
        <StepRow label="微信数据目录" {...env.dataDir} />
      </div>
    </div>
  );
}

function ResignCard({ panel, action }: {
  panel: ReturnType<typeof useWeChatExport>;
  action: 'sign' | 'restore';
}) {
  const env = panel.status?.env;
  if (!env) return null;
  if (action === 'sign') {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
        <h3 className="font-semibold text-sm mb-2">重签名微信</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
          这一步会临时去掉微信的 Hardened Runtime 保护,这样调试器才能读取它的内存提取数据库密钥。
          我们做不了 sudo,需要你打开终端执行:
        </p>
        <CopyableCommand command="sudo codesign --force --deep --sign - /Applications/WeChat.app" />
        <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
          完成后:<br />
          1. 完全退出微信 (<kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">⌘Q</kbd>)<br />
          2. 重新打开微信(自动续登,不用扫码)<br />
          3. 此卡片会自动检测到签名变更并显示 ✓
        </p>
        <div className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          检测中…(每 4 秒一次)
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
      <h3 className="font-semibold text-sm mb-2">恢复微信原签名</h3>
      <p className="text-xs text-muted-foreground leading-relaxed mb-3">
        密钥已经提取完成。但目前微信处于临时签名状态,**会导致截屏 / 录屏 / 辅助功能等系统权限失效**。
      </p>
      <p className="text-xs text-muted-foreground leading-relaxed mb-3">
        请从 App Store 重新下载安装微信,会覆盖签名,密钥仍然有效:
      </p>
      <Button variant="outline" size="sm" asChild>
        <a href={WECHAT_APP_STORE_URL} target="_blank" rel="noreferrer" className="gap-1">
          <ExternalLink className="h-3 w-3" /> 打开 App Store 微信页面
        </a>
      </Button>
      <p className="mt-3 text-xs text-muted-foreground">
        或访问 <a href="https://mac.weixin.qq.com/" target="_blank" rel="noreferrer" className="text-primary hover:underline">mac.weixin.qq.com</a> 下载安装包覆盖。
      </p>
      <div className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        检测中… 看到 Tencent 签名后此卡片会自动变绿
      </div>
    </div>
  );
}

function ExtractCard({ panel }: { panel: ReturnType<typeof useWeChatExport> }) {
  const running = panel.busy === 'extract';
  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
      <h3 className="font-semibold text-sm mb-2">提取数据库密钥</h3>
      <p className="text-xs text-muted-foreground leading-relaxed mb-3">
        即将用 lldb 附加微信进程,扫描内存找出 SQLCipher 密钥。首次大约 5–10 分钟,可放在后台。
      </p>
      {!running && (
        <Button size="sm" onClick={() => void panel.startExtract()}>
          开始提取
        </Button>
      )}
      {running && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-muted-foreground">{panel.busyMessage || '扫描中…'}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            已恢复 <span className="font-mono text-foreground">{panel.extractKeys}</span> 个密钥
          </div>
          <Button variant="ghost" size="sm" onClick={panel.cancelExtract}>
            取消
          </Button>
        </div>
      )}
    </div>
  );
}

function ReadyCard({ panel }: { panel: ReturnType<typeof useWeChatExport> }) {
  const env = panel.status?.env;
  const status = panel.status?.status;
  const mcpEnabled = panel.status?.mcp?.enabled;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border/60 bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${mcpEnabled ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/40'}`} />
            <h3 className="font-semibold text-sm">
              {mcpEnabled ? '微信导出 · 已启用' : '微信导出 · 准备就绪 (未启用)'}
            </h3>
          </div>
          {mcpEnabled ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={panel.busy === 'disable'}
              onClick={() => void panel.toggle('disable')}
            >
              暂停
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={panel.busy === 'enable'}
              onClick={() => void panel.toggle('enable')}
            >
              {panel.busy === 'enable' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              启用
            </Button>
          )}
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          <div>已恢复 <span className="font-mono text-foreground">{status?.keyCount ?? 0}</span> 个数据库密钥</div>
          {status?.lastExtractedAt ? (
            <div>最近提取: {new Date(status.lastExtractedAt).toLocaleString('zh-CN')}</div>
          ) : null}
          {env?.dataDir.wxid ? (
            <div>账号: <span className="font-mono">{env.dataDir.wxid}</span></div>
          ) : null}
          {env?.signed === 'adhoc' ? (
            <div className="text-amber-600 dark:text-amber-400">
              ⚠ 微信仍是临时签名,可能影响截屏 / 录屏。建议从 App Store 重新安装微信恢复官方签名,密钥仍可用。
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card p-4">
        <h4 className="font-semibold text-sm mb-2">可用工具</h4>
        <ul className="text-xs text-muted-foreground space-y-1 leading-relaxed">
          <li>• <code className="font-mono">wechat_list_chats</code> — 列出所有对话</li>
          <li>• <code className="font-mono">wechat_read_chat</code> — 读取某联系人对话(支持 wxid / 昵称 / 备注模糊匹配)</li>
          <li>• <code className="font-mono">wechat_recent_messages</code> — 最近 N 天所有对话概览</li>
          <li>• <code className="font-mono">wechat_search_messages</code> — 关键词跨对话搜索</li>
          <li>• <code className="font-mono">wechat_chat_summary</code> — 聊天分析(待办事项 / 承诺 / 计划)</li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          在主对话中说「读一下我和@xx 的聊天」「最近三天有什么待办」即可自动调用。
        </p>
      </div>

      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <h4 className="font-semibold text-sm mb-2">完全卸载</h4>
        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
          删除提取的密钥 + 关闭工具,不影响微信本身。如果你只是想暂停,用上方的「暂停」即可保留密钥。
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={panel.busy === 'uninstall'}
          onClick={() => {
            if (!confirm('确认完全卸载?这会删除所有已提取的密钥。')) return;
            void panel.toggle('uninstall');
          }}
        >
          <Trash2 className="h-3 w-3 mr-1" />
          完全卸载
        </Button>
      </div>
    </div>
  );
}

export function WeChatExportPanel() {
  const panel = useWeChatExport();
  const { status, statusError, actionMessage } = panel;

  if (!status) {
    if (statusError) {
      return (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>无法加载状态</AlertTitle>
          <AlertDescription>{statusError}</AlertDescription>
        </Alert>
      );
    }
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> 加载中…
      </div>
    );
  }

  if (!status.supported) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>暂不支持当前平台</AlertTitle>
        <AlertDescription>{status.message}</AlertDescription>
      </Alert>
    );
  }

  const phase = status.status?.phase;

  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold">微信导出 (macOS)</h2>
        <p className="text-sm text-muted-foreground mt-1">
          让 AI 直接读取你本地的微信聊天记录。数据完全本地处理,不上传 lumos 云端。
        </p>
      </div>

      {actionMessage ? (
        <Alert variant={actionMessage.kind === 'error' ? 'destructive' : 'default'}>
          {actionMessage.kind === 'error' ? <AlertCircle className="h-4 w-4" /> : null}
          <AlertDescription>{actionMessage.text}</AlertDescription>
        </Alert>
      ) : null}

      {phase === 'needs-consent' && <DisclaimerCard panel={panel} />}

      {phase === 'needs-env' && (
        <>
          <EnvCard panel={panel} />
          <p className="text-xs text-muted-foreground">
            修复上面所有 ! 项后,此面板会自动进入下一步。
          </p>
        </>
      )}

      {phase === 'needs-resign' && (
        <>
          <EnvCard panel={panel} />
          <ResignCard panel={panel} action="sign" />
        </>
      )}

      {phase === 'needs-extract' && (
        <>
          <EnvCard panel={panel} />
          <ExtractCard panel={panel} />
        </>
      )}

      {phase === 'needs-restore' && (
        <>
          <ReadyCard panel={panel} />
          <ResignCard panel={panel} action="restore" />
        </>
      )}

      {phase === 'ready' && <ReadyCard panel={panel} />}
    </div>
  );
}

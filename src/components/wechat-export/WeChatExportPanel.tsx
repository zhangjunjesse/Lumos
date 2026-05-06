'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpRight,
  ChevronDown,
  CircleAlert,
  Copy,
  FolderOpen,
  Loader2,
  MessageCircle,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useWeChatExport } from './use-wechat-export';
import { WeChatBrowser } from './WeChatBrowser';
import type { WeChatMessageDbDiagnostics } from './types';

const WECHAT_APP_STORE_URL = 'macappstore://apps.apple.com/cn/app/wechat/id836500024';

// ─────────────────────────────────────────────────────────────────────────
// Section: small primitives
// ─────────────────────────────────────────────────────────────────────────

function Card({
  tone = 'default',
  children,
  className = '',
}: {
  tone?: 'default' | 'highlight' | 'soft';
  children: React.ReactNode;
  className?: string;
}) {
  const toneClass =
    tone === 'highlight'
      ? 'border-primary/30 bg-primary/[0.03]'
      : tone === 'soft'
        ? 'border-border/40 bg-muted/20'
        : 'border-border/60 bg-card';
  return (
    <div className={`rounded-xl border ${toneClass} p-4 ${className}`}>
      {children}
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
    } catch { /* clipboard blocked */ }
  };
  return (
    <div className="flex items-stretch gap-1.5 rounded-md border border-border/60 bg-muted/30 p-1 font-mono text-xs">
      <code className="flex-1 px-2 py-1.5 break-all leading-relaxed text-foreground/90">{command}</code>
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-1 rounded px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <Copy className="h-3 w-3" />
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Section: hero (always at top of panel)
// ─────────────────────────────────────────────────────────────────────────

function Hero({ enabled }: { enabled: boolean }) {
  return (
    <div className="flex items-start gap-3 pb-1">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <MessageCircle className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">微信</h2>
          {enabled ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              已就绪
            </span>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">
          让 AI 读懂你的微信聊天 — 跨对话搜索、提取待办、生成摘要,全程在你电脑本地处理。
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 1: introduce + accept terms
// ─────────────────────────────────────────────────────────────────────────

function ConsentSection({ panel }: { panel: ReturnType<typeof useWeChatExport> }) {
  const consent = panel.status?.consent;
  const [riskAck, setRiskAck] = useState(false);
  const [scopeAck, setScopeAck] = useState(false);
  const [showFull, setShowFull] = useState(false);
  if (!consent) return null;
  const ready = riskAck && scopeAck;
  return (
    <Card>
      <h3 className="text-sm font-semibold mb-3">启用前请知悉</h3>
      <ul className="space-y-2 text-sm text-foreground/85 leading-relaxed">
        {consent.summary.map((line, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-foreground/40" />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setShowFull((v) => !v)}
        className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown className={`h-3 w-3 transition-transform ${showFull ? 'rotate-180' : ''}`} />
        {showFull ? '收起完整声明' : '查看完整声明'}
      </button>

      {showFull && (
        <div className="mt-3 max-h-72 overflow-auto rounded-md border border-border/40 bg-muted/30 p-4 prose prose-sm dark:prose-invert max-w-none prose-headings:mt-3 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{consent.body}</ReactMarkdown>
        </div>
      )}

      <div className="mt-5 space-y-2">
        <label className="flex items-start gap-2.5 text-sm cursor-pointer select-none">
          <Checkbox
            checked={riskAck}
            onCheckedChange={(v) => setRiskAck(v === true)}
            className="mt-0.5"
          />
          <span className="text-foreground/90">我已阅读上述说明,接受相关风险</span>
        </label>
        <label className="flex items-start gap-2.5 text-sm cursor-pointer select-none">
          <Checkbox
            checked={scopeAck}
            onCheckedChange={(v) => setScopeAck(v === true)}
            className="mt-0.5"
          />
          <span className="text-foreground/90">我承诺只用于读取自己授权的微信账号</span>
        </label>
      </div>

      <div className="mt-5 flex justify-end">
        <Button
          disabled={!ready || panel.busy === 'consent'}
          onClick={() => void panel.acceptConsent()}
        >
          {panel.busy === 'consent' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          同意,开始设置
        </Button>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 2: env probes
// ─────────────────────────────────────────────────────────────────────────

function WindowsManualPathControls({ panel }: { panel: ReturnType<typeof useWeChatExport> }) {
  const config = panel.status?.windowsPathConfig;
  const wechatExePath = config?.wechatExePath || '';
  const dataRootPath = config?.wechatDataRoot || '';
  return (
    <WindowsManualPathFields
      key={`${wechatExePath}\n${dataRootPath}`}
      panel={panel}
      initialWechatExePath={wechatExePath}
      initialDataRootPath={dataRootPath}
    />
  );
}

function WindowsManualPathFields({
  panel,
  initialWechatExePath,
  initialDataRootPath,
}: {
  panel: ReturnType<typeof useWeChatExport>;
  initialWechatExePath: string;
  initialDataRootPath: string;
}) {
  const [wechatExePath, setWechatExePath] = useState(initialWechatExePath);
  const [dataRootPath, setDataRootPath] = useState(initialDataRootPath);
  const running = panel.busy === 'path';

  const chooseWechatExe = async () => {
    const api = window.electronAPI?.dialog;
    if (!api?.openFile) {
      void panel.saveWindowsPath('wechatExe', wechatExePath);
      return;
    }
    const result = await api.openFile({
      title: '选择 WeChat.exe 或 Weixin.exe',
      filters: [{ name: 'Windows 程序', extensions: ['exe'] }],
      multi: false,
    });
    const selected = result.canceled ? '' : result.filePaths[0] || '';
    if (selected) {
      setWechatExePath(selected);
      void panel.saveWindowsPath('wechatExe', selected);
    }
  };

  const chooseDataDir = async () => {
    const api = window.electronAPI?.dialog;
    if (!api?.openFolder) {
      void panel.saveWindowsPath('dataDir', dataRootPath);
      return;
    }
    const result = await api.openFolder({
      title: '选择 WeChat Files 或账号数据目录',
    });
    const selected = result.canceled ? '' : result.filePaths[0] || '';
    if (selected) {
      setDataRootPath(selected);
      void panel.saveWindowsPath('dataDir', selected);
    }
  };

  return (
    <div className="mt-4 rounded-md border border-border/50 bg-muted/20 p-3">
      <div className="flex items-start gap-2">
        <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium">自动检测失败时，手动指定路径</h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            微信装在非默认位置、聊天数据放在 D 盘或 OneDrive 时，Lumos 可能读不到注册表里的位置。
            你可以直接选择微信程序和聊天数据目录，保存后点“重新检查”继续。
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Input
            value={wechatExePath}
            onChange={(event) => setWechatExePath(event.target.value)}
            placeholder="WeChat.exe / Weixin.exe 路径，例如 C:\\Program Files\\Tencent\\WeChat\\WeChat.exe"
            className="h-8 text-xs"
          />
          <Button type="button" size="sm" variant="outline" className="h-8" disabled={running} onClick={chooseWechatExe}>
            选择程序
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={running || !wechatExePath.trim()}
            onClick={() => void panel.saveWindowsPath('wechatExe', wechatExePath)}
          >
            {running ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            保存
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Input
            value={dataRootPath}
            onChange={(event) => setDataRootPath(event.target.value)}
            placeholder="聊天数据目录，例如 D:\\WeChat Files，或某个账号目录 / MSG 目录"
            className="h-8 text-xs"
          />
          <Button type="button" size="sm" variant="outline" className="h-8" disabled={running} onClick={chooseDataDir}>
            选择目录
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={running || !dataRootPath.trim()}
            onClick={() => void panel.saveWindowsPath('dataDir', dataRootPath)}
          >
            {running ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}

function EnvSection({ panel }: { panel: ReturnType<typeof useWeChatExport> }) {
  const env = panel.status?.env;
  if (!env) return null;
  const isWindows = panel.status?.platform === 'win32';

  type Row = { label: string; ok: boolean; detail: string; hint?: string; copy?: string };
  const rows: Row[] = isWindows
    ? [
        {
          label: 'Windows 微信',
          ok: env.wechat.ok,
          detail: env.wechat.detail,
          hint: env.wechat.hint,
        },
        {
          label: '微信账号数据',
          ok: env.dataDir.ok,
          detail: env.dataDir.ok && env.dataDir.wxid ? `账号 ${env.dataDir.wxid}` : env.dataDir.detail,
          hint: env.dataDir.hint,
        },
        {
          label: '本地读取组件',
          ok: env.xcodeCLT.ok && env.sqlcipher.ok,
          detail: env.xcodeCLT.ok && env.sqlcipher.ok ? '已就绪' : '需要修复',
          hint: env.xcodeCLT.hint || env.sqlcipher.hint,
        },
      ]
    : [
        {
          label: '微信',
          ok: env.wechat.ok,
          detail: env.wechat.ok ? `已检测到版本 ${env.wechat.detail.split(' ')[0]}` : env.wechat.detail,
          hint: env.wechat.hint,
        },
        {
          label: '系统辅助工具',
          ok: env.xcodeCLT.ok,
          detail: env.xcodeCLT.ok ? '已就绪' : env.xcodeCLT.detail,
          hint: env.xcodeCLT.hint,
          copy: env.xcodeCLT.hint?.startsWith('xcode-select') ? env.xcodeCLT.hint : undefined,
        },
        {
          label: '本地数据库工具',
          ok: env.sqlcipher.ok,
          detail: env.sqlcipher.ok ? '已就绪' : '需要安装',
          hint: env.sqlcipher.hint,
          copy: env.sqlcipher.hint?.startsWith('brew') ? env.sqlcipher.hint : undefined,
        },
        {
          label: '微信账号数据',
          ok: env.dataDir.ok,
          detail: env.dataDir.ok && env.dataDir.wxid ? `账号 ${env.dataDir.wxid}` : env.dataDir.detail,
          hint: env.dataDir.hint,
        },
      ];

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">检查准备情况</h3>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void panel.refresh()}>
          <RefreshCw className="h-3 w-3 mr-1" />
          重新检查
        </Button>
      </div>

      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start gap-3 text-sm">
            <span
              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                r.ok ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-medium">{r.label}</span>
                <span className="text-muted-foreground text-xs truncate">{r.detail}</span>
              </div>
              {!r.ok && r.copy ? (
                <div className="mt-1.5">
                  <CopyableCommand command={r.copy} />
                </div>
              ) : !r.ok && r.hint ? (
                <p className="mt-1 text-xs text-muted-foreground">{r.hint}</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {!env.allOk ? (
        <p className="mt-4 text-xs text-muted-foreground">修复上面亮起黄点的项后,会自动进入下一步。</p>
      ) : null}

      {isWindows && (!env.wechat.ok || !env.dataDir.ok) ? (
        <WindowsManualPathControls panel={panel} />
      ) : null}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 3: relax wechat
// ─────────────────────────────────────────────────────────────────────────

function PrepareWeChatSection({ panel }: { panel: ReturnType<typeof useWeChatExport> }) {
  const running = panel.busy === 'resign';
  return (
    <Card tone="highlight">
      <h3 className="text-sm font-semibold mb-2">让 lumos 能读到微信</h3>
      <p className="text-sm text-foreground/85 leading-relaxed">
        微信开了一层系统级保护,让其他程序读不到它。下一步会临时放开,这样 AI 才能拿到你的聊天记录。
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button disabled={running} onClick={() => void panel.resignWeChat()}>
          {running ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          退出微信并临时放开读取保护
        </Button>
      </div>
      <p className="mt-3 text-sm text-foreground/85">点击后 Lumos 会:</p>
      <ol className="mt-1 space-y-1 text-sm text-foreground/85 list-decimal pl-5">
        <li>让微信完全退出</li>
        <li>弹出 macOS 管理员授权窗口,临时放开读取保护</li>
        <li>重新打开微信,你等它进入主界面后继续下一步</li>
      </ol>
      <div className="mt-4 inline-flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        完成后这里会自动进入下一步
      </div>

      <Disclosure title="如果按钮失败怎么办?">
        可以在终端里手动运行下面这条命令,然后重新打开微信:
        <div className="mt-2">
          <CopyableCommand command="sudo codesign --force --deep --sign - /Applications/WeChat.app" />
        </div>
      </Disclosure>

      <Disclosure title="为什么要这样做?">
        微信启用了 macOS 的「Hardened Runtime」保护,默认禁止外部程序读取它的内存。
        我们用一条临时签名替换微信,关掉这个保护;之后 lumos 才能从微信进程里取出加密数据库的解锁密钥。
        密钥取出后,我们会引导你恢复微信原始签名,系统权限完全恢复。
      </Disclosure>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 4: extract keys
// ─────────────────────────────────────────────────────────────────────────

function ExtractSection({ panel }: { panel: ReturnType<typeof useWeChatExport> }) {
  const running = panel.busy === 'extract';
  const isWindows = panel.status?.platform === 'win32';
  const windowsWechatRunning = panel.status?.env?.wechat.running !== false;
  const canStart = !isWindows || windowsWechatRunning;
  return (
    <Card tone="highlight">
      <h3 className="text-sm font-semibold mb-2">取出聊天记录的解锁密钥</h3>
      <p className="text-sm text-foreground/85 leading-relaxed">
        {isWindows
          ? 'Lumos 会读取当前运行中的 Windows 微信进程，找到本机账号数据库的解锁密钥，并保存到你的本地。微信需要保持登录在主界面。'
          : '最后一步:Lumos 会在本机扫描微信进程,把每个数据库的解锁密钥取出来,保存到你的本地。首次大约 5-10 分钟,页面会显示进度。'}
      </p>

      {isWindows && !windowsWechatRunning ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-foreground/85">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <div>
            已找到 Windows 微信安装和本地数据，但提取密钥时必须让微信正在运行。请先打开微信并停留在主界面，然后点击“重新检查”。
          </div>
        </div>
      ) : null}

      {!running ? (
        <div className="mt-4">
          <Button disabled={!canStart} onClick={() => void panel.startExtract()}>
            <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" />
            开始
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span className="text-muted-foreground">{panel.busyMessage || '正在扫描…'}</span>
          </div>
          <div className="text-sm text-muted-foreground">
            已取出 <span className="font-mono text-foreground tabular-nums">{panel.extractKeys}</span> 个密钥
          </div>
          <Button variant="ghost" size="sm" onClick={panel.cancelExtract}>
            取消
          </Button>
        </div>
      )}

      <Disclosure title="这一步在做什么?">
        {isWindows ? (
          <>
            微信把聊天记录用密码加密存在你的 Windows 电脑上。这个密码只在微信运行时存在内存里。
            Lumos 会在本机读取 WeChat.exe 进程并验证密钥是否能打开你自己的 MicroMsg.db；验证通过后才保存。
            密钥不会发送给任何服务器,包括 lumos 自己。
          </>
        ) : (
          <>
            微信把聊天记录用密码加密存在你 mac 上。这个密码只在微信运行时存在内存里。
            lumos 用 macOS 自带的调试工具暂时附着到微信进程,从内存里把密码读出来,之后所有解密都本地完成。
            密码不会发送给任何服务器,包括 lumos 自己。
          </>
        )}
      </Disclosure>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 5: restore wechat signature
// ─────────────────────────────────────────────────────────────────────────

function RestoreSection() {
  return (
    <Card>
      <div className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold mb-1">把微信恢复成原版</h3>
          <p className="text-sm text-foreground/85 leading-relaxed">
            密钥已经取到。现在请把微信恢复成 App Store 的原版,这样
            <span className="text-foreground"> 截屏、录屏、辅助功能 </span>
            等系统权限会立刻恢复。<span className="text-muted-foreground">已经取到的密钥继续可用,不需要重做。</span>
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="default" size="sm" asChild>
          <a href={WECHAT_APP_STORE_URL} target="_blank" rel="noreferrer" className="gap-1.5">
            <ArrowUpRight className="h-3.5 w-3.5" />
            打开 App Store 重装
          </a>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <a href="https://mac.weixin.qq.com/" target="_blank" rel="noreferrer" className="gap-1.5">
            <ArrowUpRight className="h-3.5 w-3.5" />
            或从微信官网下载
          </a>
        </Button>
      </div>

      <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        重装后会自动检测,这一步会消失
      </p>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Phase 6: ready & maintenance
// ─────────────────────────────────────────────────────────────────────────

interface DiagnosticsResponse {
  diagnostics: WeChatMessageDbDiagnostics;
}

async function fetchMessageDbDiagnostics(): Promise<WeChatMessageDbDiagnostics> {
  const res = await fetch('/api/wechat-export/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'diagnostics', args: {} }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof json?.message === 'string'
      ? json.message
      : typeof json?.error === 'string'
        ? json.error
        : 'diagnostics_failed';
    throw new Error(message);
  }
  return (json as DiagnosticsResponse).diagnostics || {};
}

function RepairIncompleteMessagesSection({ panel }: { panel: ReturnType<typeof useWeChatExport> }) {
  const [diagnostics, setDiagnostics] = useState<WeChatMessageDbDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshDiagnostics = async () => {
    setLoading(true);
    setError(null);
    try {
      setDiagnostics(await fetchMessageDbDiagnostics());
    } catch (err) {
      setError(err instanceof Error ? err.message : '诊断失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshDiagnostics();
  }, []);

  const unreadable = diagnostics?.message_db_unreadable ?? 0;
  const total = diagnostics?.message_db_total ?? 0;
  const readable = diagnostics?.message_db_readable ?? 0;
  const skipped = diagnostics?.skipped_message_db_names?.join('、') || '';
  const signed = panel.status?.env?.signed;
  const isWindows = panel.status?.platform === 'win32';
  const windowsWechatRunning = panel.status?.env?.wechat.running !== false;
  const runningResign = panel.busy === 'resign';
  const runningExtract = panel.busy === 'extract';
  const mustRelaxWeChat = panel.status?.platform === 'darwin' && (signed === 'tencent' || signed === 'unknown');
  const runRepair = async () => {
    if (isWindows && !windowsWechatRunning) {
      setError('请先打开 Windows 微信并停留在主界面，然后重新检测。');
      return;
    }
    if (mustRelaxWeChat) {
      const relaxed = await panel.resignWeChat();
      await refreshDiagnostics();
      if (!relaxed) return;
      await sleep(8000);
    }
    await panel.startExtract();
    await refreshDiagnostics();
  };

  if (!loading && !error && unreadable <= 0) return null;

  return (
    <Card tone="highlight">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <CircleAlert className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold">修复消息读取不完整</h3>
          </div>
          <p className="text-sm text-foreground/85 leading-relaxed">
            左侧会话列表读取的是摘要库，详情读取的是消息库。消息库密钥不完整时，会出现左侧最新、点进去旧消息或空白。
          </p>
        </div>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => void refreshDiagnostics()}>
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          重新检测
        </Button>
      </div>

      {error ? (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
          {error}
        </div>
      ) : loading ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在检测消息库…
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-foreground/85">
            当前消息库可读 <span className="font-mono tabular-nums">{readable}/{total}</span>
            {unreadable > 0 ? <>，还有 <span className="font-mono tabular-nums">{unreadable}</span> 个未解密。</> : null}
            {skipped ? <div className="mt-1 font-mono text-[11px] text-muted-foreground">未解密：{skipped}</div> : null}
          </div>

          {runningExtract ? (
            <div className="rounded-md border border-border/40 bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span className="text-muted-foreground">{panel.busyMessage || '正在重新提取密钥…'}</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                已新取出 <span className="font-mono text-foreground tabular-nums">{panel.extractKeys}</span> 个密钥
              </div>
              <Button variant="ghost" size="sm" className="mt-2" onClick={panel.cancelExtract}>
                取消
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={runningExtract || runningResign || (isWindows && !windowsWechatRunning)}
              onClick={() => void runRepair()}
            >
              {runningResign || runningExtract ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {mustRelaxWeChat ? '开始修复' : '重新提取消息库密钥'}
            </Button>
            {isWindows && !windowsWechatRunning ? (
              <span className="text-xs text-muted-foreground">
                重新提取时需要先打开 Windows 微信。
              </span>
            ) : isWindows ? (
              <span className="text-xs text-muted-foreground">
                下一步会读取当前运行中的 Windows 微信进程。
              </span>
            ) : !mustRelaxWeChat ? (
              <span className="text-xs text-muted-foreground">
                微信读取保护已临时放开，下一步会直接重新提取。
              </span>
            ) : null}
          </div>

          <div className="text-xs text-muted-foreground leading-relaxed">
            {isWindows
              ? '修复过程会在本机完成。点击后，Lumos 会重新读取 WeChat.exe 里的数据库密钥，并合并保存到本地。'
              : '修复过程会在本机完成。点击开始后，Lumos 会先处理微信读取保护，再自动重新提取消息库密钥；提取完成后，页面会继续提示你把微信恢复成原版。'}
          </div>
        </div>
      )}
    </Card>
  );
}

function ReadyView({ panel }: { panel: ReturnType<typeof useWeChatExport> }) {
  const env = panel.status?.env;
  const status = panel.status?.status;
  const enabled = !!panel.status?.mcp?.enabled;
  const isMac = panel.status?.platform === 'darwin';

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`h-2 w-2 rounded-full ${
                  enabled ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/40'
                }`}
              />
              <h3 className="text-sm font-semibold">
                {enabled ? '已启用' : '准备就绪 · 还没启用'}
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              已取到 <span className="font-mono text-foreground tabular-nums">{status?.keyCount ?? 0}</span> 个密钥
              {env?.dataDir.wxid ? (
                <> · 账号 <span className="font-mono">{env.dataDir.wxid}</span></>
              ) : null}
              {status?.lastExtractedAt ? (
                <> · 上次更新 {formatRelativeTime(status.lastExtractedAt)}</>
              ) : null}
            </p>
          </div>
          {enabled ? (
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
              {panel.busy === 'enable' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              启用
            </Button>
          )}
        </div>
      </Card>

      {enabled ? <RepairIncompleteMessagesSection panel={panel} /> : null}

      {enabled ? <WeChatBrowser /> : null}

      <Disclosure title="维护与隐私">
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground leading-relaxed">
            数据完全本地处理。只有你向 AI 提问、需要引用微信内容时,
            <span className="text-foreground">仅当次涉及的片段</span>会被发送到你配置的 AI 服务商。
          </p>
          {isMac && env?.signed === 'adhoc' ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <div className="text-foreground/85 leading-relaxed">
                微信目前还是临时签名状态,系统权限可能受限。建议从 App Store 重装恢复原版,
                <span className="text-muted-foreground">已取到的密钥不受影响。</span>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={panel.busy === 'uninstall'}
              onClick={() => {
                if (!confirm('确认要清除全部数据并停用?这会删除已取到的密钥。')) return;
                void panel.toggle('uninstall');
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              清除全部数据并停用
            </Button>
          </div>
        </div>
      </Disclosure>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Disclosure: a simple "为什么要这样做?" / 维护 toggle
// ─────────────────────────────────────────────────────────────────────────

function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 rounded-md border border-border/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>{title}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="px-3 pb-3 pt-1 text-xs text-muted-foreground leading-relaxed">{children}</div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function formatRelativeTime(epoch: number): string {
  const diff = Date.now() - epoch;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(epoch).toLocaleDateString('zh-CN');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────
// Top-level orchestrator
// ─────────────────────────────────────────────────────────────────────────

export function WeChatExportPanel() {
  const panel = useWeChatExport();
  const { status, statusError, actionMessage } = panel;

  if (!status) {
    if (statusError) {
      return (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{statusError}</AlertDescription>
        </Alert>
      );
    }
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        加载中…
      </div>
    );
  }

  if (!status.supported) {
    return (
      <div className="max-w-2xl">
        <Hero enabled={false} />
        <div className="mt-4 rounded-xl border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
          {status.message || '当前平台暂不支持。'}
        </div>
      </div>
    );
  }

  const phase = status.status?.phase;
  const enabled = !!status.mcp?.enabled;

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <Hero enabled={enabled && phase === 'ready'} />

      {actionMessage ? (
        <Alert variant={actionMessage.kind === 'error' ? 'destructive' : 'default'}>
          {actionMessage.kind === 'error' ? <AlertCircle className="h-4 w-4" /> : null}
          <AlertDescription>{actionMessage.text}</AlertDescription>
        </Alert>
      ) : null}

      {phase === 'needs-consent' && <ConsentSection panel={panel} />}
      {phase === 'needs-env' && <EnvSection panel={panel} />}
      {phase === 'needs-resign' && (
        <>
          <EnvSection panel={panel} />
          <PrepareWeChatSection panel={panel} />
        </>
      )}
      {phase === 'needs-extract' && (
        <>
          <EnvSection panel={panel} />
          <ExtractSection panel={panel} />
        </>
      )}
      {phase === 'needs-restore' && (
        <>
          <ReadyView panel={panel} />
          <RestoreSection />
        </>
      )}
      {phase === 'ready' && <ReadyView panel={panel} />}
    </div>
  );
}

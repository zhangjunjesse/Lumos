'use client';

/**
 * 「当前微信账号」区块 —— 常驻显示,不设任何前置条件。
 *
 * 这一点是这次改动的重点。此前手动指定路径只在"自动检测失败"时才显示、重新绑定
 * 只在"检测到换号"时才显示,而换微信号恰好让两个条件同时不成立(旧目录还在 →
 * 检测算成功;新号刚登录数据少 → 猜不出换了号)。结果用户界面上一个能点的都没有,
 * 只能找开发。所以这里的原则是:**自救入口的可达性不能依赖 Lumos 猜得准**。
 * 自动检测只负责把提示写清楚,不再决定按钮出不出现。
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, ChevronDown, ChevronRight, FolderOpen, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import type { useWeChatExport } from './use-wechat-export';

type Panel = ReturnType<typeof useWeChatExport>;

export function WeChatAccountSection({ panel }: { panel: Panel }) {
  const [expanded, setExpanded] = useState(false);
  const status = panel.status;
  if (!status?.supported) return null;

  const bound = status.boundAccount;
  const binding = status.windowsAccountBinding;
  const mirrorCount = status.mirrorAccounts?.length ?? 0;
  // 只认硬证据(目录没了 / 有密钥却没绑定)。以前把"猜的账号≠绑定的账号"也算进来,
  // 结果用户刚手动配好账号,界面还在报警说检测到的是另一个号 —— 那个"检测"本身就常错。
  const needsRebind = Boolean(binding?.mismatch);

  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium">当前微信账号</h4>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {bound?.wxid ?? '尚未绑定 —— 取一次密钥,或在下面手动指定聊天数据目录'}
          </p>
          {/* 没绑定时才把猜测拿出来当建议;已经绑定了就闭嘴 —— 用户说了算,
              一个不可靠的猜测没资格在旁边质疑他刚做的设置。 */}
          {!bound && binding?.activeWxid ? (
            <p className="mt-1 text-xs text-muted-foreground">
              可能是 <span className="font-mono">{binding.activeWxid}</span>(未确认,取密钥或手动指定后才算数)
            </p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown className="mr-1 h-3.5 w-3.5" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" />}
          换号 / 手动设置
        </Button>
      </div>

      {needsRebind ? (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <p className="text-xs leading-relaxed text-foreground/80">
            {binding?.reason === 'stored-dir-missing'
              ? '绑定的账号数据目录已经不在了(换机 / 删号 / 微信换了目录)。点下面的「清空并重新绑定」重来一次。'
              : '已经取到密钥但还没确认属于哪个账号。展开下面手动指定一次聊天数据目录即可。'}
          </p>
        </div>
      ) : null}

      {expanded ? (
        <div className="mt-3 space-y-3 border-t border-border/50 pt-3">
          <ManualPathFields panel={panel} />
          <ResetControls panel={panel} mirrorCount={mirrorCount} />
        </div>
      ) : null}
    </div>
  );
}

/** 清空入口。无前置条件 —— 这是用户不必找开发就能自己脱困的保证。 */
function ResetControls({ panel, mirrorCount }: { panel: Panel; mirrorCount: number }) {
  const [confirming, setConfirming] = useState(false);
  const running = panel.busy === 'reset-key';

  return (
    <div className="rounded-md border border-border/50 bg-background/40 p-3">
      <div className="flex items-start gap-2">
        <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium">清空微信配置,重新来过</h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            清掉已保存的密钥、账号绑定和手动路径,并删除本机缓存的聊天数据,回到刚安装的状态。
            微信本身的聊天记录不受影响 —— Lumos 只读不写,清掉的都是它自己同步过来的副本。
            {mirrorCount > 1 ? `本机缓存过 ${mirrorCount} 个账号的数据。` : ''}
          </p>
        </div>
      </div>

      {confirming ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium text-foreground">确定要清空吗?清完需要重新取一次密钥。</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" className="h-8" disabled={running}
              onClick={async () => { await panel.resetAll(false); setConfirming(false); }}>
              {running ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              清空当前账号
            </Button>
            {mirrorCount > 1 ? (
              <Button size="sm" variant="outline" className="h-8" disabled={running}
                onClick={async () => { await panel.resetAll(true); setConfirming(false); }}>
                连历史账号一起清({mirrorCount} 个)
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" className="h-8" disabled={running}
              onClick={() => setConfirming(false)}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="mt-3 h-8" disabled={running}
          onClick={() => setConfirming(true)}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          清空并重新绑定
        </Button>
      )}
    </div>
  );
}

/** 手动指定路径。以前藏在"自动检测失败"条件后面,现在常驻可达。 */
function ManualPathFields({ panel }: { panel: Panel }) {
  const config = panel.status?.windowsPathConfig;
  const hint = panel.status?.windowsPathHint;
  const [exePath, setExePath] = useState(config?.wechatExePath || '');
  const [dataRoot, setDataRoot] = useState(config?.wechatDataRoot || '');
  const running = panel.busy === 'path';
  const isWindows = panel.status?.platform === 'win32';
  if (!isWindows) return null;

  const pick = async (
    kind: 'wechatExe' | 'dataDir',
    current: string,
    setValue: (v: string) => void,
  ) => {
    const api = window.electronAPI?.dialog;
    const chooser = kind === 'wechatExe' ? api?.openFile : api?.openFolder;
    if (!chooser) {
      void panel.saveWindowsPath(kind, current);
      return;
    }
    const result = kind === 'wechatExe'
      ? await api!.openFile!({
          title: '选择 WeChat.exe 或 Weixin.exe',
          filters: [{ name: 'Windows 程序', extensions: ['exe'] }],
          multi: false,
        })
      : await api!.openFolder!({ title: '选择微信设置里的保存目录或账号数据目录' });
    const selected = result.canceled ? '' : result.filePaths[0] || '';
    if (!selected) return;
    setValue(selected);
    void panel.saveWindowsPath(kind, selected);
  };

  return (
    <div className="rounded-md border border-border/50 bg-background/40 p-3">
      <div className="flex items-start gap-2">
        <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium">手动指定微信路径</h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Lumos 会自动发现;自动挑错了账号(比如你有多个微信号)时,在这里直接指定要用哪个。
            选定聊天数据目录后,Lumos 就认这个账号,不再自己猜。
          </p>
          <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
            <p>程序路径:右键微信图标 → 打开文件所在位置 → 选 WeChat.exe 或 Weixin.exe。</p>
            <p>聊天数据:微信设置 → 文件管理 里能看到保存位置;也可选 WeChat Files、xwechat_files、账号目录、MSG、db_storage。</p>
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <PathRow
          value={exePath} onChange={setExePath} disabled={running}
          placeholder="WeChat.exe / Weixin.exe 路径"
          onPick={() => void pick('wechatExe', exePath, setExePath)}
          onSave={() => void panel.saveWindowsPath('wechatExe', exePath)}
          pickLabel="选择程序"
        />
        <PathRow
          value={dataRoot} onChange={setDataRoot} disabled={running}
          placeholder="聊天数据目录,例如 D:\\xwechat_files"
          onPick={() => void pick('dataDir', dataRoot, setDataRoot)}
          onSave={() => void panel.saveWindowsPath('dataDir', dataRoot)}
          pickLabel="选择目录"
        />
        {hint?.path ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            不确定选哪一层就选微信设置里显示的「保存目录」。当前识别到 {hint.path}
            {hint.wxid ? `(账号 ${hint.wxid})` : ''}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PathRow({
  value, onChange, disabled, placeholder, onPick, onSave, pickLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder: string;
  onPick: () => void;
  onSave: () => void;
  pickLabel: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 text-xs"
      />
      <Button type="button" size="sm" variant="outline" className="h-8" disabled={disabled} onClick={onPick}>
        {pickLabel}
      </Button>
      <Button type="button" size="sm" className="h-8" disabled={disabled || !value.trim()} onClick={onSave}>
        {disabled ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
        保存
      </Button>
    </div>
  );
}

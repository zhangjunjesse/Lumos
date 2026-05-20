import { execFile, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { getActiveUserId } from '@/lib/auth/user-service';
import { getDb } from '@/lib/db/connection';

export const LUMOS_ISSUE_ALLOWED_EMAILS = [
  'zhangjun@xinge.tech',
  'weiliuyan06@163.com',
  'zj391504704@gmail.com',
] as const;

const DEFAULT_GITHUB_REPO = 'zhangjunjesse/Lumos';
const GITHUB_API_BASE = 'https://api.github.com';
const MAX_BODY_FIELD_LENGTH = 4_000;
const MAX_TITLE_LENGTH = 140;
const execFileAsync = promisify(execFile);

export type LumosIssueSeverity = 'low' | 'medium' | 'high' | 'critical' | 'unknown';

export interface LumosBugReportInput {
  title: string;
  summary?: string;
  actualBehavior: string;
  expectedBehavior?: string;
  reproductionSteps?: string[];
  affectedArea?: string;
  uiRoute?: string;
  severity?: LumosIssueSeverity;
  logsOrArtifacts?: string[];
  screenshots?: string[];
  suspectedFiles?: string[];
  acceptanceChecks?: string[];
  additionalContext?: string;
  rawUserMessage?: string;
  confirmedByUser?: boolean;
}

interface IssueReporterIdentity {
  id: string;
  email: string;
  nickname?: string | null;
}

export interface IssueEnvironment {
  appVersion: string;
  nextPublicAppVersion: string | null;
  nodeVersion: string;
  electronVersion: string | null;
  chromeVersion: string | null;
  platform: NodeJS.Platform;
  arch: string;
  osRelease: string;
  osType: string;
  timezone: string;
  locale: string;
  nodeEnv: string | null;
  cwd: string;
  dataDir: string | null;
  git: {
    repository: string | null;
    remote: string | null;
    branch: string | null;
    commit: string | null;
    dirtyFileCount: number | null;
  };
}

interface CreateGithubIssueInput {
  repository: string;
  title: string;
  body: string;
  labels: string[];
}

interface CreateGithubIssueResult {
  issueNumber: number;
  issueUrl: string;
  repository: string;
  labelsApplied: string[];
}

export interface SubmitLumosBugIssueOptions {
  userId?: string;
  reporter?: IssueReporterIdentity;
  dryRun?: boolean;
  now?: Date;
  createGithubIssue?: (input: CreateGithubIssueInput) => Promise<CreateGithubIssueResult>;
}

export interface SubmitLumosBugIssueResult {
  success: true;
  dryRun: boolean;
  repository: string;
  title: string;
  issueNumber?: number;
  issueUrl?: string;
  reporterEmail: string;
  body: string;
  environment: IssueEnvironment;
  labelsApplied: string[];
}

export function normalizeIssueReporterEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAllowedIssueReporterEmail(email: string): boolean {
  return (LUMOS_ISSUE_ALLOWED_EMAILS as readonly string[]).includes(
    normalizeIssueReporterEmail(email),
  );
}

export async function submitLumosBugIssue(
  input: LumosBugReportInput,
  options: SubmitLumosBugIssueOptions = {},
): Promise<SubmitLumosBugIssueResult> {
  const reporter = resolveReporter(options);
  const reporterEmail = normalizeIssueReporterEmail(reporter.email);
  if (!isAllowedIssueReporterEmail(reporterEmail)) {
    throw new Error(
      `当前 Lumos 登录账号 ${reporter.email || '(unknown)'} 不在 bug 提交白名单，无法自动提交 GitHub Issue。`,
    );
  }

  const title = normalizeTitle(input.title);
  if (!title) throw new Error('Issue 标题不能为空。');
  if (!String(input.actualBehavior || '').trim()) {
    throw new Error('请先提供实际异常表现 actualBehavior，避免提交空泛 Issue。');
  }
  if (!options.dryRun && input.confirmedByUser !== true) {
    throw new Error('提交 GitHub Issue 前需要用户明确确认；如果只是整理草稿，请使用 dryRun。');
  }

  const environment = collectIssueEnvironment();
  const repository = resolveGithubRepository(environment);
  const labels = resolveGithubLabels(input.severity);
  const body = formatLumosBugIssueBody({
    input,
    reporter: { ...reporter, email: reporterEmail },
    environment,
    now: options.now ?? new Date(),
  });

  if (options.dryRun) {
    return {
      success: true,
      dryRun: true,
      repository,
      title,
      reporterEmail,
      body,
      environment,
      labelsApplied: [],
    };
  }

  const createIssue = options.createGithubIssue ?? createGithubIssueViaRest;
  const created = await createIssue({
    repository,
    title,
    body,
    labels,
  });

  return {
    success: true,
    dryRun: false,
    repository: created.repository,
    title,
    issueNumber: created.issueNumber,
    issueUrl: created.issueUrl,
    reporterEmail,
    body,
    environment,
    labelsApplied: created.labelsApplied,
  };
}

export function formatLumosBugIssueBody(args: {
  input: LumosBugReportInput;
  reporter: IssueReporterIdentity;
  environment: IssueEnvironment;
  now: Date;
}): string {
  const { input, reporter, environment, now } = args;
  const severity = input.severity ?? 'unknown';
  const steps = normalizeList(input.reproductionSteps);
  const logs = normalizeList(input.logsOrArtifacts);
  const screenshots = normalizeList(input.screenshots);
  const suspectedFiles = normalizeList(input.suspectedFiles);
  const acceptanceChecks = normalizeList(input.acceptanceChecks);

  return [
    '## Title',
    safeMarkdownBlock(input.title),
    '',
    '## Summary',
    safeMarkdownBlock(input.summary || input.actualBehavior),
    '',
    '## Reporter',
    `- Email: ${reporter.email}`,
    `- Lumos user id: ${reporter.id || 'unknown'}`,
    `- Nickname: ${reporter.nickname || 'unknown'}`,
    `- Reported at: ${now.toISOString()}`,
    '',
    '## Environment',
    `- Lumos version: ${environment.appVersion}`,
    `- NEXT_PUBLIC_APP_VERSION: ${environment.nextPublicAppVersion || 'not set'}`,
    `- Runtime: Node ${environment.nodeVersion}${environment.electronVersion ? `, Electron ${environment.electronVersion}` : ''}${environment.chromeVersion ? `, Chrome ${environment.chromeVersion}` : ''}`,
    `- OS: ${environment.osType} ${environment.osRelease} (${environment.platform}/${environment.arch})`,
    `- Timezone / locale: ${environment.timezone} / ${environment.locale}`,
    `- NODE_ENV: ${environment.nodeEnv || 'not set'}`,
    `- Data dir: ${environment.dataDir || 'unknown'}`,
    `- Working dir: ${environment.cwd || 'unknown'}`,
    `- Git repo: ${environment.git.repository || 'unknown'}`,
    `- Git branch: ${environment.git.branch || 'unknown'}`,
    `- Git commit: ${environment.git.commit || 'unknown'}`,
    `- Git dirty files: ${environment.git.dirtyFileCount ?? 'unknown'}`,
    '',
    '## Product Area',
    `- Affected area: ${safeInline(input.affectedArea || 'unknown')}`,
    `- UI route/page: ${safeInline(input.uiRoute || 'unknown')}`,
    `- Severity: ${severity}`,
    '',
    '## Reproduction Steps',
    steps.length > 0 ? steps.map((step, index) => `${index + 1}. ${safeMarkdownBlock(step)}`).join('\n') : '- Not provided',
    '',
    '## Actual Behavior',
    safeMarkdownBlock(input.actualBehavior),
    '',
    '## Expected Behavior',
    safeMarkdownBlock(input.expectedBehavior || 'Not provided'),
    '',
    '## Logs / Artifacts',
    formatBulletList(logs),
    '',
    '## Screenshots / Media',
    formatBulletList(screenshots),
    '',
    '## AI Coding Hints',
    'These fields are intended to help an AI coding agent localize and verify the fix.',
    '',
    '**Suspected files/modules**',
    formatBulletList(suspectedFiles),
    '',
    '**Acceptance checks**',
    formatBulletList(acceptanceChecks),
    '',
    '## Additional Context',
    safeMarkdownBlock(input.additionalContext || 'Not provided'),
    '',
    '## Original User Message',
    safeMarkdownBlock(input.rawUserMessage || 'Not provided'),
    '',
    '<!-- Generated by Lumos Issue Reporter. Secrets, cookies, API keys, and auth tokens should be redacted before submission. -->',
  ].join('\n');
}

export function collectIssueEnvironment(): IssueEnvironment {
  const gitRemote = safeGit(['remote', 'get-url', 'origin']);
  const repository = parseGithubRepository(gitRemote || '') || DEFAULT_GITHUB_REPO;
  return {
    appVersion: readPackageVersion(),
    nextPublicAppVersion: process.env.NEXT_PUBLIC_APP_VERSION || null,
    nodeVersion: process.version,
    electronVersion: process.versions.electron || null,
    chromeVersion: process.versions.chrome || null,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    osType: os.type(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
    locale: Intl.DateTimeFormat().resolvedOptions().locale || 'unknown',
    nodeEnv: process.env.NODE_ENV || null,
    cwd: redactHomePath(process.cwd()),
    dataDir: redactHomePath(
      process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos'),
    ),
    git: {
      repository,
      remote: gitRemote,
      branch: safeGit(['rev-parse', '--abbrev-ref', 'HEAD']),
      commit: safeGit(['rev-parse', '--short', 'HEAD']),
      dirtyFileCount: countDirtyFiles(),
    },
  };
}

function resolveReporter(options: SubmitLumosBugIssueOptions): IssueReporterIdentity {
  if (options.reporter) return options.reporter;
  const userId = options.userId || getActiveUserId();
  if (!userId) {
    throw new Error('当前未登录 Lumos 账号，无法校验 bug 提交白名单。');
  }
  const row = getDb().prepare(
    'SELECT id, email, nickname FROM lumos_users WHERE id = ?',
  ).get(userId) as IssueReporterIdentity | undefined;
  if (!row?.email) {
    throw new Error('当前 Lumos 账号缺少邮箱，无法校验 bug 提交白名单。');
  }
  return row;
}

function normalizeTitle(title: string): string {
  const trimmed = String(title || '').replace(/\s+/g, ' ').trim();
  const withPrefix = /^\[?bug\]?[:：\s-]/i.test(trimmed) ? trimmed : `[Bug] ${trimmed}`;
  return withPrefix.slice(0, MAX_TITLE_LENGTH);
}

function safeInline(value: string): string {
  return clampText(value).replace(/\r?\n/g, ' ').trim();
}

function safeMarkdownBlock(value: string): string {
  return clampText(value).trim() || 'Not provided';
}

function clampText(value: string): string {
  const text = String(value || '').trim();
  if (text.length <= MAX_BODY_FIELD_LENGTH) return text;
  return `${text.slice(0, MAX_BODY_FIELD_LENGTH)}\n\n[truncated by Lumos Issue Reporter]`;
}

function normalizeList(values: string[] | undefined): string[] {
  return (values || [])
    .map((v) => clampText(v))
    .filter(Boolean)
    .slice(0, 20);
}

function formatBulletList(values: string[]): string {
  if (values.length === 0) return '- Not provided';
  return values.map((v) => `- ${safeMarkdownBlock(v)}`).join('\n');
}

function readPackageVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version || 'unknown';
  } catch {
    return process.env.NEXT_PUBLIC_APP_VERSION || 'unknown';
  }
}

function redactHomePath(value: string): string {
  const home = os.homedir();
  if (!home || !value.startsWith(home)) return value;
  return `~${value.slice(home.length)}`;
}

function safeGit(args: string[]): string | null {
  try {
    const out = execFileSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1_500,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function countDirtyFiles(): number | null {
  const status = safeGit(['status', '--short']);
  if (status == null) return null;
  if (!status) return 0;
  return status.split('\n').filter(Boolean).length;
}

function parseGithubRepository(remote: string): string | null {
  const trimmed = remote.trim();
  if (!trimmed) return null;
  const httpsMatch = trimmed.match(/^https:\/\/github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?$/i);
  if (httpsMatch) return httpsMatch[1].replace(/\.git$/i, '');
  const sshMatch = trimmed.match(/^git@github\.com:([^/\s]+\/[^/\s]+?)(?:\.git)?$/i);
  if (sshMatch) return sshMatch[1].replace(/\.git$/i, '');
  return null;
}

function resolveGithubRepository(environment: IssueEnvironment): string {
  const configured = process.env.LUMOS_GITHUB_ISSUE_REPO || process.env.GITHUB_REPOSITORY || '';
  return parseGithubRepository(configured) || configured.trim() || environment.git.repository || DEFAULT_GITHUB_REPO;
}

function resolveGithubLabels(severity: LumosIssueSeverity | undefined): string[] {
  const configured = process.env.LUMOS_GITHUB_ISSUE_LABELS;
  const base = configured == null ? ['bug'] : configured.split(',');
  const labels = base.map((label) => label.trim()).filter(Boolean);
  if (severity && severity !== 'unknown') labels.push(`severity:${severity}`);
  return [...new Set(labels)];
}

async function createGithubIssueViaRest(input: CreateGithubIssueInput): Promise<CreateGithubIssueResult> {
  const token = process.env.LUMOS_GITHUB_ISSUE_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  if (!token.trim()) {
    return createGithubIssueViaGhCli(input);
  }

  return createGithubIssueWithLabels(input, token, input.labels, true);
}

async function createGithubIssueViaGhCli(input: CreateGithubIssueInput): Promise<CreateGithubIssueResult> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-issue-'));
  const bodyFile = path.join(tempDir, 'issue.md');
  fs.writeFileSync(bodyFile, input.body, 'utf8');
  const labelArgs = input.labels.flatMap((label) => ['--label', label]);
  try {
    const { stdout } = await execFileAsync('gh', [
      'issue',
      'create',
      '--repo',
      input.repository,
      '--title',
      input.title,
      '--body-file',
      bodyFile,
      ...labelArgs,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    const issueUrl = stdout.trim().split(/\s+/).find((part) =>
      /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+$/i.test(part),
    ) || '';
    const issueNumber = Number(issueUrl.match(/\/issues\/(\d+)$/)?.[1] || 0);
    if (!issueUrl || !issueNumber) {
      throw new Error(`GitHub CLI 已返回，但未解析到 Issue URL：${stdout.trim() || '(empty output)'}`);
    }
    return {
      issueNumber,
      issueUrl,
      repository: input.repository,
      labelsApplied: input.labels,
    };
  } catch (error) {
    if (input.labels.length > 0) {
      return createGithubIssueViaGhCli({ ...input, labels: [] });
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `缺少可用的 GitHub Issue 提交凭据。请配置 LUMOS_GITHUB_ISSUE_TOKEN（或 GITHUB_TOKEN / GH_TOKEN），或先在本机完成 gh CLI 登录并确保对 ${input.repository} 有 issues 写入权限。GitHub CLI 错误：${detail}`,
    );
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

async function createGithubIssueWithLabels(
  input: CreateGithubIssueInput,
  token: string,
  labels: string[],
  allowRetryWithoutLabels: boolean,
): Promise<CreateGithubIssueResult> {
  const res = await fetch(`${GITHUB_API_BASE}/repos/${input.repository}/issues`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Lumos-Issue-Reporter',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      title: input.title,
      body: input.body,
      labels,
    }),
  });
  const data = await safeJson(res);

  if (!res.ok) {
    if (res.status === 422 && labels.length > 0 && allowRetryWithoutLabels) {
      return createGithubIssueWithLabels(input, token, [], false);
    }
    throw new Error(formatGithubError(res.status, data));
  }

  const issueNumber = Number((data as { number?: number }).number);
  const issueUrl = String((data as { html_url?: string }).html_url || '');
  if (!issueNumber || !issueUrl) {
    throw new Error('GitHub 已响应，但未返回 issue number / html_url。');
  }
  return {
    issueNumber,
    issueUrl,
    repository: input.repository,
    labelsApplied: labels,
  };
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function formatGithubError(status: number, data: unknown): string {
  const message = typeof data === 'object' && data && 'message' in data
    ? String((data as { message?: unknown }).message || '')
    : '';
  if (status === 401 || status === 403) {
    return `GitHub 拒绝创建 Issue（HTTP ${status}）。请检查 token 是否有效且有目标仓库 issues 写入权限。${message ? ` GitHub: ${message}` : ''}`;
  }
  if (status === 404) {
    return `GitHub 仓库不可访问（HTTP 404）。请检查 LUMOS_GITHUB_ISSUE_REPO / token 仓库权限。${message ? ` GitHub: ${message}` : ''}`;
  }
  return `GitHub 创建 Issue 失败（HTTP ${status}）。${message ? `GitHub: ${message}` : ''}`;
}

import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import JSZip from 'jszip';
import { dataDir } from '@/lib/db/connection';
import {
  recordMemoryV2CapabilityEvent,
  recordMemoryV2ThirdPartyCapabilityResearchEvent,
  type MemoryV2CapabilityEventType,
  type MemoryV2CapabilityRiskLevel,
  type MemoryV2CapabilityScanVerdict,
} from './capability-events';

export type CapabilityLabFindingSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type CapabilityLabFindingCategory =
  | 'structure'
  | 'secret'
  | 'execution'
  | 'network'
  | 'filesystem'
  | 'dependency'
  | 'environment'
  | 'permission'
  | 'supply_chain'
  | 'license'
  | 'validation';

export interface CapabilityLabFileInput {
  path: string;
  content: string;
}

export interface StageThirdPartyCapabilityInput {
  capabilityType: MemoryV2CapabilityEventType;
  capabilityName: string;
  sourceUrl?: string;
  files: CapabilityLabFileInput[];
  source?: string;
}

export interface DownloadThirdPartyCapabilityInput {
  capabilityType: MemoryV2CapabilityEventType;
  capabilityName?: string;
  sourceUrl: string;
  source?: string;
}

export type CapabilityResearchSource = 'manual' | 'github' | 'deepsearch' | 'douyin';

export interface CapabilityResearchCandidateInput {
  capabilityType: MemoryV2CapabilityEventType;
  capabilityName: string;
  source: CapabilityResearchSource;
  sourceUrl?: string;
  title?: string;
  summary?: string;
  evidence?: string;
  tags?: string[];
  autoDownload?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CapabilityResearchCandidateResult {
  recorded: boolean;
  downloaded: boolean;
  staged?: DownloadThirdPartyCapabilityResult;
}

export interface CapabilityLabFinding {
  id: string;
  severity: CapabilityLabFindingSeverity;
  category: CapabilityLabFindingCategory;
  message: string;
  filePath: string;
  evidence: string;
}

export interface CapabilityLabScanResult {
  capabilityType: MemoryV2CapabilityEventType;
  capabilityName: string;
  rootPath: string;
  sourceUrl: string;
  filesScanned: number;
  bytesScanned: number;
  verdict: MemoryV2CapabilityScanVerdict;
  riskLevel: MemoryV2CapabilityRiskLevel;
  findings: CapabilityLabFinding[];
  policy: CapabilityLabScanPolicy;
  patterns: string[];
  rewriteTarget: string;
}

export interface CapabilityLabScanPolicy {
  installAllowed: boolean;
  rewriteRequired: boolean;
  userApprovalRequired: boolean;
  missingAcceptance: string[];
  requiredReview: string[];
  blockedReasons: string[];
}

export interface StageThirdPartyCapabilityResult {
  importId: string;
  rootPath: string;
  writtenFiles: string[];
  scan: CapabilityLabScanResult;
}

export interface DownloadThirdPartyCapabilityResult extends StageThirdPartyCapabilityResult {
  sourceUrl: string;
  fetchedUrl: string;
  downloadKind: 'github-repo' | 'github-file' | 'zip' | 'text';
}

export interface CapabilityInstallPrecheckItemInput {
  capabilityType: MemoryV2CapabilityEventType;
  capabilityName: string;
  files: CapabilityLabFileInput[];
  sourceUrl?: string;
  version?: string;
  metadata?: Record<string, unknown>;
}

export interface CapabilityInstallPrecheckItemResult {
  capabilityType: MemoryV2CapabilityEventType;
  capabilityName: string;
  importId: string;
  rootPath: string;
  versionHash: string;
  scan: CapabilityLabScanResult;
}

export interface CapabilityInstallPrecheckResult {
  governanceId: string;
  source: string;
  installAllowed: boolean;
  userApprovalRequired: boolean;
  rewriteRequired: boolean;
  blockedReasons: string[];
  missingAcceptance: string[];
  requiredReview: string[];
  items: CapabilityInstallPrecheckItemResult[];
  rollbackPlan: string;
  versionPlan: string;
}

const MAX_STAGE_FILES = 80;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 3 * 1024 * 1024;
const MAX_SCAN_FILES = 160;
const MAX_SCAN_BYTES = 5 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 20000;
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'raw.githubusercontent.com',
  'gist.githubusercontent.com',
  'codeload.github.com',
]);
const HIGH_RISK_DEPENDENCIES = new Set([
  'child_process',
  'shelljs',
  'node-pty',
  'ffi-napi',
  'ref-napi',
  'robotjs',
  'puppeteer',
  'playwright',
  'selenium-webdriver',
  'keytar',
  'winreg',
  'pyautogui',
  'pynput',
  'cryptography',
  'paramiko',
]);
const ACCEPTANCE_PATTERNS = [
  /验收|acceptance|self[-\s]?test|smoke|test command|测试/i,
  /verify|验证|npm\s+test|pnpm\s+test|yarn\s+test|pytest|go\s+test/i,
];
const FRONTMATTER_ALLOWED_TOOLS_PATTERN = /allowed-tools\s*:\s*([^\n]+)/i;
const PRIVATE_KEY_PATTERN = /-----BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const GITHUB_TOKEN_PATTERN = /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g;
const SCANNABLE_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt',
  '.json', '.jsonc', '.yaml', '.yml', '.toml',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.sh', '.bash', '.zsh', '.ps1',
  '.env', '.example',
]);

interface ScanRule {
  severity: CapabilityLabFindingSeverity;
  category: CapabilityLabFindingCategory;
  message: string;
  pattern: RegExp;
}

const SCAN_RULES: ScanRule[] = [
  {
    severity: 'critical',
    category: 'secret',
    message: '发现疑似明文 API key / token / cookie / password',
    pattern: /(password|passwd|pwd|token|api[_\s-]?key|secret|cookie|authorization|密钥|密码|令牌|登录态)\s*[:：=]\s*([^\s，,；;]+)/ig,
  },
  {
    severity: 'critical',
    category: 'secret',
    message: '发现疑似 OpenAI/Anthropic 风格密钥',
    pattern: /\b(sk-[A-Za-z0-9_-]{12,})\b/g,
  },
  {
    severity: 'critical',
    category: 'secret',
    message: '发现私钥块',
    pattern: PRIVATE_KEY_PATTERN,
  },
  {
    severity: 'critical',
    category: 'secret',
    message: '发现疑似 GitHub token',
    pattern: GITHUB_TOKEN_PATTERN,
  },
  {
    severity: 'critical',
    category: 'secret',
    message: '发现疑似 JWT / 会话令牌',
    pattern: JWT_PATTERN,
  },
  {
    severity: 'high',
    category: 'execution',
    message: '发现下载后直接执行脚本的高风险模式',
    pattern: /(curl|wget|Invoke-WebRequest|iwr)\b[^\n|;&]{0,240}(\||;|&&)\s*(sh|bash|zsh|powershell|pwsh|iex|Invoke-Expression)\b/ig,
  },
  {
    severity: 'high',
    category: 'execution',
    message: '发现危险删除或权限提升命令',
    pattern: /\b(sudo|rm\s+-rf|chmod\s+\+x|Set-ExecutionPolicy|powershell\s+-enc)\b/ig,
  },
  {
    severity: 'high',
    category: 'execution',
    message: '发现动态执行代码模式',
    pattern: /\b(eval|exec|Function\s*\(|child_process|subprocess\.|os\.system|spawn\s*\(|execSync\s*\()\b/g,
  },
  {
    severity: 'medium',
    category: 'network',
    message: '发现网络访问或外部下载行为',
    pattern: /\b(fetch|axios|requests\.|urllib\.|httpx\.|curl|wget)\b|https?:\/\/[^\s'")<>]+/ig,
  },
  {
    severity: 'medium',
    category: 'filesystem',
    message: '发现文件读写或目录遍历行为',
    pattern: /\b(fs\.(readFile|writeFile|rm|unlink|mkdir|readdir)|open\s*\(|Path\(|shutil\.|os\.remove|os\.unlink)\b/g,
  },
  {
    severity: 'medium',
    category: 'environment',
    message: '发现环境变量或 header 读取行为，需要确认凭证边界',
    pattern: /\b(process\.env|os\.environ|dotenv|headers?\s*[:=]|Authorization)\b/ig,
  },
  {
    severity: 'medium',
    category: 'dependency',
    message: '发现运行时依赖安装命令',
    pattern: /\b(npm\s+install|pnpm\s+add|yarn\s+add|pip\s+install|uv\s+pip|brew\s+install)\b/ig,
  },
  {
    severity: 'high',
    category: 'supply_chain',
    message: '发现包管理生命周期脚本',
    pattern: /"(preinstall|install|postinstall|prepare|prepublish|postpack)"\s*:/ig,
  },
  {
    severity: 'high',
    category: 'permission',
    message: '发现请求危险工具权限',
    pattern: /allowed-tools\s*:\s*.*\b(Bash|Shell|PowerShell|Write|Edit|MultiEdit|Delete|WebFetch)\b/ig,
  },
];

function normalizeText(value: unknown, max = 2000): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function redactEvidence(value: string): string {
  return value
    .replace(/(password|passwd|pwd|token|api[_\s-]?key|secret|cookie|authorization|密钥|密码|令牌|登录态)\s*[:：=]\s*([^\s，,；;]+)/ig, '$1: [已隐藏]')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[已隐藏敏感值]')
    .replace(/\b(Bearer\s+[A-Za-z0-9._-]{12,})\b/ig, '[已隐藏敏感值]');
}

function sanitizeName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || 'third-party-capability';
}

function safeRelativePath(raw: string): string {
  const normalized = path.posix.normalize(String(raw || '').replace(/\\/g, '/')).replace(/^\/+/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`unsafe capability lab file path: ${raw}`);
  }
  if (path.isAbsolute(raw)) {
    throw new Error(`absolute capability lab file path is not allowed: ${raw}`);
  }
  return normalized;
}

function getCapabilityLabRoot(): string {
  return path.join(dataDir, 'capability-lab', 'imports');
}

function assertAllowedDownloadUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('invalid capability reference URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('only https capability reference URLs are allowed');
  }
  const hostname = url.hostname.toLowerCase();
  if (!ALLOWED_DOWNLOAD_HOSTS.has(hostname)) {
    throw new Error(`unsupported capability reference host: ${hostname}`);
  }
  if (net.isIP(hostname)) {
    throw new Error('IP literal capability reference URLs are not allowed');
  }
  url.hash = '';
  return url;
}

function inferCapabilityNameFromUrl(url: URL): string {
  const parts = url.pathname.split('/').map((part) => part.trim()).filter(Boolean);
  if (url.hostname === 'github.com' && parts.length >= 2) return sanitizeName(parts[1]);
  if (url.hostname === 'raw.githubusercontent.com' && parts.length >= 2) return sanitizeName(parts[1]);
  return sanitizeName(parts[parts.length - 1] || url.hostname);
}

function resolveDownloadTarget(rawUrl: string): {
  url: URL;
  downloadKind: DownloadThirdPartyCapabilityResult['downloadKind'];
  defaultFileName: string;
} {
  const url = assertAllowedDownloadUrl(rawUrl);
  const parts = url.pathname.split('/').map((part) => part.trim()).filter(Boolean);
  if (url.hostname === 'github.com' && parts.length >= 2) {
    const owner = parts[0];
    const repo = parts[1];
    if (parts[2] === 'blob' && parts.length >= 5) {
      const branch = parts[3];
      const filePath = parts.slice(4).join('/');
      return {
        url: assertAllowedDownloadUrl(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`),
        downloadKind: 'github-file',
        defaultFileName: path.basename(filePath) || 'reference.txt',
      };
    }
    if (parts[2] === 'tree' && parts.length >= 4) {
      return {
        url: assertAllowedDownloadUrl(`https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${parts[3]}`),
        downloadKind: 'github-repo',
        defaultFileName: `${repo}.zip`,
      };
    }
    if (parts.length === 2 || parts[2] === '') {
      return {
        url: assertAllowedDownloadUrl(`https://codeload.github.com/${owner}/${repo}/zip/refs/heads/main`),
        downloadKind: 'github-repo',
        defaultFileName: `${repo}.zip`,
      };
    }
  }
  if (url.pathname.toLowerCase().endsWith('.zip')) {
    return { url, downloadKind: 'zip', defaultFileName: path.basename(url.pathname) || 'reference.zip' };
  }
  return { url, downloadKind: 'text', defaultFileName: path.basename(url.pathname) || 'reference.txt' };
}

function ensureInside(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('capability lab path escaped quarantine root');
  }
}

async function fetchWithLimit(url: URL): Promise<{ finalUrl: string; contentType: string; buffer: Buffer }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/plain, text/markdown, application/json, application/zip, application/octet-stream;q=0.8, */*;q=0.5',
        'User-Agent': 'Lumos-Capability-Lab/1.0',
      },
    });
    if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
    const finalUrl = assertAllowedDownloadUrl(response.url || url.toString());
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(`download too large: ${contentLength} bytes`);
    }
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(`download too large: ${arrayBuffer.byteLength} bytes`);
    }
    return {
      finalUrl: finalUrl.toString(),
      contentType: response.headers.get('content-type') || '',
      buffer: Buffer.from(arrayBuffer),
    };
  } finally {
    clearTimeout(timer);
  }
}

function stripArchiveTopDirectory(relativePath: string): string {
  const safe = safeRelativePath(relativePath);
  const parts = safe.split('/').filter(Boolean);
  if (parts.length > 1) return parts.slice(1).join('/');
  return parts.join('/');
}

async function zipBufferToFiles(buffer: Buffer): Promise<CapabilityLabFileInput[]> {
  const zip = await JSZip.loadAsync(buffer);
  const files: CapabilityLabFileInput[] = [];
  let totalBytes = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const pathInZip = stripArchiveTopDirectory(entry.name);
    if (!pathInZip) continue;
    const lowered = pathInZip.toLowerCase();
    if (lowered.includes('/.git/') || lowered.includes('/node_modules/') || lowered.includes('/__pycache__/') || lowered.includes('/.venv/')) continue;
    if (!shouldScanFile(pathInZip) && !['readme', 'license'].some((name) => path.basename(lowered).startsWith(name))) continue;
    const content = await entry.async('string');
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_FILE_BYTES) continue;
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES || files.length >= MAX_STAGE_FILES) break;
    files.push({ path: pathInZip, content });
  }
  if (files.length === 0) throw new Error('downloaded archive did not contain scannable files');
  return files;
}

function shouldScanFile(filePath: string): boolean {
  const base = path.basename(filePath);
  if (base === 'SKILL.md' || base === 'package.json' || base === 'pyproject.toml' || base === 'requirements.txt') return true;
  if (base.startsWith('.env')) return true;
  return SCANNABLE_EXTENSIONS.has(path.extname(base).toLowerCase());
}

function listFiles(root: string): string[] {
  const result: string[] = [];
  const stack = [root];
  while (stack.length > 0 && result.length < MAX_SCAN_FILES) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '__pycache__' || entry.name === '.venv') continue;
      const fullPath = path.join(dir, entry.name);
      ensureInside(root, fullPath);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        result.push(fullPath);
      }
      if (result.length >= MAX_SCAN_FILES) break;
    }
  }
  return result;
}

function findingId(input: Omit<CapabilityLabFinding, 'id'>): string {
  return crypto
    .createHash('sha1')
    .update(`${input.severity}:${input.category}:${input.message}:${input.filePath}:${input.evidence}`)
    .digest('hex')
    .slice(0, 16);
}

function createFinding(input: Omit<CapabilityLabFinding, 'id'>): CapabilityLabFinding {
  return { id: findingId(input), ...input };
}

function severityRank(severity: CapabilityLabFindingSeverity): number {
  if (severity === 'critical') return 5;
  if (severity === 'high') return 4;
  if (severity === 'medium') return 3;
  if (severity === 'low') return 2;
  return 1;
}

function inferVerdict(findings: CapabilityLabFinding[]): MemoryV2CapabilityScanVerdict {
  if (findings.some((finding) => finding.severity === 'critical' || finding.severity === 'high')) return 'blocked';
  if (findings.some((finding) => finding.severity === 'medium')) return 'review_required';
  return 'safe';
}

function inferRiskLevel(findings: CapabilityLabFinding[]): MemoryV2CapabilityRiskLevel {
  if (findings.some((finding) => finding.severity === 'critical' || finding.severity === 'high')) return 'high';
  if (findings.some((finding) => finding.severity === 'medium')) return 'medium';
  return 'low';
}

function parseJsonFile(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item;
  }
  return result;
}

function createPolicyFromFindings(findings: CapabilityLabFinding[], textByFile: Array<{ relativePath: string; content: string }>): CapabilityLabScanPolicy {
  const blockedReasons = findings
    .filter((finding) => finding.severity === 'critical' || finding.severity === 'high')
    .map((finding) => `${finding.category}: ${finding.message}`)
    .slice(0, 12);
  const requiredReview = findings
    .filter((finding) => finding.severity === 'medium')
    .map((finding) => `${finding.category}: ${finding.message}`)
    .slice(0, 12);
  const combined = textByFile.map((file) => `${file.relativePath}\n${file.content}`).join('\n');
  const hasAcceptance = ACCEPTANCE_PATTERNS.some((pattern) => pattern.test(combined));
  const missingAcceptance = [
    hasAcceptance ? '' : '缺少安装前自检 / smoke test / 验收说明',
    /rollback|回滚|uninstall|卸载/i.test(combined) ? '' : '缺少回滚或卸载说明',
    /permission|权限|capability|能力边界|allowed-tools/i.test(combined) ? '' : '缺少权限边界说明',
  ].filter(Boolean);

  return {
    installAllowed: blockedReasons.length === 0 && missingAcceptance.length === 0,
    rewriteRequired: blockedReasons.length > 0 || requiredReview.length > 0,
    userApprovalRequired: true,
    missingAcceptance,
    requiredReview,
    blockedReasons,
  };
}

function scanStructuredFiles(file: { relativePath: string; content: string }): CapabilityLabFinding[] {
  const findings: CapabilityLabFinding[] = [];
  const base = path.basename(file.relativePath);
  if (base === 'package.json') {
    const parsed = parseJsonFile(file.content);
    if (parsed) {
      const scripts = parseStringRecord(parsed.scripts);
      for (const [name, script] of Object.entries(scripts)) {
        if (/preinstall|install|postinstall|prepare|prepublish|postpack/i.test(name)) {
          findings.push(createFinding({
            severity: 'high',
            category: 'supply_chain',
            message: 'package.json 包含安装生命周期脚本',
            filePath: file.relativePath,
            evidence: redactEvidence(`${name}: ${normalizeText(script, 180)}`),
          }));
        }
      }
      const dependencies = {
        ...parseStringRecord(parsed.dependencies),
        ...parseStringRecord(parsed.devDependencies),
        ...parseStringRecord(parsed.optionalDependencies),
      };
      for (const dep of Object.keys(dependencies)) {
        if (HIGH_RISK_DEPENDENCIES.has(dep)) {
          findings.push(createFinding({
            severity: 'medium',
            category: 'dependency',
            message: '发现高风险依赖，需要人工确认用途',
            filePath: file.relativePath,
            evidence: dep,
          }));
        }
      }
    }
  }

  if (base === 'requirements.txt' || base === 'pyproject.toml') {
    for (const dep of HIGH_RISK_DEPENDENCIES) {
      if (new RegExp(`(^|[^a-z0-9_-])${dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9_-]|$)`, 'i').test(file.content)) {
        findings.push(createFinding({
          severity: 'medium',
          category: 'dependency',
          message: '发现高风险依赖，需要人工确认用途',
          filePath: file.relativePath,
          evidence: dep,
        }));
      }
    }
  }

  if (base === 'SKILL.md' || base.endsWith('.md')) {
    const match = FRONTMATTER_ALLOWED_TOOLS_PATTERN.exec(file.content);
    if (match?.[1] && /\b(Bash|Shell|PowerShell|Write|Edit|MultiEdit|Delete|WebFetch)\b/i.test(match[1])) {
      findings.push(createFinding({
        severity: 'high',
        category: 'permission',
        message: 'Skill frontmatter 请求危险工具权限',
        filePath: file.relativePath,
        evidence: redactEvidence(normalizeText(match[0], 200)),
      }));
    }
  }

  return findings;
}

function inferPatterns(textByFile: Array<{ relativePath: string; content: string }>): string[] {
  const all = textByFile.map((file) => `${file.relativePath}\n${file.content}`).join('\n').toLowerCase();
  const patterns = new Set<string>();
  if (/skill\.md|description:|allowed-tools|progressive|scripts?\//i.test(all)) patterns.add('progressive disclosure skill layout');
  if (/memory|reflect|reflection|conversation|history|chat/i.test(all)) patterns.add('conversation reflection');
  if (/checklist|acceptance|验收|步骤|workflow|sop/i.test(all)) patterns.add('checklist / SOP workflow');
  if (/mcp|tools\/list|tools\/call|jsonrpc|server\.py|server\.ts/i.test(all)) patterns.add('MCP tool contract');
  if (/template|frontmatter|schema|输出格式|json/i.test(all)) patterns.add('structured output template');
  return Array.from(patterns).slice(0, 12);
}

function buildRewriteTarget(capabilityType: MemoryV2CapabilityEventType, capabilityName: string, result: {
  verdict: MemoryV2CapabilityScanVerdict;
  riskLevel: MemoryV2CapabilityRiskLevel;
  patterns: string[];
}): string {
  const noun = capabilityType === 'mcp' ? 'MCP' : 'Skill';
  const base = `生成 Lumos 自己的 ${noun}「${capabilityName}」二开版本，只复用设计思路，不复制第三方代码。`;
  const safety = result.verdict === 'safe'
    ? '即使扫描为 safe，安装前仍需能力生成器产出可验收计划并由用户确认。'
    : '原参考不得直接安装，应先移除危险命令、明文凭证和未声明权限，再通过自检。';
  const patternText = result.patterns.length > 0 ? `可学习模式：${result.patterns.join('；')}。` : '';
  return [base, safety, patternText].filter(Boolean).join('\n');
}

export function getMemoryV2CapabilityLabRoot(): string {
  return getCapabilityLabRoot();
}

function hashCapabilityFiles(files: CapabilityLabFileInput[]): string {
  const hash = crypto.createHash('sha256');
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(safeRelativePath(file.path));
    hash.update('\0');
    hash.update(String(file.content ?? ''));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function buildInstallPolicyFile(input: {
  capabilityType: MemoryV2CapabilityEventType;
  capabilityName: string;
  source: string;
  versionHash: string;
  metadata?: Record<string, unknown>;
}): CapabilityLabFileInput {
  const noun = input.capabilityType === 'mcp' ? 'MCP' : 'Skill';
  const metadata = input.metadata || {};
  const declaredPermissions = Array.isArray(metadata.permissions)
    ? metadata.permissions.map((item) => normalizeText(item, 120)).filter(Boolean).slice(0, 20)
    : [];
  const declaredSelfTests = Array.isArray(metadata.selfTests)
    ? metadata.selfTests.map((item) => normalizeText(item, 160)).filter(Boolean).slice(0, 20)
    : [];
  return {
    path: 'LUMOS_INSTALL_POLICY.md',
    content: [
      `# Lumos 安装前验收策略：${noun} ${input.capabilityName}`,
      '',
      `来源：${input.source}`,
      `版本指纹：${input.versionHash}`,
      '',
      '## 权限边界 / permission boundary',
      declaredPermissions.length > 0
        ? declaredPermissions.map((item) => `- ${item}`).join('\n')
        : '- 仅按安装计划声明的 Skill 文本、MCP transport、命令、URL、环境变量占位符和参数运行。',
      '- 不允许安装计划外的文件写入、Shell 管道执行、明文凭据、隐藏下载或未声明网络访问。',
      '',
      '## 安装前自检 / acceptance / smoke test',
      declaredSelfTests.length > 0
        ? declaredSelfTests.map((item) => `- ${item}`).join('\n')
        : '- 安装前必须通过 Lumos Capability Lab 静态扫描。',
      input.capabilityType === 'mcp'
        ? '- MCP 安装后必须执行 initialize、notifications/initialized、tools/list 协议自检；失败应回滚。'
        : '- Skill 安装后必须能在能力列表中显示名称、描述和启用状态。',
      '',
      '## 回滚 / rollback / uninstall',
      '- 安装或更新前必须保存旧版本快照。',
      '- 任一写入、自检或健康检查失败时，应恢复旧版本并删除本次新建产物。',
      '- 回滚结果必须写入能力事件账，供睡眠复盘继续分析。',
    ].join('\n'),
  };
}

function stageAndScanInstallPrecheckCapability(input: {
  capabilityType: MemoryV2CapabilityEventType;
  capabilityName: string;
  files: CapabilityLabFileInput[];
  source: string;
  sourceUrl?: string;
  versionHash: string;
  metadata?: Record<string, unknown>;
}): StageThirdPartyCapabilityResult {
  const capabilityName = normalizeText(input.capabilityName, 120);
  if (!capabilityName) throw new Error('capability name is required');
  const policyFile = buildInstallPolicyFile({
    capabilityType: input.capabilityType,
    capabilityName,
    source: input.source,
    versionHash: input.versionHash,
    metadata: input.metadata,
  });
  const files = [...input.files, policyFile];
  if (files.length === 0) throw new Error('at least one capability install file is required');
  if (files.length > MAX_STAGE_FILES) throw new Error(`too many capability install files: ${files.length}`);

  const importId = `install-precheck-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(4).toString('hex')}-${sanitizeName(capabilityName)}`;
  const root = path.join(getCapabilityLabRoot(), importId);
  fs.mkdirSync(root, { recursive: true });

  const writtenFiles: string[] = [];
  let totalBytes = 0;
  for (const file of files) {
    const relative = safeRelativePath(file.path);
    const content = String(file.content ?? '');
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_FILE_BYTES) throw new Error(`capability install file too large: ${relative}`);
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('capability install precheck exceeds total size limit');
    const target = path.join(root, ...relative.split('/'));
    ensureInside(root, target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
    writtenFiles.push(relative);
  }

  recordMemoryV2CapabilityEvent({
    capabilityType: input.capabilityType,
    capabilityName,
    scope: 'install-precheck',
    action: 'install_precheck_staged',
    status: 'success',
    source: input.source,
    summary: `安装前预检已写入隔离区：${writtenFiles.length} 个文件，尚未安装或启用。`,
    relatedId: input.sourceUrl || '',
    version: input.versionHash,
    metadata: {
      importId,
      rootPath: root,
      writtenFiles,
      totalBytes,
      installState: 'not_installed',
      ...(input.metadata || {}),
    },
  });

  const scan = scanThirdPartyCapabilityImport({
    capabilityType: input.capabilityType,
    capabilityName,
    rootPath: root,
    sourceUrl: input.sourceUrl,
    source: input.source,
  });
  return { importId, rootPath: root, writtenFiles, scan };
}

export function precheckGeneratedCapabilityInstall(input: {
  source?: string;
  items: CapabilityInstallPrecheckItemInput[];
}): CapabilityInstallPrecheckResult {
  const source = normalizeText(input.source || 'capability-install-precheck', 120);
  const governanceId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(4).toString('hex')}`;
  const items = input.items
    .map((item) => ({
      ...item,
      capabilityName: normalizeText(item.capabilityName, 120),
      files: item.files || [],
    }))
    .filter((item) => item.capabilityName && item.files.length > 0);
  if (items.length === 0) {
    throw new Error('capability install precheck requires at least one scannable item');
  }

  const checkedItems: CapabilityInstallPrecheckItemResult[] = [];
  for (const item of items) {
    const versionHash = item.version || hashCapabilityFiles(item.files);
    const staged = stageAndScanInstallPrecheckCapability({
      capabilityType: item.capabilityType,
      capabilityName: item.capabilityName,
      files: item.files,
      source,
      sourceUrl: item.sourceUrl,
      versionHash,
      metadata: {
        governanceId,
        ...(item.metadata || {}),
      },
    });
    checkedItems.push({
      capabilityType: item.capabilityType,
      capabilityName: item.capabilityName,
      importId: staged.importId,
      rootPath: staged.rootPath,
      versionHash,
      scan: staged.scan,
    });
  }

  const blockedReasons = checkedItems.flatMap((item) => item.scan.policy.blockedReasons);
  const missingAcceptance = checkedItems.flatMap((item) => item.scan.policy.missingAcceptance);
  const requiredReview = checkedItems.flatMap((item) => item.scan.policy.requiredReview);
  const installAllowed = checkedItems.every((item) => item.scan.policy.installAllowed && item.scan.verdict !== 'blocked');
  const rewriteRequired = checkedItems.some((item) => item.scan.policy.rewriteRequired || item.scan.verdict === 'blocked');
  const result: CapabilityInstallPrecheckResult = {
    governanceId,
    source,
    installAllowed,
    userApprovalRequired: true,
    rewriteRequired,
    blockedReasons: Array.from(new Set(blockedReasons)).slice(0, 24),
    missingAcceptance: Array.from(new Set(missingAcceptance)).slice(0, 24),
    requiredReview: Array.from(new Set(requiredReview)).slice(0, 24),
    items: checkedItems,
    rollbackPlan: '安装前创建旧版本快照；任一写入、自检或健康检查失败时恢复旧版本，并删除本次新建产物。',
    versionPlan: '每个 Skill/MCP 以内容 SHA-256 作为版本指纹，安装、更新、预检和回滚事件都会写入能力事件账。',
  };

  for (const item of checkedItems) {
    recordMemoryV2CapabilityEvent({
      capabilityType: item.capabilityType,
      capabilityName: item.capabilityName,
      scope: 'install-precheck',
      action: 'install_prechecked',
      status: installAllowed ? 'success' : 'failed',
      source,
      summary: installAllowed
        ? '能力产物通过安装前静态预检，可进入用户确认和安装写入。'
        : '能力产物未通过安装前静态预检，已阻止安装写入。',
      detail: [
        ...result.blockedReasons.map((reason) => `阻断：${reason}`),
        ...result.missingAcceptance.map((reason) => `待补：${reason}`),
        ...result.requiredReview.map((reason) => `需审：${reason}`),
      ].slice(0, 24).join('\n'),
      relatedId: item.importId,
      version: item.versionHash,
      metadata: {
        governanceId,
        rootPath: item.rootPath,
        scanVerdict: item.scan.verdict,
        riskLevel: item.scan.riskLevel,
        policy: item.scan.policy,
        rollbackPlan: result.rollbackPlan,
        versionPlan: result.versionPlan,
      },
    });
  }

  return result;
}

export async function recordCapabilityResearchCandidate(
  input: CapabilityResearchCandidateInput,
): Promise<CapabilityResearchCandidateResult> {
  const capabilityName = normalizeText(input.capabilityName, 120);
  if (!capabilityName) throw new Error('capability name is required');
  const sourceUrl = normalizeText(input.sourceUrl, 1000);
  recordMemoryV2ThirdPartyCapabilityResearchEvent({
    capabilityType: input.capabilityType,
    capabilityName,
    action: 'third_party_discovered',
    source: `capability-research:${input.source}`,
    candidateUrl: sourceUrl,
    scanVerdict: 'unknown',
    riskLevel: 'medium',
    summary: input.summary || input.title || `发现第三方能力候选：${capabilityName}`,
    detail: input.evidence || '',
    metadata: {
      researchSource: input.source,
      title: input.title || '',
      tags: input.tags || [],
      autoDownload: Boolean(input.autoDownload),
      ...(input.metadata || {}),
    },
  });

  if (input.autoDownload && sourceUrl) {
    const staged = await downloadStageAndScanThirdPartyCapability({
      capabilityType: input.capabilityType,
      capabilityName,
      sourceUrl,
      source: `capability-research:${input.source}`,
    });
    return { recorded: true, downloaded: true, staged };
  }
  return { recorded: true, downloaded: false };
}

export function stageAndScanThirdPartyCapability(
  input: StageThirdPartyCapabilityInput,
): StageThirdPartyCapabilityResult {
  const files = input.files || [];
  if (files.length === 0) throw new Error('at least one capability lab file is required');
  if (files.length > MAX_STAGE_FILES) throw new Error(`too many capability lab files: ${files.length}`);
  const capabilityName = normalizeText(input.capabilityName, 120);
  if (!capabilityName) throw new Error('capability name is required');

  const importId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(4).toString('hex')}-${sanitizeName(capabilityName)}`;
  const root = path.join(getCapabilityLabRoot(), importId);
  fs.mkdirSync(root, { recursive: true });

  const writtenFiles: string[] = [];
  let totalBytes = 0;
  for (const file of files) {
    const relative = safeRelativePath(file.path);
    const content = String(file.content ?? '');
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_FILE_BYTES) throw new Error(`capability lab file too large: ${relative}`);
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('capability lab import exceeds total size limit');
    const target = path.join(root, ...relative.split('/'));
    ensureInside(root, target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
    writtenFiles.push(relative);
  }

  recordMemoryV2ThirdPartyCapabilityResearchEvent({
    capabilityType: input.capabilityType,
    capabilityName,
    action: 'quarantined',
    source: input.source || 'capability-lab-api',
    candidateUrl: input.sourceUrl || '',
    quarantinePath: root,
    scanVerdict: 'unknown',
    riskLevel: 'medium',
    summary: `第三方参考已写入隔离区：${writtenFiles.length} 个文件，尚未安装或启用。`,
    metadata: {
      importId,
      writtenFiles,
      totalBytes,
    },
  });

  const scan = scanThirdPartyCapabilityImport({
    capabilityType: input.capabilityType,
    capabilityName,
    rootPath: root,
    sourceUrl: input.sourceUrl,
    source: input.source,
  });
  return { importId, rootPath: root, writtenFiles, scan };
}

export async function downloadStageAndScanThirdPartyCapability(
  input: DownloadThirdPartyCapabilityInput,
): Promise<DownloadThirdPartyCapabilityResult> {
  const target = resolveDownloadTarget(input.sourceUrl);
  const capabilityName = normalizeText(input.capabilityName || inferCapabilityNameFromUrl(assertAllowedDownloadUrl(input.sourceUrl)), 120);
  if (!capabilityName) throw new Error('capability name is required');

  recordMemoryV2ThirdPartyCapabilityResearchEvent({
    capabilityType: input.capabilityType,
    capabilityName,
    action: 'third_party_discovered',
    source: input.source || 'capability-lab-downloader',
    candidateUrl: input.sourceUrl,
    scanVerdict: 'unknown',
    riskLevel: 'medium',
    summary: `发现第三方能力参考，准备下载到隔离区：${input.sourceUrl}`,
    metadata: {
      requestedUrl: input.sourceUrl,
      fetchedUrl: target.url.toString(),
      downloadKind: target.downloadKind,
    },
  });

  let download: { finalUrl: string; contentType: string; buffer: Buffer };
  try {
    download = await fetchWithLimit(target.url);
  } catch (error) {
    recordMemoryV2ThirdPartyCapabilityResearchEvent({
      capabilityType: input.capabilityType,
      capabilityName,
      action: 'quarantined',
      status: 'failed',
      source: input.source || 'capability-lab-downloader',
      candidateUrl: input.sourceUrl,
      scanVerdict: 'blocked',
      riskLevel: 'high',
      summary: '第三方参考下载失败，未进入隔离区。',
      detail: error instanceof Error ? error.message : String(error),
      metadata: {
        requestedUrl: input.sourceUrl,
        fetchedUrl: target.url.toString(),
        downloadKind: target.downloadKind,
      },
    });
    throw error;
  }

  const looksZip = target.downloadKind === 'github-repo'
    || target.downloadKind === 'zip'
    || /application\/(zip|x-zip-compressed)|octet-stream/i.test(download.contentType);
  const files = looksZip
    ? await zipBufferToFiles(download.buffer)
    : [{
        path: target.defaultFileName,
        content: download.buffer.toString('utf8'),
      }];
  const staged = stageAndScanThirdPartyCapability({
    capabilityType: input.capabilityType,
    capabilityName,
    sourceUrl: input.sourceUrl,
    source: input.source || 'capability-lab-downloader',
    files,
  });
  return {
    ...staged,
    sourceUrl: input.sourceUrl,
    fetchedUrl: download.finalUrl,
    downloadKind: target.downloadKind,
  };
}

export function scanThirdPartyCapabilityImport(input: {
  capabilityType: MemoryV2CapabilityEventType;
  capabilityName: string;
  rootPath: string;
  sourceUrl?: string;
  source?: string;
}): CapabilityLabScanResult {
  const root = path.resolve(input.rootPath);
  const labRoot = path.resolve(getCapabilityLabRoot());
  ensureInside(labRoot, root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error('capability lab import directory does not exist');
  }

  const files = listFiles(root);
  const findings: CapabilityLabFinding[] = [];
  const textByFile: Array<{ relativePath: string; content: string }> = [];
  let bytesScanned = 0;

  if (input.capabilityType === 'skill' && !files.some((file) => path.basename(file) === 'SKILL.md' || file.endsWith('.md'))) {
    findings.push(createFinding({
      severity: 'medium',
      category: 'structure',
      message: 'Skill 参考缺少 SKILL.md 或 Markdown 主入口',
      filePath: '.',
      evidence: '未发现 SKILL.md / *.md',
    }));
  }

  if (input.capabilityType === 'mcp' && !files.some((file) => /server\.(py|js|ts|mjs|cjs)$|package\.json|pyproject\.toml/.test(path.basename(file)))) {
    findings.push(createFinding({
      severity: 'medium',
      category: 'structure',
      message: 'MCP 参考缺少可识别的 server 或 manifest',
      filePath: '.',
      evidence: '未发现 server.* / package.json / pyproject.toml',
    }));
  }

  for (const file of files) {
    if (!shouldScanFile(file)) continue;
    const relativePath = path.relative(root, file).replace(/\\/g, '/');
    const stat = fs.statSync(file);
    if (stat.size > MAX_FILE_BYTES) {
      findings.push(createFinding({
        severity: 'medium',
        category: 'structure',
        message: '文件超过单文件扫描上限，未完整扫描',
        filePath: relativePath,
        evidence: `${stat.size} bytes`,
      }));
      continue;
    }
    if (bytesScanned + stat.size > MAX_SCAN_BYTES) {
      findings.push(createFinding({
        severity: 'medium',
        category: 'structure',
        message: '导入内容超过总扫描上限，后续文件未扫描',
        filePath: relativePath,
        evidence: `${bytesScanned + stat.size} bytes`,
      }));
      break;
    }
    const content = fs.readFileSync(file, 'utf8');
    bytesScanned += stat.size;
    textByFile.push({ relativePath, content });
    findings.push(...scanStructuredFiles({ relativePath, content }));
    for (const rule of SCAN_RULES) {
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      let count = 0;
      while ((match = rule.pattern.exec(content)) && count < 5) {
        const evidence = redactEvidence(normalizeText(match[0], 220));
        findings.push(createFinding({
          severity: rule.severity,
          category: rule.category,
          message: rule.message,
          filePath: relativePath,
          evidence,
        }));
        count += 1;
      }
    }
  }

  const uniqueFindings = Array.from(new Map(findings.map((finding) => [finding.id, finding])).values())
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const verdict = inferVerdict(uniqueFindings);
  const riskLevel = inferRiskLevel(uniqueFindings);
  const policy = createPolicyFromFindings(uniqueFindings, textByFile);
  const patterns = inferPatterns(textByFile);
  const rewriteTarget = buildRewriteTarget(input.capabilityType, input.capabilityName, { verdict, riskLevel, patterns });
  const result: CapabilityLabScanResult = {
    capabilityType: input.capabilityType,
    capabilityName: input.capabilityName,
    rootPath: root,
    sourceUrl: input.sourceUrl || '',
    filesScanned: textByFile.length,
    bytesScanned,
    verdict,
    riskLevel,
    findings: uniqueFindings.slice(0, 80),
    policy,
    patterns,
    rewriteTarget,
  };

  recordMemoryV2ThirdPartyCapabilityResearchEvent({
    capabilityType: input.capabilityType,
    capabilityName: input.capabilityName,
    action: 'security_scanned',
    source: input.source || 'capability-lab-api',
    candidateUrl: input.sourceUrl || '',
    quarantinePath: root,
    scanVerdict: verdict,
    riskLevel,
    patterns,
    rewriteTarget,
    summary: `静态扫描完成：${verdict}，风险 ${riskLevel}，发现 ${uniqueFindings.length} 个问题。`,
    detail: uniqueFindings.slice(0, 12).map((finding) => `${finding.severity}/${finding.category} ${finding.filePath}: ${finding.message} (${finding.evidence})`).join('\n'),
    metadata: {
      filesScanned: result.filesScanned,
      bytesScanned: result.bytesScanned,
      findingCount: uniqueFindings.length,
      policy,
      severities: uniqueFindings.reduce<Record<string, number>>((acc, finding) => {
        acc[finding.severity] = (acc[finding.severity] || 0) + 1;
        return acc;
      }, {}),
    },
  });

  return result;
}

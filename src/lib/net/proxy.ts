import { HttpsProxyAgent } from 'https-proxy-agent';

type ProxyEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

function firstEnv(env: ProxyEnv, names: string[]): string | null {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
}

function defaultPort(protocol: string): string {
  if (protocol === 'https:') return '443';
  if (protocol === 'http:') return '80';
  return '';
}

function splitNoProxyToken(token: string): { host: string; port?: string } {
  const trimmed = token.trim().toLowerCase();
  if (!trimmed) return { host: '' };

  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end >= 0) {
      const host = trimmed.slice(1, end);
      const rest = trimmed.slice(end + 1);
      return rest.startsWith(':') ? { host, port: rest.slice(1) } : { host };
    }
  }

  const colonCount = (trimmed.match(/:/g) || []).length;
  if (colonCount === 1) {
    const [host, port] = trimmed.split(':');
    if (/^\d+$/.test(port || '')) return { host: normalizeHost(host || ''), port };
  }

  return { host: normalizeHost(trimmed) };
}

function noProxyMatchesHost(hostname: string, port: string, noProxy: string): boolean {
  const host = normalizeHost(hostname);
  if (!host) return false;

  for (const rawToken of noProxy.split(',')) {
    const { host: rawPattern, port: patternPort } = splitNoProxyToken(rawToken);
    if (!rawPattern) continue;
    if (rawPattern === '*') return true;
    if (patternPort && patternPort !== port) continue;

    const pattern = rawPattern.startsWith('*.') ? rawPattern.slice(1) : rawPattern;
    if (pattern.startsWith('.')) {
      const suffix = pattern.slice(1);
      if (host === suffix || host.endsWith(pattern)) return true;
      continue;
    }

    if (host === pattern || host.endsWith(`.${pattern}`)) return true;
  }

  return false;
}

export function getProxyForUrl(input: string | URL, env: ProxyEnv = process.env): string | null {
  const url = typeof input === 'string' ? new URL(input) : input;
  const noProxy = firstEnv(env, ['NO_PROXY', 'no_proxy']);
  const port = url.port || defaultPort(url.protocol);
  if (noProxy && noProxyMatchesHost(url.hostname, port, noProxy)) return null;

  if (url.protocol === 'https:') {
    return firstEnv(env, ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']);
  }
  if (url.protocol === 'http:') {
    return firstEnv(env, ['HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']);
  }
  return null;
}

export function createHttpsProxyAgentForUrl(
  input: string | URL,
  env: ProxyEnv = process.env,
): HttpsProxyAgent<string> | null {
  const url = typeof input === 'string' ? new URL(input) : input;
  if (url.protocol !== 'https:') return null;

  const proxyUrl = getProxyForUrl(url, env);
  if (!proxyUrl) return null;

  const proxy = new URL(proxyUrl);
  if (proxy.protocol !== 'http:' && proxy.protocol !== 'https:') {
    throw new Error(`不支持的 HTTPS 代理协议: ${proxy.protocol}`);
  }

  return new HttpsProxyAgent(proxyUrl);
}

export const proxyTestHooks = {
  noProxyMatchesHost,
};

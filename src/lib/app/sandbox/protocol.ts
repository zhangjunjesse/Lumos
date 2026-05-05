// Wire protocol between the iframe sandbox and the host.
// Both sides import this file so the message shapes stay in sync.

export const SANDBOX_PROTOCOL_VERSION = 1;

export type RpcMethod =
  | 'db.list' | 'db.get' | 'db.count' | 'db.create' | 'db.update' | 'db.delete' | 'db.watch.start' | 'db.watch.stop'
  | 'nav.subscribe' | 'nav.unsubscribe'
  | 'ai.complete' | 'ai.stream.start' | 'ai.stream.stop' | 'ai.structured'
  | 'workflow.run' | 'workflow.run.stream.start' | 'workflow.run.stream.stop'
  | 'deepsearch.start' | 'deepsearch.getResult' | 'deepsearch.pause' | 'deepsearch.resume' | 'deepsearch.cancel'
  | 'notify.toast' | 'notify.confirm' | 'notify.dialog'
  | 'storage.get' | 'storage.set' | 'storage.remove' | 'storage.clear'
  | 'secrets.get'
  | 'config.get' | 'config.all'
  | 'files.pick' | 'files.save' | 'files.read'
  | 'app.handshake' | 'app.ping';

export type ErrorCode =
  | 'PERM_DENIED'    // permission missing in manifest
  | 'NOT_FOUND'      // collection / row / route / etc. not found
  | 'VALIDATION'     // input shape wrong
  | 'TIMEOUT'        // host took too long
  | 'CANCELLED'      // request cancelled
  | 'INTERNAL'       // unexpected host error
  | 'UNSUPPORTED';   // method not implemented yet

export interface RpcError {
  code: ErrorCode;
  message: string;
  hint?: string;
}

// ---- Request from sandbox → host -----------------------------------------

export interface RpcRequest<P = unknown> {
  /** stable correlation id chosen by sandbox; host echoes back. */
  id: string;
  type: 'rpc';
  method: RpcMethod;
  params: P;
}

// ---- Response from host → sandbox ----------------------------------------

export type RpcResponse<R = unknown> =
  | { id: string; type: 'rpc-response'; result: R }
  | { id: string; type: 'rpc-response'; error: RpcError };

// ---- Streaming events (for ai.stream / db.watch / workflow.run.stream) ---

export interface RpcStreamEvent<E = unknown> {
  /** matches the original RpcRequest.id that started the stream. */
  id: string;
  type: 'rpc-stream';
  /** monotonic event seq (for ordering / dedup). */
  seq: number;
  /** 'data' = payload chunk, 'end' = stream complete, 'error' = stream error. */
  kind: 'data' | 'end' | 'error';
  /** present when kind='data'. */
  data?: E;
  /** present when kind='error'. */
  error?: RpcError;
}

// ---- Out-of-band events (host → sandbox, no request) ---------------------

export type SandboxEvent =
  | { type: 'route'; route: string; params: Record<string, string> }
  | { type: 'theme'; mode: 'light' | 'dark' }
  | { type: 'visibility'; visible: boolean }
  | { type: 'shutdown'; reason: 'host-quit' | 'user-cancel' | 'inactive' };

// ---- Handshake -----------------------------------------------------------

export interface HandshakeRequest {
  version: typeof SANDBOX_PROTOCOL_VERSION;
  appId: string;
  /** features the sandbox supports. */
  features: ReadonlyArray<'streams' | 'watchers' | 'dialogs'>;
}

export interface HandshakeResponse {
  version: typeof SANDBOX_PROTOCOL_VERSION;
  /** initial route the sandbox should mount. */
  initialRoute: { id: string; params: Record<string, string> };
  /** initial color scheme. */
  theme: 'light' | 'dark';
  /** the manifest, so sandbox knows its routes / permissions for client-side checks. */
  manifest: unknown;
}

// ---- Host → sandbox envelope (everything sent over postMessage from host) -

export type HostMessage<R = unknown, E = unknown> =
  | RpcResponse<R>
  | RpcStreamEvent<E>
  | (SandboxEvent & { type: 'route' | 'theme' | 'visibility' | 'shutdown' });

// ---- Sandbox → host envelope ---------------------------------------------

export type SandboxMessage<P = unknown> =
  | RpcRequest<P>
  | { id: string; type: 'rpc-cancel' }
  | { type: 'sandbox-ready' }
  | { type: 'sandbox-error'; error: { message: string; stack?: string; route?: string } };

// ---- Type guards ---------------------------------------------------------

export function isRpcRequest(m: unknown): m is RpcRequest {
  return !!m && typeof m === 'object' && (m as { type?: string }).type === 'rpc';
}
export function isRpcResponse(m: unknown): m is RpcResponse {
  return !!m && typeof m === 'object' && (m as { type?: string }).type === 'rpc-response';
}
export function isRpcStreamEvent(m: unknown): m is RpcStreamEvent {
  return !!m && typeof m === 'object' && (m as { type?: string }).type === 'rpc-stream';
}

/**
 * WeChat voice reply mode.
 *
 * Stored per peer so one Clawbot chat can use voice replies without changing
 * every other WeChat conversation.
 */

import { getSetting, setSetting } from '@/lib/db';

const KEY_PREFIX = 'im.wechat.voice_mode.';
const NATIVE_KEY_PREFIX = 'im.wechat.native_voice_reply.';

function peerKey(peer: string): string {
  const normalized = (peer || '').trim();
  const encoded = Buffer.from(normalized, 'utf8').toString('base64url');
  return `${KEY_PREFIX}${encoded}`;
}

export function isWechatVoiceModeEnabled(peer: string): boolean {
  if (!peer.trim()) return false;
  return getSetting(peerKey(peer)) === '1';
}

export function setWechatVoiceMode(peer: string, enabled: boolean): void {
  if (!peer.trim()) return;
  setSetting(peerKey(peer), enabled ? '1' : '0');
}

export function isWechatNativeVoiceReplyEnabled(peer: string): boolean {
  if (!peer.trim()) return false;
  const stored = getSetting(nativePeerKey(peer));
  if (stored === '1') return true;
  if (stored === '0') return false;
  return process.env.WECHAT_NATIVE_VOICE_REPLY !== '0';
}

export function setWechatNativeVoiceReply(peer: string, enabled: boolean): void {
  if (!peer.trim()) return;
  setSetting(nativePeerKey(peer), enabled ? '1' : '0');
}

function nativePeerKey(peer: string): string {
  const normalized = (peer || '').trim();
  const encoded = Buffer.from(normalized, 'utf8').toString('base64url');
  return `${NATIVE_KEY_PREFIX}${encoded}`;
}

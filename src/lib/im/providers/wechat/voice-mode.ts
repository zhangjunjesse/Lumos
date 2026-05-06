/**
 * WeChat voice reply mode.
 *
 * Stored per peer so one Clawbot chat can use voice replies without changing
 * every other WeChat conversation.
 */

import { getSetting, setSetting } from '@/lib/db';

const KEY_PREFIX = 'im.wechat.voice_mode.';

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

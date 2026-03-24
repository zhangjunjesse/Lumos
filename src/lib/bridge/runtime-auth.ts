import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { BRIDGE_RUNTIME_TOKEN_HEADER, resolveBridgeRuntimeToken } from './runtime-config';

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function isBridgeRuntimeAuthorized(request: Request): boolean {
  const expected = resolveBridgeRuntimeToken();
  if (!expected) return false;

  const actual = request.headers.get(BRIDGE_RUNTIME_TOKEN_HEADER)?.trim();
  if (!actual) return false;

  return safeEqual(actual, expected);
}

export function bridgeRuntimeUnauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: 'BRIDGE_RUNTIME_UNAUTHORIZED' }, { status: 401 });
}

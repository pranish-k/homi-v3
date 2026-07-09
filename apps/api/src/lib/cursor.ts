import { BadRequestException } from '@nestjs/common';
import { UUID_RE } from './validation';

/**
 * Keyset cursor for HOMI-16: (created_at, id) strictly descending, so
 * pages stay stable under concurrent inserts (no OFFSET, ever). Opaque
 * to clients by contract; base64url keeps it URL-safe.
 */
export interface LedgerCursor {
  /** created_at of the last returned row, ISO-8601 */
  t: string;
  /** id of the last returned row, tiebreak within one timestamp */
  id: string;
}

export function encodeCursor(cursor: LedgerCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(raw: string): LedgerCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString()) as unknown;
    const { t, id } = parsed as Partial<LedgerCursor>;
    if (typeof t !== 'string' || Number.isNaN(Date.parse(t)) || typeof id !== 'string' || !UUID_RE.test(id)) {
      throw new Error('bad cursor shape');
    }
    return { t, id };
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}

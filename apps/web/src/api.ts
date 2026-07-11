// Thin fetch layer. All paths are same-origin (Vite proxies to the API).

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new ApiError(res.status, message ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function get<T>(path: string): Promise<T> {
  return fetch(path, { credentials: 'include' }).then((r) => handle<T>(r));
}

export function post<T>(path: string, body?: unknown, idempotent = false): Promise<T> {
  return fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(idempotent ? { 'idempotency-key': crypto.randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => handle<T>(r));
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface House {
  id: string;
  name: string;
  currency: string;
  role: string;
}

export interface Member {
  userId: string;
  name: string;
  displayName: string | null;
  role: string;
  roomId: string | null;
}

export interface Balances {
  net: Record<string, number>;
  pairwise: { from: string; to: string; amountCents: number }[];
}

export type ActionItem =
  | { type: 'settle_up'; toUserId: string; amountCents: number }
  | {
      type: 'confirm_payment';
      paymentId: string;
      fromUserId: string;
      amountCents: number;
      disputableUntil: string;
    };

export interface FeedEvent {
  id: string;
  type: string;
  actorId: string;
  createdAt: string;
}

export interface Snapshot {
  house: { id: string; name: string; timezone: string; currency: string };
  members: Member[];
  balances: Balances;
  actionItems: ActionItem[];
  feed: FeedEvent[];
}

export type LedgerEntry =
  | {
      kind: 'expense';
      id: string;
      description: string;
      amountCents: number;
      currency: string;
      paidBy: string;
      createdAt: string;
      splits: Record<string, number>;
    }
  | {
      kind: 'payment';
      id: string;
      fromUser: string;
      toUser: string;
      amountCents: number;
      currency: string;
      method: string | null;
      status: 'recorded' | 'disputed' | 'resolved';
      createdAt: string;
    };

export interface LedgerPage {
  entries: LedgerEntry[];
  nextCursor: string | null;
}

/** Dev-only demo sign-in: send the magic link, then follow it so the cookie lands. */
export async function demoSignIn(email: string): Promise<SessionUser> {
  const { verifyUrl } = await post<{ verifyUrl: string }>('/dev/sign-in', { email });
  const verify = await fetch(verifyUrl, { credentials: 'include', redirect: 'manual' });
  if (verify.status >= 400) throw new ApiError(verify.status, 'magic-link verify failed');
  const session = await get<{ user: SessionUser } | null>('/api/auth/get-session');
  if (!session?.user) throw new ApiError(401, 'no session after sign-in');
  return session.user;
}

export function currentSession(): Promise<{ user: SessionUser } | null> {
  return get<{ user: SessionUser } | null>('/api/auth/get-session');
}

export function signOut(): Promise<unknown> {
  return post('/api/auth/sign-out', {});
}

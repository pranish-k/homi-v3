import { useCallback, useEffect, useRef, useState } from 'react';
import { get, post, type House, type LedgerPage, type SessionUser, type Snapshot } from './api';
import { AddExpense, RecordPayment } from './Forms';
import { fmt } from './money';

/**
 * H6 in practice: the WebSocket only tells us THAT something changed;
 * on every hint we refetch the snapshot (and reset the ledger), never
 * render the hint itself.
 */
export function HouseView({ house, me }: { house: House; me: SessionUser }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [ledger, setLedger] = useState<LedgerPage | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [live, setLive] = useState<'off' | 'on' | 'flash'>('off');
  const [error, setError] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();

  const refetch = useCallback(async () => {
    try {
      setSnapshot(await get<Snapshot>(`/v1/houses/${house.id}/snapshot`));
      setLedger(await get<LedgerPage>(`/v1/houses/${house.id}/ledger?limit=10`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [house.id]);

  useEffect(() => {
    void refetch();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/v1/houses/${house.id}/realtime`);
    ws.onopen = () => setLive('on');
    ws.onclose = () => setLive('off');
    ws.onmessage = () => {
      setLive('flash');
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setLive('on'), 600);
      void refetch();
    };
    return () => {
      clearTimeout(flashTimer.current);
      ws.close();
    };
  }, [house.id, refetch]);

  if (!snapshot) return <p className="hint">loading…</p>;

  const name = (id: string) =>
    snapshot.members.find((m) => m.userId === id)?.name ?? id.slice(0, 8);
  const cur = snapshot.house.currency;

  async function loadMore() {
    if (!ledger?.nextCursor) return;
    const next = await get<LedgerPage>(
      `/v1/houses/${house.id}/ledger?limit=10&cursor=${encodeURIComponent(ledger.nextCursor)}`,
    );
    setLedger({ entries: [...ledger.entries, ...next.entries], nextCursor: next.nextCursor });
  }

  async function dispute(paymentId: string) {
    try {
      await post(`/v1/payments/${paymentId}/dispute`);
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="house">
      <h2>
        {snapshot.house.name}
        <span className={`live live-${live}`} title="realtime connection">
          ●
        </span>
      </h2>
      {error && <p className="error">{error}</p>}

      <section>
        <h3>Members</h3>
        <ul>
          {snapshot.members.map((m) => (
            <li key={m.userId}>
              {m.name} {m.role === 'admin' ? '(admin)' : ''}{' '}
              {m.userId === me.id ? <em>— you</em> : ''}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Balances</h3>
        {snapshot.balances.pairwise.length === 0 && <p className="hint">all settled up</p>}
        <ul>
          {snapshot.balances.pairwise.map((p) => (
            <li key={`${p.from}:${p.to}`}>
              <strong>{name(p.from)}</strong> owes <strong>{name(p.to)}</strong>{' '}
              {fmt(p.amountCents, cur)}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Your action items</h3>
        {snapshot.actionItems.length === 0 && <p className="hint">nothing needs you</p>}
        <ul>
          {snapshot.actionItems.map((a) =>
            a.type === 'settle_up' ? (
              <li key={`s:${a.toUserId}`}>
                Settle up: you owe {name(a.toUserId)} {fmt(a.amountCents, cur)}
              </li>
            ) : (
              <li key={`c:${a.paymentId}`}>
                {name(a.fromUserId)} says they paid you {fmt(a.amountCents, cur)}{' '}
                <button onClick={() => void dispute(a.paymentId)}>dispute</button>
                <span className="hint">
                  {' '}
                  (window closes {new Date(a.disputableUntil).toLocaleString()})
                </span>
              </li>
            ),
          )}
        </ul>
      </section>

      <section className="forms">
        <AddExpense house={snapshot.house} members={snapshot.members} me={me} onDone={refetch} />
        <RecordPayment
          house={snapshot.house}
          members={snapshot.members}
          me={me}
          onDone={refetch}
        />
      </section>

      <section>
        <h3>
          Ledger{' '}
          <button onClick={() => setLedgerOpen((o) => !o)}>{ledgerOpen ? 'hide' : 'show'}</button>
        </h3>
        {ledgerOpen && ledger && (
          <>
            <ul className="ledger">
              {ledger.entries.map((e) => (
                <li key={e.id} className={e.kind}>
                  {e.kind === 'expense' ? (
                    <>
                      <strong>{e.description}</strong> {fmt(e.amountCents, cur)} paid by{' '}
                      {name(e.paidBy)}
                      <span className="hint"> {new Date(e.createdAt).toLocaleString()}</span>
                    </>
                  ) : (
                    <>
                      payment {name(e.fromUser)} → {name(e.toUser)} {fmt(e.amountCents, cur)}
                      {e.status !== 'recorded' && <em> [{e.status}]</em>}
                      <span className="hint"> {new Date(e.createdAt).toLocaleString()}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
            {ledger.nextCursor ? (
              <button onClick={() => void loadMore()}>load more</button>
            ) : (
              <p className="hint">end of history</p>
            )}
          </>
        )}
      </section>

      <section>
        <h3>Feed head</h3>
        <ul className="feed">
          {snapshot.feed.map((f) => (
            <li key={f.id}>
              {f.type} by {name(f.actorId)}
              <span className="hint"> {new Date(f.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

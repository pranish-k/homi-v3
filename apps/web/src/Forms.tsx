import { useState } from 'react';
import { post, type Member, type SessionUser, type Snapshot } from './api';

type HouseInfo = Snapshot['house'];

export function AddExpense({
  house,
  members,
  me,
  onDone,
}: {
  house: HouseInfo;
  members: Member[];
  me: SessionUser;
  onDone: () => Promise<void>;
}) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'equal' | 'room_weighted'>('equal');
  const [paidBy, setPaidBy] = useState(me.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const amountCents = Math.round(Number(amount) * 100);
    if (!description || !Number.isInteger(amountCents) || amountCents <= 0) {
      setError('need a description and a positive amount');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post(
        `/v1/houses/${house.id}/expenses`,
        {
          description,
          amountCents,
          paidBy,
          mode,
          participants: members.map((m) => m.userId),
        },
        true,
      );
      setDescription('');
      setAmount('');
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Add expense</h3>
      <input
        placeholder="what was it?"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <input
        placeholder={`amount (${house.currency})`}
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <label>
        paid by{' '}
        <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        split{' '}
        <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="equal">equal</option>
          <option value="room_weighted">room-weighted (rent)</option>
        </select>
      </label>
      <button disabled={busy} onClick={() => void submit()}>
        add
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function RecordPayment({
  house,
  members,
  me,
  onDone,
}: {
  house: HouseInfo;
  members: Member[];
  me: SessionUser;
  onDone: () => Promise<void>;
}) {
  const others = members.filter((m) => m.userId !== me.id);
  const [toUser, setToUser] = useState(others[0]?.userId ?? '');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const amountCents = Math.round(Number(amount) * 100);
    if (!toUser || !Number.isInteger(amountCents) || amountCents <= 0) {
      setError('need a recipient and a positive amount');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post(
        `/v1/houses/${house.id}/payments`,
        { toUser, amountCents, method: 'venmo' },
        true,
      );
      setAmount('');
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Record payment</h3>
      <label>
        I paid{' '}
        <select value={toUser} onChange={(e) => setToUser(e.target.value)}>
          {others.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <input
        placeholder={`amount (${house.currency})`}
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <button disabled={busy} onClick={() => void submit()}>
        record
      </button>
      <p className="hint">single-sided; the recipient has 72h to dispute</p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

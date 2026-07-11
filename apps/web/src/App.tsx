import { useCallback, useEffect, useState } from 'react';
import {
  currentSession,
  demoSignIn,
  get,
  signOut,
  type House,
  type SessionUser,
} from './api';
import { HouseView } from './HouseView';

export const DEMO_USERS = [
  { name: 'Ana', email: 'ana@demo.homi' },
  { name: 'Ben', email: 'ben@demo.homi' },
  { name: 'Chloe', email: 'chloe@demo.homi' },
];

export function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [houses, setHouses] = useState<House[] | null>(null);
  const [houseId, setHouseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);

  const loadHouses = useCallback(async () => {
    const mine = await get<House[]>('/dev/my-houses');
    setHouses(mine);
    setHouseId((current) => current ?? mine[0]?.id ?? null);
  }, []);

  useEffect(() => {
    currentSession()
      .then(async (s) => {
        if (s?.user) {
          setUser(s.user);
          await loadHouses();
        }
      })
      .catch(() => undefined)
      .finally(() => setBooted(true));
  }, [loadHouses]);

  async function loginAs(email: string) {
    setError(null);
    try {
      // switching identity: drop the previous session cookie first
      await signOut().catch(() => undefined);
      setHouses(null);
      setHouseId(null);
      const u = await demoSignIn(email);
      setUser(u);
      await loadHouses();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!booted) return <main className="login" />;

  if (!user) {
    return (
      <main className="login">
        <h1>HOMI demo</h1>
        <p>Sign in as a test roommate (real magic-link flow, dev-captured):</p>
        <div className="userButtons">
          {DEMO_USERS.map((u) => (
            <button key={u.email} onClick={() => void loginAs(u.email)}>
              {u.name}
            </button>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        <p className="hint">
          Empty database? Run <code>npm run demo:seed</code> first.
        </p>
      </main>
    );
  }

  const house = houses?.find((h) => h.id === houseId) ?? null;
  return (
    <main>
      <header>
        <h1>HOMI demo</h1>
        <span className="who">
          {user.name} ({user.email})
        </span>
        <span className="switch">
          switch:
          {DEMO_USERS.filter((u) => u.email !== user.email).map((u) => (
            <button key={u.email} onClick={() => void loginAs(u.email)}>
              {u.name}
            </button>
          ))}
        </span>
      </header>
      {error && <p className="error">{error}</p>}
      {houses && houses.length > 1 && (
        <nav className="houses">
          {houses.map((h) => (
            <button
              key={h.id}
              className={h.id === houseId ? 'active' : ''}
              onClick={() => setHouseId(h.id)}
            >
              {h.name}
            </button>
          ))}
        </nav>
      )}
      {house ? (
        <HouseView key={`${house.id}:${user.id}`} house={house} me={user} />
      ) : (
        <p className="hint">
          No house yet for this user. Run <code>npm run demo:seed</code>, or accept an invite.
        </p>
      )}
    </main>
  );
}

// DEMO BRANCH ONLY. Seeds a lively house through the RUNNING API's real
// endpoints (start it first: npm run demo:api). Re-running creates a
// fresh house for the same three users.
const API = process.env.API_URL ?? 'http://localhost:3000';

const USERS = [
  { name: 'Ana', email: 'ana@demo.homi' },
  { name: 'Ben', email: 'ben@demo.homi' },
  { name: 'Chloe', email: 'chloe@demo.homi' },
];

async function req(path, { method = 'GET', body, cookie, idempotent = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(idempotent ? { 'idempotency-key': crypto.randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  if (res.status >= 400) {
    throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res;
}

async function signIn(email) {
  const send = await req('/dev/sign-in', { method: 'POST', body: { email } });
  const { verifyUrl } = await send.json();
  const verify = await req(verifyUrl, {});
  const setCookies = verify.headers.getSetCookie();
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  const me = await (await req('/api/auth/get-session', { cookie })).json();
  console.log(`signed in ${email} (${me.user.id.slice(0, 8)})`);
  return { cookie, userId: me.user.id, email };
}

const [ana, ben, chloe] = await Promise.all(USERS.map((u) => signIn(u.email)));

const house = await (
  await req('/v1/houses', {
    method: 'POST',
    cookie: ana.cookie,
    body: { name: 'Maple St', timezone: 'America/New_York', currency: 'USD' },
  })
).json();
console.log(`house "${house.name}" ${house.id}`);

for (const joiner of [ben, chloe]) {
  const invite = await (
    await req(`/v1/houses/${house.id}/invites`, { method: 'POST', cookie: ana.cookie })
  ).json();
  const token = invite.url.split('/j/')[1];
  await req(`/v1/invites/${token}/accept`, { method: 'POST', cookie: joiner.cookie });
  console.log(`${joiner.email} joined via invite`);
}

await req(`/v1/houses/${house.id}/rooms`, {
  method: 'PUT',
  cookie: ana.cookie,
  body: {
    rooms: [
      { name: 'Master (own bath)', weightBp: 4000, userId: ana.userId },
      { name: 'Mid room', weightBp: 3300, userId: ben.userId },
      { name: 'Small room', weightBp: 2700, userId: chloe.userId },
    ],
  },
});
console.log('rooms configured (4000/3300/2700 bp)');

const everyone = [ana.userId, ben.userId, chloe.userId];
const expenses = [
  { as: ana, description: 'October rent', amountCents: 240000, mode: 'room_weighted' },
  { as: ana, description: 'Internet (Ana owns the account)', amountCents: 6999, mode: 'equal' },
  { as: ben, description: 'Groceries - staples run', amountCents: 8450, mode: 'equal', isStaple: true },
  { as: chloe, description: 'Cleaning supplies', amountCents: 3299, mode: 'equal', isStaple: true },
  { as: ben, description: 'Pizza night', amountCents: 5400, mode: 'equal' },
  { as: ana, description: 'Electricity', amountCents: 11025, mode: 'equal' },
];
for (const e of expenses) {
  await req(`/v1/houses/${house.id}/expenses`, {
    method: 'POST',
    cookie: e.as.cookie,
    idempotent: true,
    body: {
      description: e.description,
      amountCents: e.amountCents,
      paidBy: e.as.userId,
      mode: e.mode,
      participants: everyone,
      ...(e.isStaple ? { isStaple: true } : {}),
    },
  });
  console.log(`expense: ${e.description}`);
}

// one settled payment and one still inside its 72h dispute window, so
// Ana's HOME shows a confirm-payment action item
await req(`/v1/houses/${house.id}/payments`, {
  method: 'POST',
  cookie: chloe.cookie,
  idempotent: true,
  body: { toUser: ana.userId, amountCents: 30000, method: 'venmo' },
});
await req(`/v1/houses/${house.id}/payments`, {
  method: 'POST',
  cookie: ben.cookie,
  idempotent: true,
  body: { toUser: ana.userId, amountCents: 25000, method: 'zelle' },
});
console.log('payments recorded (both inside the 72h window)');

console.log(`\nseeded. Open http://localhost:5173 and sign in as Ana, Ben, or Chloe.`);

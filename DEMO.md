# HOMI demo (throwaway branch)

This branch (`demo/web`) exists so Pranish can click through the R1 money core in a browser on his laptop.
It never merges into `main`; when the demo has served its purpose, R1 work continues on `main` as if nothing happened.

## What is on this branch that is not on main

- `apps/web`: a small Vite + React SPA (login as test users, HOME snapshot with live updates, ledger, add expense, record/dispute payments).
- `apps/api/src/dev/dev.controller.ts`: `/dev/sign-in` (replays the dev-captured magic link so the browser can log in) and `/dev/my-houses`.
  Both register only when `NODE_ENV !== 'production'`.
- Better Auth `trustedOrigins` for `http://localhost:5173`, and an env override for the per-email magic-link budget.
- `apps/api/scripts/seed-demo.mjs` and the `demo:*` root scripts.

## Prerequisites (one time)

```bash
brew install postgresql@15 redis         # if not already installed
# scratch Postgres cluster on port 5433 with a "homi" database, plus Redis on 6379
/opt/homebrew/opt/redis/bin/redis-server --port 6379 --daemonize yes
DATABASE_URL=postgres://homi@localhost:5433/homi npm run db:migrate
```

## Run it (three terminals, or background the first two)

```bash
npm run demo:api    # API on :3000 (talks to Postgres :5433 and Redis :6379)
npm run demo:web    # web UI on http://localhost:5173 (proxies to the API)
npm run demo:seed   # once: creates Ana/Ben/Chloe + "Maple St" with rooms, expenses, payments
```

Open <http://localhost:5173>, sign in as Ana, Ben, or Chloe.
Open a second browser window as a different roommate and add an expense: the other window updates live (that is the HOMI-17 WebSocket hint -> snapshot refetch loop).

## Switching between demo and the real project

```bash
git checkout demo/web && npm ci   # work on the demo
git checkout main && npm ci       # back to the real project
git branch --show-current         # see where you are
```

`npm ci` keeps `node_modules` matching the branch's lockfile (this branch adds web dependencies).
Alternative with zero switching: `git worktree add ../homi-v3-demo demo/web` gives the demo its own directory next to this one.

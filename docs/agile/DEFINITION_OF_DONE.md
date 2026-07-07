# Definition of Done

A story is done only when every line below holds.

1. Code is typechecked, linted, and reviewed.
2. Unit tests cover the logic; money and fairness math additionally has property-based tests (spec 5.6).
3. Ledger-touching code has integration tests against real Postgres, including an authorization test asserting cross-house access fails.
4. Every money mutation is idempotent and transactional (H1); this is checked in review, not assumed.
5. Migrations are checked in, reviewed, and pass the CI dry-run; schema changes follow expand-migrate-contract (H7).
6. CI is green on the merge commit.
7. User-visible copy is direct and non-judgmental (spec 4.2).
8. No feature queries across houses (spec 6).

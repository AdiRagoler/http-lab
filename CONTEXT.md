# http-lab — context for Claude

## What this is

A deliberately minimal CRUD lab. Adi is **learning** — building a small HTTP server
backed by Postgres before adding a database to the main `pizzeria2` project.

## How to help

- **Do not write application code.** Adi writes the handlers and logic.
- Show *general* example snippets when asked (generic shapes, not their exact code).
- Reviewing their code and pointing out bugs is wanted.
- Config/boilerplate chores (package.json, tsconfig, .env) are fine to do directly.
- Keep answers short and concise. Explain concepts when asked — Adi asks a lot of
  fundamentals questions (what is a pool, what is await, what is an ORM) and wants
  real explanations, not hand-waving.

## Stack

Node 24 · TypeScript · Express 5 · raw SQL via `pg` · Postgres 18 via Homebrew · tsx

Homebrew Postgres has no `user`/`devpassword` role — that came from the old Docker
setup. It uses the macOS account name (`aragoler`) as a superuser, trust auth on
local connections, so `DATABASE_URL` has no password.

No ORM and no Docker — both were deliberately dropped. Do not reintroduce Drizzle,
drizzle-kit, or a docker-compose file.

## Files

| file | job |
|---|---|
| `src/schema.sql` | hand-written `CREATE TABLE` DDL — source of truth |
| `src/db.ts` | pg Pool, exported |
| `src/tasks.ts` | route handlers, raw SQL |
| `src/index.ts` | express app, routes, listen (port 3003) |
| `.env` | `DATABASE_URL` (gitignored) |
| `smoke.sh` | end-to-end curl check of every endpoint; self-cleaning |

Dependency direction: `index.ts` → `tasks.ts` → `db.ts` / `schema.ts`.
Same layering as pizzeria2 (`index.ts` + `orders.ts`).

## The tables

```
users: user_id (bigserial PK), username (text, not null)
tasks: id (bigserial PK), user_id (bigint, not null, REFERENCES users),
       title (text, not null),
       done (boolean, not null, default false),
       created_at (timestamptz, not null, default now())
```

One primary key per table. `tasks.user_id` is a **foreign key**, not a second PK.

## Routes

```
POST   /users/:userId/tasks       createTask         201
GET    /users/:userId/tasks       getTasksByUserId   200 (empty array is valid)
GET    /tasks/:id                 getTask            200
PATCH  /tasks/:id                 updateTaskDone     200 (sets done = TRUE)
DELETE /users/:userId/tasks/:id   deleteTask         200
```

Ownership is enforced on DELETE (nested under `:userId`) but deliberately not on
PATCH — known and accepted for now.

Conventions settled on:

- `parseId()` validates the string before `Number()`, returns `number | null`.
  Rejects `""`, `"0"`, negatives, `"1e3"`, `"0x10"`, and ids past 2^53.
- Guard queries that ask a yes/no use `SELECT EXISTS (SELECT 1 ...)` → check
  `rows[0].exists`. Handlers that want the data use `SELECT`/`RETURNING *` →
  check `rows[0] === undefined`. Do not mix these up; the polarity is opposite.
- 400 for a malformed request, 404 for an id that isn't there.

## Commands

```bash
brew services start postgresql@18                          # start Postgres
psql "postgres://aragoler@localhost:5432/db" -f src/schema.sql   # create tables
npm run dev                                                # tsx watch --env-file=.env src/index.ts
psql "postgres://aragoler@localhost:5432/db" -c '\d tasks' # verify
```

`npm run db:setup` needs `DATABASE_URL` exported — npm does not read `.env`.
Either `set -a; source .env; set +a` first, or use the literal URL above.

## Known gotchas hit so far

- `tsx watch` — `watch` must come **before** flags.
- **`pg` returns `bigint` columns as strings**, not numbers. `id` comes back as
  `"1"`. Convert before sending JSON if a number is wanted.
- **`pg` does not camelCase column names.** A row is `{ created_at, user_id }`,
  not `{ createdAt, userId }`. Alias in SQL (`created_at AS "createdAt"`) or map
  in code.
- `npm run db:setup` relies on `DATABASE_URL` being in the shell; export it or
  prefix the command.

## Current state

Migration off Drizzle and Docker is complete. All five handlers are written and
believed correct; `schema.sql`, `db.ts`, `index.ts` are done. Drizzle and Docker
files are deleted. **Not yet verified end-to-end with curl.**

## Open items Adi knows about

- Curl-test each endpoint, including the failure paths (`/tasks/abc` → 400,
  `/tasks/999` → 404, `POST /users/99/tasks` → 404).
- **Error handling — the one real gap.** No `try`/`catch` anywhere, so a DB error
  becomes Express's default HTML 500. Specifically:
  - `createTask` pre-checks the user with `SELECT EXISTS`, but that's a race: the
    user can vanish before the INSERT, hitting the FK and throwing. Catching
    Postgres code `23503` handles it atomically and lets the pre-check be deleted.
  - `express.json()` throws `SyntaxError` on malformed JSON before any handler runs.
  - Whitelist known SQLSTATEs → 4xx, re-throw everything else → 500. Never
    blanket-catch to 400.
  - Then add JSON error middleware; pizzeria2 has one worth copying.
- Nothing closes the pool on shutdown. Matters for pizzeria2, not here.

## Things Adi has already been bitten by (don't repeat)

- Reading `req.params.body` when the data is in `req.body` — `params` is only the
  `:named` path segments.
- `req.params.Id` vs `:id` — casing typos in `params`/`query`/`body` never
  typecheck, because all three are index-signature types.
- In Express 5 `req.body` is `undefined` (not `{}`) when no body parser ran, so
  `req.body?.body`.
- `typeof body !== "string"` matters — a truthy check lets an object through, and
  `pg` silently stringifies it into the TEXT column.
- Inverting the `EXISTS` boolean — see the polarity note above.
- `DELETE * FROM` is not SQL; `DELETE` takes no column list.
- Calling a helper that sends a response does **not** exit the handler — needs an
  explicit `return`, or Express throws ERR_HTTP_HEADERS_SENT.

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
· zod (ids only) · express-rate-limit 8

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
| `src/tasks.ts` | route handlers, raw SQL, `Task`/`User` types, `parseId` |
| `src/errors.ts` | `ERRORS` — every error response body, one place |
| `src/index.ts` | express app, rate limiter, routes, error middleware, listen (3003) |
| `.env` | `DATABASE_URL` (gitignored) |
| `smoke.sh` | end-to-end curl check of every endpoint; self-cleaning |

Dependency direction: `index.ts` → `tasks.ts` → `db.ts`, with `errors.ts` a leaf
both import. Same layering as pizzeria2 (`index.ts` + `orders.ts`).

## The tables

```
users: user_id (bigserial PK), username (text, not null)
tasks: id (bigserial PK), user_id (bigint, not null, REFERENCES users),
       body (text, not null),
       done (boolean, not null, default false),
       created_at (timestamptz, not null, default now())
```

One primary key per table. `tasks.user_id` is a **foreign key**, not a second PK.
No `UNIQUE` or `CHECK` constraints anywhere yet, so `23505`/`23514` cannot fire.
The FK is `ON DELETE RESTRICT` (the default) — a user with tasks cannot be deleted.

## Routes

```
POST   /users                     createUser         201
POST   /users/:userId/tasks       createTask         201
GET    /users/:userId/tasks       getTasksByUserId   200 (empty array is valid)
GET    /tasks/:id                 getTask            200
PATCH  /tasks/:id                 updateTaskDone     200 (sets done = TRUE)
DELETE /users/:userId/tasks/:id   deleteTask         200
```

Ownership is enforced on DELETE (nested under `:userId`) but deliberately not on
PATCH — known and accepted for now.

Conventions settled on:

- `parseId()` wraps a module-scope zod schema
  (`z.string().regex(/^[1-9]\d*$/).transform(Number).refine(Number.isSafeInteger)`)
  and returns `number | null`. Rejects `""`, `"0"`, negatives, `"1e3"`, `"0x10"`,
  and ids past 2^53. Never use `z.coerce.number()` here — it runs `Number()`
  first and lets `"1e3"`, `" 5 "` and `""` through.
- **Existence is a row count, not a pre-check or an exception.** No handler runs
  two queries. `getTasksByUserId` uses a `LEFT JOIN` driven from `users`;
  `createTask` uses `INSERT ... SELECT ... WHERE EXISTS (...) RETURNING *`. Both
  make "no such user" mean zero rows, so `rows[0] === undefined` → 404 reads the
  same way in all six handlers. One statement also means no TOCTOU race.
- `SELECT EXISTS (SELECT 1 ...)` as a *select list* returns a row with an
  `exists` column → check `rows[0].exists`. As a `WHERE` clause it is a filter
  and returns no column at all. Handlers that want the data use
  `SELECT`/`RETURNING *` → check `rows[0] === undefined`. Do not mix these up;
  the polarity is opposite.
- Body fields are validated with `typeof x !== "string" || x.trim() === ""`,
  read via `req.body?.field`.
- 400 for a malformed request, 404 for an id that isn't there.
- Handlers respond to *expected* problems inline (`invalidReq`, `nonExistentId`);
  they do not throw for those.

## Error handling

Every error body comes from `ERRORS` in `src/errors.ts` — one entry per response,
`as const` so a typo'd key fails to compile. Nothing hand-writes
`{ error: { code, message } }` any more.

Middleware order in `index.ts` is `limiter` → `express.json({ limit: "5kb" })` →
routes → error middleware. The limiter must stay **first** so an over-limit
request is rejected before its body is buffered and parsed.

The rate limiter is `express-rate-limit`: 100 requests per minute per IP,
`standardHeaders: "draft-8"`, `legacyHeaders: false`, and `message:
ERRORS.rateLimited` so its 429 matches the shape (its own default body is plain
text). It sends 429 itself rather than throwing, so the error middleware never
sees it. Its ~18 validation checks only ever log to the console.

The store is in-memory, so **`tsx watch` wipes the counters on every save**, and
`smoke.sh` spends ~40 of the 100 per run — a third consecutive run inside one
minute will start returning 429s that look like broken handlers.

`index.ts` ends with a 4-arg error middleware, registered after the routes:

- `err.status === 400` → JSON 400. Body-parser's malformed-JSON error.
- `err.status === 413` → JSON 413. Body over the 5kb limit.
- `err.status === 415` → JSON 415. Unsupported charset or `Content-Encoding`.
- anything else → `console.error` + JSON 500.

Every one of these is thrown inside `express.json()` **before any handler runs**,
so no handler and no `try`/`catch` can ever see them — the middleware is the only
place they can be answered, and has to stay.

`err.status`/`err.statusCode` is an HTTP status, attached by the `http-errors`
package. Unrelated to `err.code`, which is the driver's own code (`pg` puts the
Postgres SQLSTATE there). Reading the wrong one silently yields `undefined` and
falls through to the 500.

`400`/`413`/`415` is the **complete** set express.json() can throw, so these three
branches leak nothing to the 500. Enumerating beats a `status >= 400 && status <
500` range check here because each gets its own `code` string. Revisit only if
other status-throwing middleware is added later.

No Postgres error code is mapped any more. The `23503` → 404 branch was removed
once `createTask`'s `WHERE EXISTS` guard made it unreachable in normal operation;
the FK stays in the schema as the real guarantee, and a genuine race now surfaces
as a 500. This was deliberate.

`23xxx` is always an integrity-constraint violation: `23502` not-null, `23503`
FK, `23505` unique, `23514` check. Only map codes deliberately chosen; never
blanket-catch to 400, or a server fault gets reported as the client's mistake.

## Commands

```bash
brew services start postgresql@18                                # start Postgres
psql "postgres://aragoler@localhost:5432/db" -f src/schema.sql   # create tables
npm run dev                                                      # tsx watch --env-file=.env src/index.ts
npm run typecheck                                                # tsx does NOT typecheck — run this
./smoke.sh                                                       # hit every endpoint, then clean up
psql "postgres://aragoler@localhost:5432/db" -c '\d tasks'       # verify
```

`npm run db:setup` needs `DATABASE_URL` exported — npm does not read `.env`.
Either `set -a; source .env; set +a` first, or use the literal URL above.

## Known gotchas hit so far

- `tsx watch` — `watch` must come **before** flags.
- **`tsx` strips types without checking them.** Type errors do not stop the server.
  `npm run typecheck` is the only thing that catches them.
- **Editing `.env` requires a full stop and restart.** `tsx watch` reloads on
  *source* changes only and never re-reads `--env-file`, so a long-running server
  ends up with current code and stale env. Symptom: an error naming a role or
  database that `.env` no longer mentions.
- **Node's `--env-file` does not override already-exported shell variables.** If
  `echo $DATABASE_URL` prints something, that wins over `.env`. `unset` it.
- **A stale server can hold port 3003.** The replacement dies with `EADDRINUSE`,
  which scrolls past easily. `lsof -i :3003`, then `pkill -f "src/index.ts"`.
- **`pg` returns `bigint` columns as strings**, not numbers. `id` comes back as
  `"1"`. Convert before sending JSON if a number is wanted.
- **`pg` does not camelCase column names.** A row is `{ created_at, user_id }`,
  not `{ createdAt, userId }`. Alias in SQL (`created_at AS "createdAt"`) or map
  in code.

## Current state

All small fixes and rate limiting are **done**; `smoke.sh` passes clean.
Postgres runs via Homebrew; tables exist. Authorization is next.

Settled during the small fixes, so don't relitigate:

- Every handler is a single query. `INSERT INTO tasks (...) SELECT $1, $2` does
  infer `bigint`/`text` from the target columns — no explicit casts needed.
- `parseId` wraps a zod schema but still returns `number | null`; the ZodError is
  deliberately discarded, because "the id is bad" is enough detail. Body
  validation stays hand-rolled — one required string per endpoint doesn't justify
  zod. Both revisit at pagination.
- `try`/`catch` in handlers was **decided against.** Expected problems are
  answered inline, everything left is a real fault that should reach the
  middleware, and a `catch` that only calls `next(err)` is noise that risks
  mapping a server fault to a 4xx.
- `Task` / `User` / `JoinedTaskRow` exist and are passed to `pool.query<T>()`.
  Note this is an *unchecked assertion*, not validation — `schema.sql` stays the
  source of truth, and adding a column silently makes `Task` wrong.
- Trimming validated strings before insert was **declined** for now. `"  adi  "`
  is stored with its spaces. Will matter if `username` ever gets a `UNIQUE`
  constraint or a lookup by name.

Remaining known-but-accepted: no ownership check on PATCH; no catch-all route, so
an unmatched URL still returns Express's HTML 404; nothing closes the pool on
shutdown; `username` is not unique; no 429 test in `smoke.sh` (would need 100+
requests).

## Next steps (Adi's plan, in order)

1. **Authorization** — next. This is what makes the PATCH ownership gap real.
2. **Task labeling** — `tags` + `task_tags` many-to-many, so the GET queries need
   `JOIN`s. Tags are open-ended labels ("work", "urgent"), not a status; `done`
   stays a column because it is exactly one value per row. Expect to meet
   `LEFT JOIN` vs `INNER JOIN` here (inner silently drops users with zero tasks)
   and a composite primary key on `task_tags`.
3. **Pagination** — `?limit=&offset=` on the list endpoints. Teaches optional
   untrusted query params and building a `WHERE`/`LIMIT` clause conditionally
   without concatenating user input. Also where a **zod** object schema finally
   earns its keep — optional numeric query params with defaults and bounds are
   where hand-rolled validation gets ugly, and where the current two-style split
   (zod for ids, `typeof` checks for bodies) should be resolved.

Adi wants to grow SQL (joins, aggregation) and HTTP knowledge in parallel, so
prefer explanations that connect the two.

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
- Using `EXISTS` in a handler that needs the row itself. `EXISTS` is for guard
  queries only; if you want the data, `SELECT` it and check `rows[0]`.
- Reading `rows[0].exists` when the `EXISTS` was in the `WHERE` clause, not the
  select list. A `WHERE` can only *remove* rows — it produces no column, so
  `.exists` is `undefined`, `!undefined` is `true`, and a user **with** tasks got
  a 404. Related: `WHERE` being subtractive is exactly why a query whose `FROM`
  is only `tasks` can never distinguish "no such user" from "user with zero
  tasks". The driving table has to be `users`.
- `rows[0] === null` to detect a `LEFT JOIN` miss. `pg` never puts `null` in the
  `rows` array — the row object always exists and its *columns* are null. Test a
  `NOT NULL` column instead: `rows[0].id === null`. Both of these were the same
  mistake — checking one level away from the thing holding the answer.
- Copying a generic snippet and renaming the tables in `SELECT`/`FROM` but not in
  `WHERE`. Left a `WHERE c.id = $1` with no `c` in the query, which 500s every
  request. SQL in a template literal is just a string: neither `tsx` nor
  `npm run typecheck` can see it. Only running it finds this class of bug.
- `DELETE * FROM` is not SQL; `DELETE` takes no column list. (`INSER INTO` too.)
- Reusing `parseId` on a non-id (a username) — it returns `null` for any
  non-numeric string, so the value silently became NULL.
- Calling a helper that sends a response does **not** exit the handler — needs an
  explicit `return`, or Express throws ERR_HTTP_HEADERS_SENT. Same trap in the
  error middleware: a branch without `return` falls through to the 500.
- Forgetting to import `Request`/`Response`/`NextFunction` from express. These
  do **not** error — Node's global fetch `Request`/`Response` types silently take
  over. Only `NextFunction` fails loudly.
- Validating `x.trim()` but inserting the untrimmed `x`.

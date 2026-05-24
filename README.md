# Allo Inventory Reservations

Next.js App Router take-home for reserving inventory during checkout across multiple warehouses.

The core invariant is that reservations are race-condition safe: reserving stock uses one PostgreSQL conditional update inside a transaction:

```sql
UPDATE "StockLevel"
SET "reservedUnits" = "reservedUnits" + $3
WHERE "productId" = $1
  AND "warehouseId" = $2
  AND ("totalUnits" - "reservedUnits") >= $3
RETURNING "id";
```

If two requests race for the last unit, PostgreSQL can only update the row for one request. The other receives `409 INSUFFICIENT_STOCK`.

## Stack

- Next.js App Router
- TypeScript
- Prisma
- Hosted PostgreSQL, such as Supabase or Neon
- Tailwind CSS
- Zod
- Vitest

## Local Setup

Create a hosted Postgres database first. Supabase, Neon, and Railway all work.

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Set `DATABASE_URL` in `.env` before running the Prisma commands.
For Supabase + Prisma, also set `DIRECT_URL`; Prisma uses it for migrations while the app uses the pooled `DATABASE_URL`.
Set `CRON_SECRET` in production if you deploy the Vercel Cron endpoint.

The app runs at [http://localhost:3000](http://localhost:3000).

## API

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/api/products` | Lists products with stock by warehouse. Also lazily releases expired reservations. |
| `GET` | `/api/warehouses` | Lists warehouses. |
| `POST` | `/api/reservations` | Reserves units for a product and warehouse. Returns `409` when stock is unavailable. |
| `GET` | `/api/reservations/:id` | Returns reservation details for the checkout panel. |
| `POST` | `/api/reservations/:id/confirm` | Confirms payment. Returns `410` if the reservation expired. |
| `POST` | `/api/reservations/:id/release` | Releases a pending reservation early. |
| `GET` | `/api/cron/release-expired` | Vercel Cron endpoint that releases expired pending reservations. Requires `Authorization: Bearer $CRON_SECRET`. |

`POST /api/reservations` and `POST /api/reservations/:id/confirm` support an optional
`Idempotency-Key` header. Reusing the same key with the same request body replays the
original JSON response. Reusing the same key with a different request body returns
`409 IDEMPOTENCY_KEY_REUSED`.

## Expiry Approach

This implementation uses a Vercel Cron endpoint plus lazy cleanup:

- `vercel.json` schedules `/api/cron/release-expired` once per minute.
- The cron endpoint requires `Authorization: Bearer $CRON_SECRET`.
- Product and reservation reads call `cleanupExpired`.
- Confirming an expired pending reservation releases it in the same transaction and returns `410`.
- Released reservations decrement `reservedUnits`, making the units available again.

The confirm path still needs the expiry check because cron can be delayed.

## Tradeoffs

- Idempotency is implemented for reserve and confirm retries. Simultaneous in-flight requests with the same key are rejected with `409 IDEMPOTENCY_REQUEST_IN_PROGRESS`; a production version could block briefly and replay once the first request finishes.
- The UI is intentionally operational rather than decorative: product stock, reservation state, visible `409` and `410` errors, and no manual refresh after mutations.
- The test suite focuses on reservation behavior, idempotency replay, and the atomic SQL guard. With more time, I would add PostgreSQL integration tests that fire concurrent HTTP requests against a real test database.

## Verification

```bash
npm test
npm run lint
npm run build
```

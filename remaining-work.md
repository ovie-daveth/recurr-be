# Recurr Remaining Work Plan

This file tracks what is left after the current Recurr backend implementation.

Current state:

- Merchant auth, businesses, API keys, plans, customers, payment methods, subscriptions, invoices, payment attempts, portal sessions, Nomba webhooks, merchant webhook endpoints, idempotency, and Swagger are already in place.
- The subscription core can be tested with simulated Nomba webhooks.
- The main remaining work is production hardening: observability, merchant-configurable dunning policy, richer portal actions, and cleanup jobs.

---

## 1. Finish Current Subscription Verification

Goal:

Prove the current subscription flow reaches the correct final states.

Checklist:

- Create a customer.
- Create payment method setup checkout.
- Simulate Nomba card token webhook.
- Confirm payment method becomes:

```txt
status = ACTIVE
reusable = true
providerPaymentMethodReference = card token
providerCustomerReference = Nomba customer id
```

- Create subscription using the active payment method.
- Simulate payment success for the created `PaymentAttempt.providerReference`.
- Confirm:

```txt
PaymentAttempt -> SUCCEEDED
Invoice -> PAID
Subscription -> ACTIVE
Subscription.nextBillingAt -> currentPeriodEnd
```

Important:

- Use the same mode everywhere: `TEST` with `TEST`, `LIVE` with `LIVE`.
- For payment-method setup simulation, use `orderReference`.
- For recurring charge simulation, use `merchantTxRef`.

---

## 2. Real Billing Worker

Current state:

- Manual billing trigger exists.
- Billing logic exists in `src/modules/billing/billing.service.ts`.
- BullMQ/Redis worker entrypoint exists:

```txt
src/jobs/worker.ts
```

- The worker schedules due billing and due dunning scans.
- A separate process should run:

```txt
npm run worker
```

or on Railway:

```txt
npm run railway:worker
```

Implemented:

- PostgreSQL advisory locks guard billing, dunning retry, and merchant webhook retry claims.
- Webhook delivery retry worker is wired into the BullMQ worker process.

Needed:

- Add production observability/alerts.

Implementation path:

1. Redis/BullMQ dependencies are installed:

```txt
bullmq
ioredis
```

2. Worker files:

```txt
src/lib/redis.ts
src/jobs/queues.ts
src/jobs/billing.worker.ts
src/jobs/scheduler.ts
```

Current implementation combines billing and dunning workers in:

```txt
src/jobs/worker.ts
```

3. Worker should call:

```ts
runDueBilling({ limit, mode })
```

4. Separate production worker start command:

```json
"worker": "node dist/jobs/worker.js"
```

5. Deployment:

- API service runs Express.
- Worker service runs BullMQ workers.
- Both connect to same database and Redis.

Production safety still needed:

- Clear handling for partial provider failures.

---

## 3. Row Locking / Concurrent Billing Safety

Problem:

Two worker instances could try to bill the same due subscription at the same time.

Implemented:

- Billing workers acquire a PostgreSQL transaction advisory lock using the subscription id before creating the renewal invoice.
- The billing transaction re-checks subscription status, due date, current period, cancellation state, and existing period invoices before it creates the invoice/payment attempt.
- Dunning workers acquire a PostgreSQL transaction advisory lock using the dunning attempt id before creating a retry payment attempt.
- Merchant webhook retry workers acquire a PostgreSQL transaction advisory lock using the delivery id before retrying a failed delivery.

Possible approaches:

### Option A: PostgreSQL advisory locks

Use a lock key derived from subscription id before billing.

Example idea:

```txt
pg_try_advisory_xact_lock(hash(subscriptionId))
```

### Option B: Raw SQL with SKIP LOCKED

Use:

```sql
SELECT *
FROM "Subscription"
WHERE "nextBillingAt" <= now()
AND "status" IN ('ACTIVE', 'TRIALING')
FOR UPDATE SKIP LOCKED
```

Prisma does not expose `FOR UPDATE SKIP LOCKED` cleanly, so this likely needs `$queryRaw` inside a transaction.

Current approach:

Use advisory locks first because they are simpler to introduce without rewriting the Prisma query flow.

---

## 4. Dunning Retry Execution

Current state:

- `DunningAttempt` model exists.
- `scheduleNextDunningAttempt` exists.
- Failed payment can create scheduled dunning attempts.
- Due dunning retries can now be processed manually through:

```txt
POST /api/v1/dev/dunning/run-due
```

- The reusable service is:

```txt
runDueDunning
```

- A real BullMQ/Redis worker is still needed.

Implemented:

- BullMQ worker calls `runDueDunning`.
- Scheduler queues due dunning scans.
- Advisory locks protect concurrent retry execution.

Needed:

- Add final-action subscription handling after retries are exhausted.

Flow:

```txt
Payment fails
  -> Invoice PAYMENT_FAILED
  -> Subscription PAST_DUE
  -> DunningAttempt SCHEDULED
  -> Dunning worker reaches scheduledAt
  -> create new PaymentAttempt
  -> charge tokenized card
  -> success: invoice PAID, subscription ACTIVE, dunning SUCCEEDED
  -> failure: dunning FAILED, schedule next retry
  -> exhausted: cancel or pause subscription
```

Implementation files:

```txt
src/modules/dunning/dunning.service.ts
src/jobs/dunning.worker.ts
```

Suggested endpoint for manual testing:

```txt
POST /api/v1/dev/dunning/run-due
```

---

## 5. Merchant Webhook Retry Worker

Current state:

- Merchant webhook endpoints can be created.
- Events are delivered immediately.
- Delivery records are stored.
- Failed deliveries are marked `RETRYING` when retry attempts remain.
- Retry timing is configurable with:

```txt
WEBHOOK_RETRY_DELAYS_MINUTES=1,5,30,120,720
```

- The BullMQ worker processes due retrying deliveries through:

```txt
runDueWebhookDeliveries
```

Needed:

- Add observability/alerts for permanently failed webhook deliveries.

Current retry schedule:

```txt
1 minute
5 minutes
30 minutes
2 hours
12 hours
```

- Mark delivery as:

```txt
DELIVERED
FAILED
RETRYING
```

Implementation notes:

1. When a delivery fails, set:

```txt
status = RETRYING
nextAttemptAt = now + retryDelay
```

2. Worker finds due deliveries:

```txt
status = RETRYING
nextAttemptAt <= now
```

3. Re-send the same payload with a new timestamp/signature.
4. Stop retrying after max attempts and leave delivery as `FAILED`.

Files:

```txt
src/modules/webhook-endpoints/merchant-webhooks.service.ts
src/jobs/webhook.worker.ts
```

---

## 6. Proration And Change Plan

Current state:

- Implemented for MVP.

Endpoint:

```txt
POST /api/v1/subscriptions/:id/change-plan
```

Request:

```json
{
  "newPlanId": "plan_new",
  "effective": "IMMEDIATE",
  "prorationBehavior": "CREATE_PRORATION"
}
```

Supported behavior:

```txt
CREATE_PRORATION
NONE
```

Proration formula:

```txt
unused_old_plan_value = old_price * unused_seconds / total_period_seconds
new_plan_partial_cost = new_price * remaining_seconds / total_period_seconds
proration_amount = new_plan_partial_cost - unused_old_plan_value
```

Implementation rules:

- Never use floats for stored money.
- Compute in integer minor units.
- Upgrade with positive proration creates an immediate invoice/payment attempt.
- Downgrade is scheduled for `currentPeriodEnd` and applied by the billing worker at renewal.
- Preserve invoice item snapshots.

Implementation files:

```txt
src/modules/subscriptions/subscriptions.routes.ts
src/modules/subscriptions/subscriptions.schema.ts
src/modules/billing/billing.service.ts
prisma/schema.prisma
```

---

## 7. Dunning Policy APIs

Current state:

- Retry delays are environment/config based.
- No merchant-configurable dunning policy.

Needed models:

```txt
DunningPolicy
DunningPolicyStep
```

Needed endpoints:

```txt
POST /api/v1/dunning-policies
GET /api/v1/dunning-policies
GET /api/v1/dunning-policies/:id
PATCH /api/v1/dunning-policies/:id
```

Example:

```json
{
  "name": "Default Recovery Policy",
  "retries": [
    { "delayMinutes": 60, "channel": "email" },
    { "delayMinutes": 1440, "channel": "email" },
    { "delayMinutes": 4320, "channel": "email" },
    { "delayMinutes": 10080, "channel": "email" }
  ],
  "finalAction": "CANCEL_SUBSCRIPTION"
}
```

Recommended timing:

Implement after the dunning retry worker works with the current default policy.

---

## 8. Customer Portal Actions

Current state:

- Portal session can be created.
- Portal token can return customer billing context.
- Actual self-service actions are not complete.

Needed portal actions:

- Retry failed invoice.
- Create payment method setup checkout from portal.
- Revoke payment method.
- Cancel subscription.
- Change plan.

Possible endpoints:

```txt
POST /api/v1/portal/sessions/:token/invoices/:invoiceId/pay
POST /api/v1/portal/sessions/:token/payment-methods/setup-checkout
DELETE /api/v1/portal/sessions/:token/payment-methods/:paymentMethodId
POST /api/v1/portal/sessions/:token/subscriptions/:subscriptionId/cancel
POST /api/v1/portal/sessions/:token/subscriptions/:subscriptionId/change-plan
```

Security rules:

- Token must be valid, unexpired, and not revoked.
- Every resource must match the portal session customer, business, and mode.
- Do not expose merchant-only metadata unnecessarily.

---

## 9. Production Nomba Strictness

Current state:

- Nomba client exists.
- Checkout and tokenized-card charge integration exists.
- Webhook signature verification supports current Nomba canonical signature format.
- Some webhook extraction is flexible because real token field names may vary.

Needed:

- Confirm real Nomba webhook fields for:

```txt
cardId
customerId
orderReference
merchantTxRef
transactionId
responseCode
```

- Make webhook processor strict once confirmed.
- Improve provider error mapping so merchants see safe but useful failure codes.
- Add transaction verification for all production payment success paths.

---

## 10. Observability And Admin Debugging

Needed:

- Better logs around billing worker runs.
- Metrics/counts for:

```txt
due subscriptions found
invoices generated
charges succeeded
charges failed
dunning retries scheduled
webhook deliveries failed
```

- Admin/debug endpoint or dashboard later for:

```txt
Nomba request failures
Webhook failures
Stuck PAYMENT_PROCESSING invoices
Stuck INCOMPLETE subscriptions
```

Useful cleanup jobs:

- Mark stale `PAYMENT_PROCESSING` invoices as failed after timeout.
- Mark stale `INCOMPLETE` subscriptions as cancelled after timeout.
- Expire old portal sessions.

---

## 11. Demo Seed Data

Current state:

- Demo seed script exists:

```txt
src/scripts/seed-demo.ts
```

Commands:

```json
"seed:demo": "node dist/scripts/seed-demo.js"
"seed:demo:dev": "ts-node-dev --transpile-only --exit-child src/scripts/seed-demo.ts"
```

It seeds:

- Merchant.
- Business.
- TEST API key.
- Plan.
- Customer.
- Optional webhook endpoint using `DEMO_WEBHOOK_URL`.

Demo flow should show:

1. Merchant creates plan.
2. Merchant creates customer.
3. Customer adds card through Nomba checkout.
4. Recurr stores tokenized payment method.
5. Merchant creates subscription.
6. Recurr creates invoice and payment attempt.
7. Payment succeeds.
8. Subscription becomes active.
9. Merchant webhook receives event.
10. Failed payment creates dunning.
11. Retry recovers payment.

---

## Recommended Next Build Order

1. Finish current recurring-payment simulation verification.
2. Implement dunning retry execution.
3. Implement merchant webhook retry worker.
4. Add BullMQ/Redis worker infrastructure.
5. Add row locking/advisory locks.
6. Add demo seed script.
7. Add proration/change-plan.
8. Add portal actions.
9. Add dunning policy APIs.
10. Add observability and cleanup jobs.

Completed through item 7.

Demo helper completed:

```txt
POST /api/v1/dev/billing/subscriptions/:id/fast-forward
```

Use it to set `nextBillingAt` to now/past so the billing worker can demonstrate renewal without waiting for real billing time.

---

## Current Biggest Risk

The biggest remaining risk is not the API surface.

The biggest risk is reliable automation:

```txt
billing workers
dunning retries
webhook delivery retries
concurrency safety
provider failure recovery
```

Those are the pieces that make Recurr feel like a real billing engine rather than a set of billing CRUD APIs.

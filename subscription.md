# Recurr Subscription Core Plan

This plan aligns `flow.md` with the current backend model:

```txt
MerchantUser -> Business -> ApiKey
```

Where `flow.md` says `tenant`, this codebase now uses `Business` as the billing workspace. Every merchant API resource must be scoped by:

```txt
businessId + mode + resourceId
```

`mode` is `TEST` or `LIVE`, resolved from the API key.

---

## 1. Goals

The subscription core should let a merchant:

1. Create a customer.
2. Set up a tokenized payment method through Nomba.
3. Create a subscription for a customer and plan.
4. Generate invoices and payment attempts.
5. Move subscriptions through a strict state machine.
6. Process Nomba webhooks safely.
7. Prepare for billing workers, dunning, proration, and merchant webhooks.

---

## 2. Core Models

Add these Prisma models first:

- `PaymentMethod`
- `Subscription`
- `Invoice`
- `InvoiceItem`
- `PaymentAttempt`

### Subscription Status

Use the statuses from `flow.md`:

```txt
INCOMPLETE
TRIALING
ACTIVE
PAST_DUE
PAUSED
CANCELLED
EXPIRED
```

### Invoice Status

```txt
DRAFT
OPEN
PAYMENT_PROCESSING
PAID
PAYMENT_FAILED
VOID
UNCOLLECTIBLE
```

### Payment Attempt Status

```txt
PENDING
PROCESSING
SUCCEEDED
FAILED
REQUIRES_ACTION
ABANDONED
```

---

## 3. Payment Method Setup

Recurr must never collect raw card details.

Flow:

```txt
Merchant creates customer
Merchant requests payment setup checkout
Recurr creates Nomba checkout order
Customer completes Nomba checkout
Nomba sends webhook to Recurr
Recurr stores tokenized payment method reference
```

Endpoint:

```txt
POST /api/v1/customers/:customerId/payment-methods/setup-checkout
```

Rules:

- Customer must belong to the API key business.
- Customer mode must match API key mode.
- Disabled customers cannot create setup checkout sessions.
- Store provider reference for webhook matching.

---

## 4. Subscription Creation

Endpoint:

```txt
POST /api/v1/subscriptions
```

Payload:

```json
{
  "customerId": "cus_xxx",
  "planId": "plan_xxx",
  "paymentMethodId": "pm_xxx",
  "trialDays": 14,
  "metadata": {
    "source": "api"
  }
}
```

Rules:

- Customer, plan, and payment method must belong to the same `businessId`.
- Customer, plan, and payment method must match the API key mode.
- Plan must be `ACTIVE`.
- Customer must be `ACTIVE`.
- Payment method must be active/usable.
- Use `Idempotency-Key`.
- Do not create duplicate active subscriptions for the same customer and plan unless explicitly supported later.

If trial exists:

```txt
status = TRIALING
currentPeriodStart = now
currentPeriodEnd = now + trialDays
nextBillingAt = trial end
```

If no trial:

```txt
status = INCOMPLETE
create first invoice
create payment attempt
attempt payment
if paid -> ACTIVE
if failed -> PAST_DUE or INCOMPLETE
```

---

## 5. Subscription State Machine

Create:

```txt
src/modules/subscriptions/subscriptions.state.ts
```

Allowed transitions:

```txt
INCOMPLETE -> ACTIVE
INCOMPLETE -> CANCELLED

TRIALING -> ACTIVE
TRIALING -> PAST_DUE
TRIALING -> CANCELLED

ACTIVE -> PAST_DUE
ACTIVE -> PAUSED
ACTIVE -> CANCELLED

PAST_DUE -> ACTIVE
PAST_DUE -> CANCELLED
PAST_DUE -> PAUSED

PAUSED -> ACTIVE
PAUSED -> CANCELLED
```

Rule:

```txt
Never mutate subscription status directly in route handlers.
```

All status changes must pass through the state machine.

---

## 6. Subscription Endpoints

Implement:

```txt
POST /api/v1/subscriptions
GET /api/v1/subscriptions
GET /api/v1/subscriptions/:id
POST /api/v1/subscriptions/:id/pause
POST /api/v1/subscriptions/:id/resume
POST /api/v1/subscriptions/:id/cancel
```

List endpoint should support:

```txt
limit
cursor
status
createdFrom
createdTo
```

All endpoints must be scoped by:

```txt
businessId + mode
```

---

## 7. Invoice Generation

Invoices represent what should be charged.

Create invoice:

- on subscription creation when there is no trial
- on billing renewal date
- on retry/manual pay
- later, on proration

Invoice items should snapshot plan data:

```txt
planId
description
amountMinor
currency
periodStart
periodEnd
metadata
```

Do not rely only on current plan values after invoice creation, because plans can change later.

---

## 8. Payment Attempts

Payment attempts track actual charge attempts against an invoice.

Store:

```txt
businessId
mode
subscriptionId
invoiceId
customerId
paymentMethodId
amountMinor
currency
status
provider
providerReference
failureReason
attemptNumber
requestedAt
processedAt
```

Rules:

- Never double-charge the same invoice attempt.
- Payment attempts must be idempotent.
- External calls should be made through a provider abstraction.

---

## 9. Nomba Provider Abstraction

Do not call Nomba directly from controllers.

Create:

```txt
src/modules/payments/payment.provider.ts
src/modules/nomba/nomba.client.ts
src/modules/nomba/nomba.service.ts
```

Interface shape:

```ts
export interface PaymentProvider {
  createCheckoutOrder(input: CreateCheckoutInput): Promise<CheckoutResult>;
  chargeTokenizedCard(input: ChargeTokenizedCardInput): Promise<ChargeResult>;
  getTransaction(reference: string): Promise<TransactionResult>;
}
```

Then implement:

```txt
NombaPaymentProvider
```

### Confirmed Nomba Contract

Nomba uses OAuth 2.0 `client_credentials` for server-to-server API calls.

Token endpoint:

```txt
POST /auth/token/issue
```

Token request body:

```json
{
  "grant_type": "client_credentials",
  "client_id": "NOMBA_CLIENT_ID",
  "client_secret": "NOMBA_CLIENT_SECRET"
}
```

Token request headers:

```txt
Content-Type: application/json
accountId: NOMBA_ACCOUNT_ID
```

Every authenticated Nomba API call must include:

```txt
Authorization: Bearer <access_token>
accountId: NOMBA_ACCOUNT_ID
Content-Type: application/json
```

Tokens last 60 minutes. Recurr should cache the access token in memory first,
then refresh/re-issue around the 55-minute mark. Do not request a new token for
every job or request.

Checkout:

```txt
POST /v1/checkout/order
```

Sandbox checkout uses a different path:

```txt
POST /sandbox/checkout/order
```

Checkout request body:

```json
{
  "order": {
    "orderReference": "ord_demo_001",
    "amount": 250000,
    "currency": "NGN",
    "callbackUrl": "https://merchant.app/payment/return",
    "customerId": "cus_8821",
    "customerEmail": "ada@example.com"
  }
}
```

Nomba returns:

```txt
data.checkoutUrl
data.checkoutLink
orderReference
```

Amounts are in kobo. The existing `amountMinor` field maps directly to Nomba's
`amount` field.

Tokenized card charge:

```txt
POST /tokenized-card/charge
```

Charge payload:

```json
{
  "amount": 500000,
  "currency": "NGN",
  "cardId": "tok_5fa12b...",
  "customerId": "cus_8821",
  "merchantTxRef": "recur_attempt_<paymentAttemptId>"
}
```

Rules:

- `merchantTxRef` must be unique per payment attempt.
- Retrying the same payment attempt must reuse the same `merchantTxRef`.
- A new retry attempt must create a new `PaymentAttempt` and a new `merchantTxRef`.
- Store the Nomba card token in `PaymentMethod.providerPaymentMethodReference`.
- Store the Nomba customer reference in `PaymentMethod.providerCustomerReference`.
- Never store raw card data.
- Verify successful transactions before marking invoices paid.

### Nomba Sub-accounts

Sub-accounts are useful later if Recurr needs separate Nomba balances or
settlement tracking per merchant business, seller, branch, or project.

Possible mapping:

```txt
Recurr Business -> Nomba Sub-account
```

Use a stable Nomba `accountRef` such as:

```txt
recurr_business_<businessId>
```

Keep Nomba IDs as foreign references, not primary identifiers. This is not
required for the first subscription core because the parent Nomba account can
process checkout and tokenized-card charges first.

---

## 10. Nomba Webhook Processing

Current webhook foundation already:

- verifies `nomba-signature`
- stores raw webhook body
- uses `requestId` idempotency
- tags events by `TEST` or `LIVE`

Confirmed Nomba payment webhook shape:

```json
{
  "event_type": "payment_success",
  "requestId": "req_3f9a2c",
  "data": {
    "transaction": {
      "merchantTxRef": "txref-1743379200",
      "transactionAmount": 4000.0
    },
    "order": {
      "amount": 4000.0,
      "orderReference": "test-order-001",
      "currency": "NGN"
    }
  }
}
```

Rules now known:

- `payload.event` or `payload.event_type` is the event type.
- `payload.requestId` is the provider event id for webhook idempotency.
- `payload.data.transaction.merchantTxRef` maps to `PaymentAttempt.providerReference`.
- `payload.data.order.amount` is major-unit NGN in sandbox checkout webhooks and must be converted to kobo before comparing with `PaymentAttempt.amountMinor`.
- `payload.data.order.currency` must equal `PaymentAttempt.currency`.
- Do not mark an invoice paid if amount or currency does not match.

Sandbox transaction verification:

```txt
GET /sandbox/checkout/transaction?idType=orderReference&id=<orderReference>
```

Production checkout transaction verification:

```txt
GET /v1/checkout/transaction?idType=orderReference&id=<orderReference>
```

Subscription core must add processing:

1. Match webhook to checkout/payment reference.
2. Update payment method after setup checkout success.
3. Update payment attempt after charge success/failure.
4. Update invoice status.
5. Update subscription state through the state machine.
6. Emit audit logs.
7. Later, emit merchant webhooks.

Rule:

```txt
Store webhook first. Process after storage.
```

---

## 11. Billing Worker

Worker job:

```txt
generate_due_invoices
```

Process:

1. Find subscriptions where `nextBillingAt <= now`.
2. Only include statuses:

```txt
ACTIVE
TRIALING
```

3. Lock rows to avoid double billing.
4. Generate invoice.
5. Create payment attempt.
6. Charge saved payment method.
7. Advance billing period only after successful payment.
8. If payment fails, move subscription to `PAST_DUE` and schedule dunning.

Workers must be idempotent because jobs can retry.

---

## 12. Dunning Later

When payment fails:

```txt
invoice -> PAYMENT_FAILED
subscription -> PAST_DUE
create dunning attempt
schedule retry job
emit invoice.payment_failed webhook later
```

Default retry policy:

```txt
1 hour
24 hours
3 days
7 days
final action: cancel or pause
```

---

## 13. Implementation Order

### Phase 1: Models

1. Add enums.
2. Add `PaymentMethod`.
3. Add `Subscription`.
4. Add `Invoice`.
5. Add `InvoiceItem`.
6. Add `PaymentAttempt`.
7. Run migration and generate Prisma client.

### Phase 2: State and Dates

1. Add subscription state machine.
2. Add billing-period date helper.
3. Add invoice amount snapshot helper.

### Phase 3: Payment Method Setup

1. Add setup checkout endpoint. Done.
2. Add provider abstraction. Done.
3. Add Nomba OAuth client with token caching.
4. Wire `POST /v1/checkout/order`.
5. Wire webhook processor to store Nomba card token and customer reference.

### Phase 4: Subscription API

1. Create subscription. Done.
2. List subscriptions. Done.
3. Get subscription. Done.
4. Pause. Done.
5. Resume. Done.
6. Cancel. Done.

### Phase 5: Invoice and Payment Attempt

1. Generate first invoice. Done.
2. Create payment attempt. Done.
3. Generate stable `merchantTxRef` from `PaymentAttempt.id`.
4. Wire `POST /tokenized-card/charge`.
5. Update payment attempt and invoice state from charge result.
6. Verify transactions before marking invoice paid.
7. Wire Nomba success/failure webhook handling.

### Phase 6: Worker

1. Add billing worker skeleton. Done.
2. Add manual dev trigger if useful. Done.
3. Add real BullMQ scheduling after the core flow works.

Manual development trigger:

```txt
POST /api/v1/dev/billing/run-due
```

Payload:

```json
{
  "limit": 20,
  "mode": "TEST",
  "subscriptionId": "optional-subscription-id",
  "skipTransactionVerification": true
}
```

Current worker behavior:

1. Finds subscriptions where `status IN (ACTIVE, TRIALING)` and `nextBillingAt <= now`.
2. Skips inactive customers, inactive plans, and unusable payment methods.
3. Creates a renewal invoice and invoice item for the next billing period.
4. Creates a `PaymentAttempt`.
5. Uses `recur_attempt_<paymentAttemptId>` as the Nomba `merchantTxRef`.
6. Calls `POST /tokenized-card/charge` through the provider abstraction.
7. If charge succeeds, marks the invoice paid and advances subscription period dates.
8. If charge fails, marks the invoice/payment attempt failed and moves subscription to `PAST_DUE`.
9. Avoids creating a duplicate invoice for the same subscription period.

Still needed before production scheduling:

- Real queue/cron runner.
- Row locking or advisory locks for concurrent worker safety.
- Retry/dunning schedule.
- Alerting/metrics for failed billing runs.

---

## 14. Safety Rules

- No floats for money.
- No raw card storage.
- No cross-business access.
- No cross-mode access.
- No direct subscription status mutation.
- No hard delete of subscriptions, invoices, or payment attempts.
- All important writes should be transactional.
- All webhook processing should be idempotent.
- Provider calls must be wrapped behind an abstraction.

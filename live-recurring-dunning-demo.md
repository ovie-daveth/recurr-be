# Live Recurring + Dunning Demo Runbook

Use this guide to demo Recurr's live recurring billing and dunning flow with Railway, Redis, BullMQ, and the current Nomba test/simulation setup.

---

## 1. Confirm Railway Services

You need two Railway services from the same backend repo:

```txt
recurr-api       npm run railway:start
recurr-worker    npm run railway:worker
```

The API service handles:

- Swagger
- merchant APIs
- Nomba webhooks
- portal APIs

The worker service handles:

- due billing
- due dunning retries

The worker logs should show:

```txt
Recurr worker started
Billing job ... completed
Dunning job ... completed
```

---

## 2. Required Railway Variables

Both API and Worker need:

```env
DATABASE_URL=...
REDIS_URL=...
NODE_ENV=production
```

Worker test settings:

```env
WORKER_DEFAULT_MODE=TEST
WORKER_BILLING_INTERVAL_MS=60000
WORKER_DUNNING_INTERVAL_MS=60000
WORKER_RUN_LIMIT=50
WORKER_SKIP_TRANSACTION_VERIFICATION=true
DUNNING_RETRY_DELAYS_MINUTES=1,2,3
```

Restart both API and Worker after changing variables.

---

## 3. Auth Setup

Use Swagger:

```txt
https://recurr-be-production.up.railway.app/api/docs
```

You need two authorizations:

### Merchant Session

Use this for dashboard/admin endpoints:

```txt
merchantSession = Bearer <merchant access token>
```

Used for:

- dev webhook simulator
- business/webhook endpoint management

### Business API Key

Use this for merchant integration APIs:

```txt
businessApiKey = Bearer sk_test_...
```

Used for:

- plans
- customers
- payment methods
- subscriptions
- invoices

For this demo, use a `TEST` API key so every resource is created in `TEST` mode.

Optional shortcut:

Run the demo seed script to create a merchant, business, TEST API key, plan, and customer:

```bash
npm run build
npm run seed:demo
```

Local TypeScript version:

```bash
npm run seed:demo:dev
```

The script prints:

```txt
merchant email/password
business id
TEST API key secret, if newly created
plan id
customer id
optional webhook endpoint id
```

---

## 4. Create A Plan

Endpoint:

```http
POST /api/v1/plans
```

Body:

```json
{
  "name": "Pro Monthly",
  "code": "pro_monthly_demo",
  "amountMinor": 500000,
  "currency": "NGN",
  "interval": "MONTH",
  "intervalCount": 1,
  "trialDays": 0,
  "metadata": {
    "source": "demo"
  }
}
```

Copy:

```txt
plan.id
```

---

## 5. Create A Customer

Endpoint:

```http
POST /api/v1/customers
```

Body:

```json
{
  "email": "demo-customer@example.com",
  "name": "Demo Customer",
  "phone": "08000000000",
  "externalReference": "demo-customer-001",
  "metadata": {
    "source": "demo"
  }
}
```

Copy:

```txt
customer.id
```

---

## 6. Create Payment Method Setup Checkout

Endpoint:

```http
POST /api/v1/customers/{customerId}/payment-methods/setup-checkout
```

Body:

```json
{
  "callbackUrl": "https://merchant.app/billing/callback",
  "metadata": {
    "source": "demo"
  }
}
```

Copy:

```txt
paymentMethod.id
paymentMethod.providerSetupReference
checkout.checkoutUrl
```

At this point, the payment method should be:

```txt
status = PENDING_SETUP
reusable = false
```

---

## 7. Simulate Nomba Card Tokenization

Because Nomba sandbox/live webhooks may be unreliable during demo, use Recurr's simulator to mimic the Nomba successful card setup webhook.

Endpoint:

```http
POST /api/v1/dev/webhooks/nomba/simulate
```

Authorization:

```txt
merchantSession
```

Body:

```json
{
  "orderReference": "PASTE_PROVIDER_SETUP_REFERENCE",
  "amountMinor": 100,
  "currency": "NGN",
  "eventType": "payment_success",
  "cardId": "tok_test_demo_001",
  "nombaCustomerId": "cus_demo_001",
  "cardBrand": "Mastercard",
  "cardLast4": "6666",
  "mode": "TEST",
  "skipTransactionVerification": true
}
```

Verify:

```http
GET /api/v1/customers/{customerId}/payment-methods
```

Expected:

```txt
status = ACTIVE
type = CARD
reusable = true
providerPaymentMethodReference = tok_test_demo_001
providerCustomerReference = cus_demo_001
```

Copy:

```txt
active paymentMethod.id
```

---

## 8. Create Subscription

Endpoint:

```http
POST /api/v1/subscriptions
```

Body:

```json
{
  "customerId": "CUSTOMER_ID",
  "planId": "PLAN_ID",
  "paymentMethodId": "ACTIVE_PAYMENT_METHOD_ID",
  "metadata": {
    "source": "demo"
  }
}
```

Expected:

- subscription created
- first invoice created
- first payment attempt created

Because the card token is simulated, Nomba charge may fail. That is useful for the dunning demo.

Copy:

```txt
subscription.id
invoice.id
paymentAttempt.id
paymentAttempt.providerReference
```

---

## 9. Force Initial Payment Failure If Needed

If the invoice stays in `PAYMENT_PROCESSING`, simulate a Nomba failed payment event for the payment attempt.

Endpoint:

```http
POST /api/v1/dev/webhooks/nomba/simulate
```

Authorization:

```txt
merchantSession
```

Body:

```json
{
  "merchantTxRef": "recur_attempt_PAYMENT_ATTEMPT_ID",
  "amountMinor": 500000,
  "currency": "NGN",
  "eventType": "payment_failed",
  "mode": "TEST",
  "skipTransactionVerification": true
}
```

Verify:

```http
GET /api/v1/invoices/{invoiceId}
```

Expected:

```txt
invoice.status = PAYMENT_FAILED
subscription.status = PAST_DUE or INCOMPLETE
dunningAttempts contains status = SCHEDULED
```

---

## 10. Let Worker Process Dunning Automatically

With:

```env
DUNNING_RETRY_DELAYS_MINUTES=1,2,3
WORKER_DUNNING_INTERVAL_MS=60000
```

wait about 1 minute after the scheduled dunning time.

Watch worker logs:

```txt
Dunning job ... completed
```

Then check:

```http
GET /api/v1/invoices/{invoiceId}
```

Expected if Nomba still fails:

```txt
new payment attempt created
old dunning attempt = FAILED
next dunning attempt = SCHEDULED
invoice = PAYMENT_FAILED
subscription = PAST_DUE or INCOMPLETE
```

Expected if charge succeeds:

```txt
payment attempt = SUCCEEDED
dunning attempt = SUCCEEDED
invoice = PAID
subscription = ACTIVE
```

---

## 11. Simulate Successful Dunning Recovery

If the worker-created retry payment attempt fails because the Nomba card token is simulated, recover the invoice by simulating success for the newest retry attempt.

Find the newest payment attempt on:

```http
GET /api/v1/invoices/{invoiceId}
```

Copy:

```txt
attempt.providerReference
```

Then call:

```http
POST /api/v1/dev/webhooks/nomba/simulate
```

Body:

```json
{
  "merchantTxRef": "PASTE_NEWEST_PROVIDER_REFERENCE",
  "amountMinor": 500000,
  "currency": "NGN",
  "eventType": "payment_success",
  "mode": "TEST",
  "skipTransactionVerification": true
}
```

Verify:

```http
GET /api/v1/invoices/{invoiceId}
GET /api/v1/subscriptions/{subscriptionId}
```

Expected:

```txt
invoice.status = PAID
invoice.amountPaidMinor = 500000
subscription.status = ACTIVE
subscription.nextBillingAt = subscription.currentPeriodEnd
```

---

## 12. Merchant Webhook Delivery Demo

Create a merchant webhook endpoint using a webhook.site URL.

Endpoint:

```http
POST /api/v1/businesses/{businessId}/webhook-endpoints
```

Authorization:

```txt
merchantSession
```

Body:

```json
{
  "url": "https://webhook.site/YOUR-URL",
  "description": "Demo webhook endpoint",
  "events": [
    "invoice.payment_succeeded",
    "invoice.payment_failed",
    "subscription.active",
    "subscription.past_due",
    "dunning.retry_scheduled"
  ]
}
```

After dunning recovery, check webhook.site for:

```txt
invoice.payment_succeeded
subscription.active
```

Check delivery history:

```http
GET /api/v1/businesses/{businessId}/webhook-endpoints/{endpointId}/deliveries
```

---

## 13. Renewal Worker Demo

To demo automatic recurring renewal, you need a subscription where:

```txt
status = ACTIVE
nextBillingAt <= now
```

Current options:

- Use the fast-forward endpoint:

```http
POST /api/v1/dev/billing/subscriptions/{subscriptionId}/fast-forward
```

Authorization:

```txt
merchantSession
```

Body:

```json
{
  "businessId": "BUSINESS_ID",
  "mode": "TEST",
  "minutesAgo": 1
}
```

This sets:

```txt
nextBillingAt = now - 1 minute
```

Once `nextBillingAt <= now`, the billing worker should create a renewal invoice and payment attempt automatically.

Verify:

```http
GET /api/v1/subscriptions/{subscriptionId}
GET /api/v1/invoices?subscriptionId={subscriptionId}
GET /api/v1/payment-attempts?subscriptionId={subscriptionId}
```

---

## Pass Criteria

The demo passes if you can show:

- Worker service is running.
- A customer has a tokenized reusable payment method.
- Subscription creates first invoice and payment attempt.
- Failed payment schedules dunning.
- Worker automatically processes due dunning.
- Dunning failure schedules another retry.
- Simulated recovery marks invoice paid.
- Subscription returns to active.
- Merchant webhook endpoint receives lifecycle events.

This proves Recurr is not just CRUD. It is running a real recurring billing lifecycle with background recovery.

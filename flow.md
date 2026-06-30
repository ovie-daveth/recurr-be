# Recurr Backend Engine Build Guide

## Project Context

**Recurr** is a managed subscription and recurring billing engine built on top of Nomba's payment primitives.

The goal is to provide infrastructure that merchants and product teams can integrate into their own applications to manage:

- Plan management
- Customer enrollment
- Tokenized payment methods
- Recurring billing
- Billing cycles
- Proration
- Failed-payment recovery
- Dunning workflows
- Customer self-service billing portal
- Webhooks for downstream merchant systems

This backend will be built with:

- Node.js
- Express.js
- TypeScript
- PostgreSQL
- Prisma ORM
- Redis
- BullMQ
- Nomba Checkout API
- Nomba Tokenized Cards API
- Nomba Charge API
- Nomba Transfers API
- Nomba Webhooks

---

# 1. Backend Philosophy

This project should not be built like a normal CRUD app.

It is a billing engine.

That means the backend must be designed around:

- State machines
- Idempotency
- Reliable background jobs
- Database transactions
- Webhook verification
- Multi-tenant isolation
- Payment retry logic
- Auditability
- Developer-friendly APIs

The frontend can come later. The backend is the core product.

---

# 2. Core Actors

There are three main actors in the system.

```txt
Recurr Platform
    |
    |-- Merchant / Product Team
    |       |
    |       |-- Merchant's Customers / Subscribers
    |
    |-- Nomba APIs
```

## 2.1 Merchant

The merchant is the business or product team integrating Recurr.

Example:

- SaaS platform
- School platform
- Membership platform
- Creator platform
- Utility billing platform

The merchant uses Recurr APIs to create plans, customers, and subscriptions.

## 2.2 Subscriber

The subscriber is the merchant's customer.

Example:

A merchant creates a monthly plan. Their end user subscribes to that plan. Recurr stores that subscriber as a customer record under the merchant's tenant.

## 2.3 Nomba

Nomba provides the payment primitives:

- Checkout
- Tokenized cards
- Charge API
- Transfers
- Webhooks

Recurr sits above Nomba and manages the recurring billing logic.

---

# 3. Recommended Architecture

Use a modular monolith.

Do not start with microservices.

```txt
React Dashboard / Merchant App
            |
            v
Node.js + Express API
            |
            v
Billing Core
            |
            |-- PostgreSQL
            |-- Redis
            |-- BullMQ Workers
            |
            v
Nomba APIs
            |
            v
Merchant Webhooks
```

---

# 4. Folder Structure

Create the backend folder like this:

```txt
recurr-backend/
  src/
    app.ts
    server.ts

    config/
      env.ts

    lib/
      prisma.ts
      redis.ts
      queue.ts
      money.ts
      dates.ts
      errors.ts
      idempotency.ts
      crypto.ts

    middlewares/
      auth.middleware.ts
      tenant.middleware.ts
      error.middleware.ts
      validate.middleware.ts

    modules/
      tenants/
        tenants.routes.ts
        tenants.controller.ts
        tenants.service.ts

      plans/
        plans.routes.ts
        plans.controller.ts
        plans.service.ts
        plans.schema.ts

      customers/
        customers.routes.ts
        customers.controller.ts
        customers.service.ts
        customers.schema.ts

      payment-methods/
        payment-methods.routes.ts
        payment-methods.controller.ts
        payment-methods.service.ts

      subscriptions/
        subscriptions.routes.ts
        subscriptions.controller.ts
        subscriptions.service.ts
        subscriptions.state.ts
        subscriptions.schema.ts

      invoices/
        invoices.routes.ts
        invoices.controller.ts
        invoices.service.ts

      payments/
        payments.service.ts
        payments.provider.ts

      dunning/
        dunning.service.ts
        dunning.policy.ts

      webhooks/
        nomba-webhook.routes.ts
        nomba-webhook.controller.ts
        merchant-webhook.service.ts
        webhook-signing.ts

      portal/
        portal.routes.ts
        portal.controller.ts
        portal.service.ts

      nomba/
        nomba.client.ts
        nomba.types.ts
        nomba.service.ts

    jobs/
      billing.worker.ts
      dunning.worker.ts
      webhook.worker.ts
      queues.ts

  prisma/
    schema.prisma
    migrations/

  docker-compose.yml
  package.json
  tsconfig.json
  .env
  .env.example
  README.md
```

---

# 5. Step 1: Initialize the Project

```bash
mkdir recurr-backend
cd recurr-backend
npm init -y
```

Install runtime dependencies:

```bash
npm install express cors helmet morgan dotenv zod @prisma/client
npm install bcryptjs jsonwebtoken nanoid axios luxon
npm install bullmq ioredis
```

Install development dependencies:

```bash
npm install -D typescript ts-node-dev prisma
npm install -D @types/node @types/express @types/cors @types/morgan
npm install -D @types/bcryptjs @types/jsonwebtoken
```

Initialize TypeScript:

```bash
npx tsc --init
```

Initialize Prisma:

```bash
npx prisma init
```

---

# 6. Step 2: Configure TypeScript

Use modern Node ESM configuration.

Update `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "./src",
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

Update `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:studio": "prisma studio"
  }
}
```

---

# 7. Step 3: Environment Variables

Create `.env`:

```env
NODE_ENV=development
PORT=5000

DATABASE_URL="postgresql://postgres:postgres@localhost:5432/recurr_db?schema=public"

REDIS_HOST=localhost
REDIS_PORT=6379

JWT_SECRET="replace-this-with-a-secure-secret"
API_KEY_PREFIX="sk_test"

NOMBA_BASE_URL="https://api.nomba.com"
NOMBA_CLIENT_ID=""
NOMBA_CLIENT_SECRET=""
NOMBA_ACCOUNT_ID=""
NOMBA_WEBHOOK_SIGNING_KEY="NombaHackathon2026"

APP_BASE_URL="http://localhost:5000"
FRONTEND_BASE_URL="http://localhost:5173"
```

Create `.env.example` with the same keys but without real secrets.

---

# 8. Step 4: Docker Compose for PostgreSQL and Redis

Create `docker-compose.yml`:

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16
    container_name: recurr_postgres
    restart: always
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: recurr_db
    ports:
      - "5432:5432"
    volumes:
      - recurr_postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    container_name: recurr_redis
    restart: always
    ports:
      - "6379:6379"

volumes:
  recurr_postgres_data:
```

Run:

```bash
docker compose up -d
```

---

# 9. Step 5: Create Express Server

Create `src/app.ts`:

```ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));

// Important: keep raw body support in mind for webhook signature verification.
// For now, use JSON globally.
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "recurr-backend"
  });
});

app.post("/api/v1/webhooks/nomba", (req, res) => {
  console.log("Nomba webhook received:", {
    headers: req.headers,
    body: req.body
  });

  res.status(200).json({
    received: true
  });
});

export default app;
```

Create `src/server.ts`:

```ts
import dotenv from "dotenv";
dotenv.config();

import app from "./app.js";

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Recurr backend running on port ${PORT}`);
});
```

Run:

```bash
npm run dev
```

Test:

```txt
GET http://localhost:5000/health
POST http://localhost:5000/api/v1/webhooks/nomba
```

---

# 10. Step 6: Deploy Early for Webhook URL

Before building everything, deploy the minimal backend so you can submit your webhook URL to Nomba.

Your webhook endpoint should be:

```txt
https://your-deployed-domain.com/api/v1/webhooks/nomba
```

Example:

```txt
https://recurr-api.onrender.com/api/v1/webhooks/nomba
```

Do not submit localhost.

Bad:

```txt
http://localhost:5000/api/v1/webhooks/nomba
```

Good:

```txt
https://your-public-api.com/api/v1/webhooks/nomba
```

Deployment options:

- Render
- Railway
- Fly.io
- VPS
- Azure App Service

---

# 11. Step 7: Database Schema Design

Open `prisma/schema.prisma`.

Use PostgreSQL:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}
```

Add core enums:

```prisma
enum TenantStatus {
  ACTIVE
  SUSPENDED
}

enum PlanStatus {
  ACTIVE
  ARCHIVED
}

enum BillingInterval {
  DAY
  WEEK
  MONTH
  YEAR
  CUSTOM
}

enum SubscriptionStatus {
  INCOMPLETE
  TRIALING
  ACTIVE
  PAST_DUE
  PAUSED
  CANCELLED
  EXPIRED
}

enum InvoiceStatus {
  DRAFT
  OPEN
  PAYMENT_PROCESSING
  PAID
  PAYMENT_FAILED
  VOID
  UNCOLLECTIBLE
}

enum PaymentAttemptStatus {
  PENDING
  PROCESSING
  SUCCEEDED
  FAILED
  REQUIRES_ACTION
  ABANDONED
}

enum WebhookDeliveryStatus {
  PENDING
  DELIVERED
  FAILED
  RETRYING
}
```

Core models to implement:

```txt
Tenant
ApiKey
Customer
Plan
Subscription
Invoice
InvoiceItem
PaymentMethod
PaymentAttempt
DunningPolicy
DunningAttempt
WebhookEndpoint
WebhookEvent
WebhookDelivery
IdempotencyKey
AuditLog
```

---

# 12. Step 8: Multi-Tenant Design

Every resource must belong to a tenant.

Required pattern:

```txt
tenant_id is required on almost every table
```

Example:

```prisma
model Tenant {
  id        String       @id @default(uuid())
  name      String
  email     String
  status    TenantStatus @default(ACTIVE)
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  plans     Plan[]
  customers Customer[]
  apiKeys   ApiKey[]
}
```

All merchant API requests should resolve tenant from API key.

Request pattern:

```txt
Authorization: Bearer sk_test_xxxxxx
```

Middleware should:

1. Read API key.
2. Hash and compare it.
3. Resolve tenant.
4. Attach tenant to request context.
5. Reject request if tenant is inactive.

---

# 13. Step 9: Plan Management

Plan management should support:

- Monthly billing
- Annual billing
- Custom intervals
- Trial days
- Metadata
- Active/archive status

Endpoints:

```txt
POST /api/v1/plans
GET /api/v1/plans
GET /api/v1/plans/:id
PATCH /api/v1/plans/:id
DELETE /api/v1/plans/:id
```

Example request:

```json
{
  "name": "Pro Monthly",
  "code": "pro_monthly",
  "amountMinor": 500000,
  "currency": "NGN",
  "interval": "MONTH",
  "intervalCount": 1,
  "trialDays": 14,
  "metadata": {
    "users": 10,
    "projects": 50
  }
}
```

Important rule:

Do not store money as decimal floats.

Store all money in minor units.

```txt
₦5,000.00 = 500000 kobo
```

---

# 14. Step 10: Customer Management

Endpoints:

```txt
POST /api/v1/customers
GET /api/v1/customers
GET /api/v1/customers/:id
PATCH /api/v1/customers/:id
```

Example request:

```json
{
  "email": "john@example.com",
  "name": "John Doe",
  "phone": "08000000000",
  "externalReference": "merchant-user-123",
  "metadata": {
    "source": "merchant_app"
  }
}
```

This customer represents the merchant's subscriber.

---

# 15. Step 11: Payment Method Setup

Use Nomba Checkout to collect payment details and create/tokenize payment methods.

Recurr should not collect raw card details.

Flow:

```txt
Merchant creates customer
        |
Merchant requests payment setup checkout
        |
Recurr creates Nomba checkout order
        |
Customer completes Nomba checkout
        |
Nomba sends webhook to Recurr
        |
Recurr stores payment reference/tokenized card reference
```

Endpoint:

```txt
POST /api/v1/customers/:customerId/payment-methods/setup-checkout
```

Example response:

```json
{
  "checkoutUrl": "https://checkout.nomba.com/...",
  "reference": "recurr_setup_123"
}
```

---

# 16. Step 12: Subscription Creation

Endpoint:

```txt
POST /api/v1/subscriptions
```

Example request:

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

Subscription creation rules:

If trial exists:

```txt
status = TRIALING
current_period_start = now
current_period_end = now + trial_days
next_billing_at = trial_end
```

If no trial:

```txt
status = INCOMPLETE
create first invoice
attempt payment immediately
if paid -> ACTIVE
if failed -> PAST_DUE or INCOMPLETE
```

---

# 17. Step 13: Subscription State Machine

The subscription state machine is central to the project.

Allowed states:

```txt
INCOMPLETE
TRIALING
ACTIVE
PAST_DUE
PAUSED
CANCELLED
EXPIRED
```

Main transitions:

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

Create a file:

```txt
src/modules/subscriptions/subscriptions.state.ts
```

Use it to centralize transition validation.

Never allow random status updates directly in controllers.

---

# 18. Step 14: Invoice Generation

Invoices represent what should be charged.

Endpoints:

```txt
GET /api/v1/invoices
GET /api/v1/invoices/:id
POST /api/v1/invoices/:id/pay
```

Invoice generation should happen:

- On subscription creation if no trial
- On billing date
- On immediate proration charge
- On manual retry

Invoice status flow:

```txt
DRAFT -> OPEN -> PAYMENT_PROCESSING -> PAID
DRAFT -> OPEN -> PAYMENT_PROCESSING -> PAYMENT_FAILED
OPEN -> VOID
OPEN -> UNCOLLECTIBLE
```

---

# 19. Step 15: Billing Worker

The billing worker finds subscriptions due for renewal.

Worker job:

```txt
generate_due_invoices
```

Process:

1. Find subscriptions where `nextBillingAt <= now`.
2. Lock rows to avoid double billing.
3. Generate invoice.
4. Attempt charge using saved tokenized card.
5. Update subscription period.
6. Emit webhook event.
7. Schedule dunning if payment fails.

Use database transactions.

Use row locking where possible.

Pseudo SQL:

```sql
SELECT *
FROM subscriptions
WHERE next_billing_at <= now()
AND status IN ('ACTIVE', 'TRIALING')
FOR UPDATE SKIP LOCKED;
```

---

# 20. Step 16: Nomba Charge Integration

Create an abstraction:

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

This prevents your billing engine from depending directly on Nomba-specific logic everywhere.

---

# 21. Step 17: Failed Payment and Dunning

Dunning means recovering failed payments.

When payment fails:

```txt
invoice -> PAYMENT_FAILED
subscription -> PAST_DUE
create dunning attempt
schedule retry job
emit invoice.payment_failed webhook
```

Default retry policy:

```txt
Retry 1: after 1 hour
Retry 2: after 24 hours
Retry 3: after 3 days
Retry 4: after 7 days
Final action: cancel subscription or pause access
```

Endpoints:

```txt
POST /api/v1/dunning-policies
GET /api/v1/dunning-policies
```

Config example:

```json
{
  "name": "Default Recovery Policy",
  "retries": [
    { "delay": "1h", "channel": "email" },
    { "delay": "24h", "channel": "email" },
    { "delay": "3d", "channel": "email" },
    { "delay": "7d", "channel": "email" }
  ],
  "finalAction": "cancel_subscription"
}
```

---

# 22. Step 18: Proration Engine

Proration is needed when subscribers upgrade or downgrade mid-cycle.

Formula:

```txt
unused_old_plan_value = old_plan_price * unused_seconds / total_period_seconds

new_plan_partial_cost = new_plan_price * remaining_seconds / total_period_seconds

proration_amount = new_plan_partial_cost - unused_old_plan_value
```

Endpoint:

```txt
POST /api/v1/subscriptions/:id/change-plan
```

Request:

```json
{
  "newPlanId": "plan_new",
  "prorationBehavior": "CREATE_PRORATIONS"
}
```

Supported proration behavior:

```txt
CREATE_PRORATIONS
NONE
ALWAYS_INVOICE
```

Hackathon implementation:

- Upgrade: charge proration immediately.
- Downgrade: apply credit to next invoice.

---

# 23. Step 19: Merchant Webhooks

Merchants need to receive subscription events from Recurr.

Events to emit:

```txt
customer.created
plan.created
subscription.created
subscription.trialing
subscription.active
subscription.past_due
subscription.cancelled
invoice.created
invoice.payment_succeeded
invoice.payment_failed
payment_method.updated
dunning.retry_scheduled
dunning.exhausted
```

Endpoints:

```txt
POST /api/v1/webhook-endpoints
GET /api/v1/webhook-endpoints
DELETE /api/v1/webhook-endpoints/:id
```

Webhook delivery must include signing.

Headers:

```txt
X-Recurr-Signature: hmac_sha256(payload, webhook_secret)
X-Recurr-Timestamp: timestamp
```

Retry delivery schedule:

```txt
1 minute
5 minutes
30 minutes
2 hours
12 hours
```

---

# 24. Step 20: Nomba Webhook Handling

Nomba sends payment events to Recurr.

Endpoint:

```txt
POST /api/v1/webhooks/nomba
```

Handler responsibilities:

1. Verify `nomba-signature` header using signing key.
2. Parse event.
3. Store raw event.
4. Match event to checkout/payment reference.
5. Update payment attempt.
6. Update invoice.
7. Update subscription state.
8. Emit merchant webhook.

Use this signing key for the hackathon:

```txt
NombaHackathon2026
```

Never trust incoming webhook bodies without signature verification.

---

# 25. Step 21: Customer Self-Service Portal APIs

The self-service portal is not the main merchant dashboard.

It is an optional hosted portal that merchants can give to their subscribers.

Flow:

```txt
Merchant creates portal session
        |
Recurr returns secure portal URL
        |
Subscriber opens portal
        |
Subscriber manages billing
```

Endpoint:

```txt
POST /api/v1/portal/sessions
```

Response:

```json
{
  "url": "https://recurr.app/portal/session/abc123"
}
```

Portal capabilities:

```txt
View current subscription
View billing history
Update payment method
Retry failed payment
Change plan
Cancel subscription
```

---

# 26. Step 22: Idempotency

Billing APIs must be idempotent.

Important endpoints:

```txt
POST /api/v1/customers
POST /api/v1/subscriptions
POST /api/v1/invoices/:id/pay
POST /api/v1/subscriptions/:id/change-plan
```

Header:

```txt
Idempotency-Key: unique-request-id
```

If the same request is retried, return the original response instead of creating duplicate resources.

Store:

```txt
tenant_id
idempotency_key
request_hash
response_body
status_code
created_at
```

---

# 27. Step 23: Audit Logs

Every major billing action should be auditable.

Log actions like:

```txt
plan.created
customer.created
subscription.created
subscription.activated
invoice.generated
payment.attempted
payment.failed
payment.succeeded
dunning.retry_scheduled
subscription.cancelled
webhook.delivered
```

This improves trust and helps during demo.

---

# 28. Step 24: API Documentation

Use Swagger/OpenAPI.

Install:

```bash
npm install swagger-ui-express yamljs
npm install -D @types/swagger-ui-express @types/yamljs
```

Expose:

```txt
GET /docs
```

Show developers how to:

- Create a plan
- Create a customer
- Create a subscription
- Retry a payment
- Create a webhook endpoint
- Create a portal session

API ergonomics is one of the judging criteria, so the docs matter.

---

# 29. Step 25: Backend Build Order

Build in this order:

## Phase 1: Foundation

```txt
1. Express server
2. Health endpoint
3. PostgreSQL connection
4. Prisma setup
5. Redis connection
6. Error middleware
7. Request validation middleware
```

## Phase 2: Nomba Webhook Submission Requirement

```txt
1. Create POST /api/v1/webhooks/nomba
2. Deploy backend
3. Submit webhook URL to Nomba
4. Submit sub-account ID from Nomba dashboard
```

## Phase 3: Merchant and Tenant System

```txt
1. Create tenant
2. Generate API key
3. Auth middleware
4. Tenant-scoped requests
```

## Phase 4: Core Billing Resources

```txt
1. Plan CRUD
2. Customer CRUD
3. Payment method setup
4. Subscription creation
```

## Phase 5: Billing Engine

```txt
1. Invoice generation
2. Payment attempts
3. Nomba tokenized card charge
4. Subscription state transitions
```

## Phase 6: Workers

```txt
1. Billing worker
2. Dunning worker
3. Webhook delivery worker
```

## Phase 7: Advanced Billing Logic

```txt
1. Proration
2. Plan upgrade/downgrade
3. Cancellation
4. Pause/resume
```

## Phase 8: Developer Experience

```txt
1. Swagger docs
2. Webhook logs
3. API examples
4. Demo seed data
```

---

# 30. Minimum Hackathon MVP

If time is limited, build this minimum version:

```txt
GET /health

POST /api/v1/webhooks/nomba

POST /api/v1/plans
GET /api/v1/plans

POST /api/v1/customers
GET /api/v1/customers

POST /api/v1/subscriptions
GET /api/v1/subscriptions/:id

POST /api/v1/subscriptions/:id/change-plan

GET /api/v1/invoices

POST /api/v1/invoices/:id/pay

POST /api/v1/webhook-endpoints
GET /api/v1/webhook-endpoints
```

Worker MVP:

```txt
billing.worker
dunning.worker
webhook.worker
```

Demo MVP:

```txt
Create plan
Create customer
Create subscription
Simulate successful payment
Generate invoice
Simulate failed payment
Trigger dunning retry
Recover payment
Show webhook delivery
```

---

# 31. Demo Story for Judges

The demo should tell a story.

```txt
A merchant wants to launch a SaaS product using Nomba.

Without Recurr:
They must build plans, invoices, subscription lifecycle logic, retry systems, dunning, customer billing portal, and webhooks from scratch.

With Recurr:
They integrate once, create plans and customers via API, and Recurr handles recurring billing automatically.
```

Show:

1. Merchant creates a plan.
2. Merchant creates a customer.
3. Merchant starts a subscription.
4. Customer payment is processed through Nomba.
5. Recurr generates the invoice.
6. Recurr updates subscription state.
7. Recurr emits a webhook to the merchant.
8. A failed payment enters dunning.
9. Retry succeeds.
10. Subscription returns to active.

---

# 32. Technical Features Judges Will Care About

Focus on these:

```txt
State-machine completeness
Dunning sophistication
Multi-tenant cleanliness
API ergonomics
Webhook reliability
Idempotency
Proration correctness
Billing cycle accuracy
Clean Nomba abstraction
```

If you implement these well, the project will look mature.

---

# 33. Practical Development Checklist

## Day 1

```txt
Set up Express + TypeScript
Set up Prisma + PostgreSQL
Set up Redis
Create health endpoint
Create Nomba webhook endpoint
Deploy minimal backend
Submit webhook URL
```

## Day 2

```txt
Create tenant system
Create API key auth
Create plan CRUD
Create customer CRUD
Create payment method setup placeholder
```

## Day 3

```txt
Create subscription model
Create invoice model
Implement subscription state machine
Implement subscription creation flow
```

## Day 4

```txt
Implement billing worker
Implement invoice generation
Implement Nomba provider abstraction
Implement mock/sandbox payment flow
```

## Day 5

```txt
Implement dunning worker
Implement retry schedule
Implement payment recovery
Implement webhook delivery to merchants
```

## Day 6

```txt
Implement proration
Implement plan changes
Implement portal session APIs
Add audit logs
```

## Day 7

```txt
Add Swagger docs
Add seed data
Polish demo
Test complete subscription lifecycle
Prepare pitch/demo script
```

---

# 34. Important Engineering Rules

## Rule 1: Never use floats for money

Bad:

```ts
const amount = 5000.75;
```

Good:

```ts
const amountMinor = 500075;
```

## Rule 2: Every important write must be transactional

Subscription creation, invoice generation, payment attempts, and dunning updates should use database transactions.

## Rule 3: Never directly mutate subscription status

Always use the subscription state machine.

## Rule 4: Webhooks must be stored before processing

Store raw webhook events first. Then process them.

## Rule 5: Workers must be idempotent

A failed job may retry. Retried jobs must not double-charge customers.

## Rule 6: External API calls should be wrapped

Do not call Nomba directly from controllers. Use a provider/adaptor service.

## Rule 7: Every tenant must only see its own data

Always query by:

```txt
tenant_id + resource_id
```

Never query by resource ID alone.

---

# 35. Final Target

At the end of the backend build, Recurr should allow a merchant to do this:

```txt
1. Create a plan
2. Create a customer
3. Set up payment method through Nomba
4. Start a subscription
5. Automatically bill the customer
6. Retry failed payments
7. Change plans with proration
8. Send lifecycle webhooks to merchant systems
9. Let the subscriber manage billing through a portal
```

This is the backend engine.
The React frontend should simply make this engine visible.

# Predictive Fault-Tolerant Scope for Recurr BE

## 1. Methodology

This project is designed as a billing engine, not a CRUD app. That changes the fault-tolerance model.

The underlying methodology is:

- Treat every billing transition as a state machine.
- Make every external side effect idempotent.
- Write the authoritative state to the database first.
- Move retryable work into background workers.
- Never depend on a single request lifecycle for payment or webhook safety.
- Use locks, persisted status, and retries instead of optimistic assumptions.
- Log and measure every transition so recovery is predictive, not reactive.

In this codebase, that pattern is already visible:

- API requests use idempotency keys before mutation.
- Critical updates are protected by advisory locks.
- Billing and dunning jobs run through Redis/BullMQ workers.
- Webhook delivery is delayed and retried rather than treated as fire-and-forget.
- Dunning retries are scheduled by policy and persisted as state.

That is the correct fault-tolerance model for this app.

---

## 2. Fault-Tolerant Scope

The fault-tolerant scope covers every place the system can lose correctness or reliability during recurring billing:

- payment processing
- subscription state transitions
- invoice state changes
- dunning retries
- merchant webhook delivery
- provider callback handling
- idempotent API retries
- cleanup and housekeeping
- observability and recovery

The scope is intentionally not “server is up 99.9%.”
It is “billing outcomes remain correct even when the process crashes, retries fire, calls are duplicated, or a downstream partner is temporarily unavailable.”

---

## 3. Core Principle: Correctness over speed

When a billing action is in flight, the system must behave like this:

1. Capture intent in the database.
2. Lock the business/subscription/invoice record if needed.
3. Trigger provider action or job.
4. Persist the transition outcome.
5. Retry only on a known failure mode.
6. Make retries safe through idempotency.
7. Emit downstream notifications only after the authoritative state is durable.

The system must prefer:

- durable state over transient optimism
- retryable jobs over in-process blocking
- event replay over lost notification
- observability over assumptions

---

## 4. Fault-Tolerant Flow

### 4.1 Request entry and idempotency

Every mutation request enters through the same pattern:

- Merchant sends API request with business context and API key.
- Request carries an idempotency key.
- Middleware checks for the same key and same payload.
- If the key is replayed, the service returns the original result.
- If the key is reused with a different payload, it fails fast.

This protects against:

- client retries after timeout
- duplicate POST requests from mobile dashboards or UI clients
- payment re-submission caused by network flakiness

This is the first line of defensive design.

Flow:

Request -> Validate payload -> Resolve business + auth -> Idempotency check -> Persist request intent -> Execute domain logic

---

### 4.2 Transaction boundary and lock acquisition

Before mutating a subscription, invoice, payment attempt, or dunning record, the system must lock the exact resource being changed.

Examples:

- lock subscription when billing is about to create invoice + payment attempt
- lock invoice when payment state is moving from PENDING to PAID or FAILED
- lock dunning attempt when retry policy decides next action
- lock webhook delivery record when retry status changes

This avoids race conditions where two jobs process the same invoice at the same time.

Flow:

Acquire advisory lock -> verify current state -> confirm transition is valid -> persist new state -> release lock

Important rule:

- if a transition cannot be safely validated, do not proceed
- if the lock is unavailable, retry later or queue the work

---

### 4.3 State transition as source of truth

Billing operations are modeled as state transitions, not ad hoc writes.

Examples:

- invoice: PENDING -> PAID / FAILED / PARTIALLY_PAID
- subscription: TRIALING -> ACTIVE -> PAST_DUE -> CANCELLED
- payment attempt: INITIATED -> PROCESSING -> SUCCEEDED -> FAILED -> RETRY_SCHEDULED
- dunning attempt: SCHEDULED -> PROCESSING -> RETRYING -> EXHAUSTED
- webhook delivery: PENDING -> DELIVERED / RETRYING / FAILED

All transitions must be persisted before the next stage is triggered.

This gives us recovery anchors.

If the app crashes after the database row is updated but before a downstream call finishes, the next run can reconcile based on persisted state rather than guessing.

---

### 4.4 External actions are queued and retried

Anything that depends on a remote provider should not be treated as synchronous and final.

Examples:

- Nomba payment request
- webhook delivery to merchant endpoint
- customer notification email
- retry follow-up for dunning

These are decoupled from the API request using BullMQ workers.

Pattern:

API request writes state -> queue background job -> worker executes remote call -> worker updates state -> worker schedules retry if needed

This reduces failure blast radius and keeps the request path short.

---

### 4.5 Payment and billing flow (fault-tolerant design)

This is the primary flow for the recurring billing engine.

Flow:

1. Customer subscription reaches billing due date.
2. Billing scheduler enqueues job for eligible business/subscription.
3. Worker loads active subscription and invoice state.
4. Worker acquires lock for that subscription or invoice.
5. Worker checks if invoice is already paid or already being processed.
6. If status is safe to process, create a payment attempt record with a provider-safe idempotency key.
7. Persist the payment attempt as INITIATED or PROCESSING.
8. Call Nomba or the provider.
9. Provider returns success/failure/timeout.
10. Worker writes the authoritative result to payment attempt + invoice + subscription.
11. If success: mark invoice as paid and advance subscription state.
12. If failure: mark invoice as failed and schedule dunning retry.
13. Emit merchant webhook after the DB state is durable.
14. If provider call times out or the worker crashes, the system retries using persisted idempotency and status.

Critical rule:

A provider call must be safe to repeat without creating duplicate charges.

That is why the flow depends on:

- unique payment attempt IDs
- provider request idempotency keys
- database record checks before creating new charges
- eventual reconciliation if the provider response is delayed

---

### 4.6 Dunning flow (fault-tolerant recovery)

Dunning is a retry loop, and retry loops are exactly where faults accumulate.

The dunning pattern in this repo already follows the right idea:

- schedule a retry with a persisted delay
- record attempt count
- use policy-driven retry windows
- escalate to final action after exhaustion
- emit a dunning webhook after the retry state is recorded

Fault-tolerant flow:

1. Invoice payment fails.
2. System records failure reason and creates dunning attempt.
3. Policy chooses next delay (for example 60 min, 1 day, 3 days, 7 days).
4. Dunning state is written as SCHEDULED.
5. Worker picks up due dunning attempt.
6. Worker re-attempts payment collection or subscriber outreach.
7. Result is persisted.
8. If successful, invoice moves to recovered state and subscription may recover.
9. If not successful, schedule another retry or apply final action.
10. Final action can be pause or cancel subscription based on policy.

This ensures that payment failure does not leak into an undefined state when the system is restarting or a worker dies.

---

### 4.7 Webhook flow (fault-tolerant downstream delivery)

Merchant webhooks are high-risk for reliability because they are external and often transient.

The correct pattern is:

- generate an event payload
- persist the event in the system
- attempt delivery with a timeout
- record the delivery attempt count and response status
- retry using a delay schedule
- stop only after final retry policy exhaustion

Flow:

1. Business event occurs (invoice paid, subscription active, dunning exhausted).
2. Event is created as a merchant webhook payload.
3. Webhook delivery record is created as PENDING.
4. Delivery attempts are sent with HMAC signature and timestamp.
5. If HTTP 2xx: mark DELIVERED.
6. If HTTP error or timeout: mark RETRYING and schedule next retry.
7. If retries are exhausted: mark FAILED.
8. Worker continues to reattempt until success or policy exhaustion.

This protects merchants from lost notifications without letting the core billing system block on external delivery latency.

---

### 4.8 Recovery and reconciliation

Fault tolerance is not just about retrying requests. It is about recovery after partial failure.

Recovery path:

- On startup, load active workers and scheduled jobs.
- Reconcile state with provider status when needed.
- Re-run pending billing jobs for due subscriptions.
- Re-run due dunning jobs.
- Re-queue failed webhook deliveries.
- Detect duplicate/inconsistent invoice or payment states and resolve them from authoritative records.

This is a major design requirement for a billing engine. Recovery must be deterministic.

Examples:

- a provider accepted the payment but the app crashed before persisting the invoice update
- a webhook was delivered but the worker died before marking it delivered
- a payment attempt is retried after timeout and must not double-charge

The answer is not “retry blindly.” The answer is “retry safely using persistent state and idempotency keys.”

---

## 5. Predictive machine-learning path

The resilience model above is the transactional backbone. The machine-learning path sits on top of that backbone as a predictive decision layer.

This is the missing piece in the earlier version: the platform should not only react to failures, it should learn from them and act before they become expensive.

### 5.1 Purpose of the ML layer

The predictive layer should answer questions like:

- Which customers are likely to fail payment soon?
- Which subscriptions are likely to churn after a failed retry?
- Which merchants are likely to have webhook delivery failure patterns?
- Which dunning retries are worth attempting versus which should be escalated immediately?
- Which payment state transitions are likely to be ambiguous or fraud-risky?

This turns fault tolerance from reactive recovery into predictive risk management.

### 5.2 Data sources

The ML system should consume only durable, structured events from the billing engine.

Core data sources:

- subscription lifecycle events
- invoice states and payment attempt results
- dunning retry counts and delays
- webhook delivery latency, status, and retry count
- payment failure reasons and provider response codes
- customer payment history and cycle behavior
- business-level retry and recovery metrics
- operational signals such as queue lag, worker restarts, and timeout spikes

This data must be stored in a normalized event model, not scattered across logs.

### 5.3 Learning flow

The machine-learning path should be:

1. Capture event stream from billing engine
2. Normalize each event into a standard schema
3. Aggregate into features such as failure rate, retry count, time-to-recovery, and retry pattern
4. Score each subscription or business against a predictive model
5. Produce a recommended action: retry, pause, escalate, reduce exposure, or notify operator
6. Persist model decision and outcome for feedback training
7. Retrain on a regular cadence using actual outcomes

In other words:

Events -> feature engineering -> model scoring -> policy decision -> durable action -> feedback loop

### 5.4 Decision boundary

The ML layer should never be the source of truth for billing state.

Instead, it should act as a recommendation engine that informs state transitions without bypassing the transaction-safe model.

Example:

- Model predicts a customer is high-risk for payment failure.
- System increases retry sensitivity or preempts dunning escalation.
- The recommendation is stored as metadata and referenced in the workflow.
- The final state change still requires the same database transaction, lock, and idempotency safeguards.

This keeps the system safe: AI predicts, but the billing engine remains authoritative.

### 5.5 Fault-tolerant ML design

To keep the learning path reliable, the predictive layer must follow the same discipline as the transactional layer:

- use durable event records, not ephemeral in-memory metrics
- avoid model decisions that bypass idempotency or locking
- persist model outputs with timestamps and confidence scores
- treat model failure as non-fatal; continue with safe baseline behavior
- allow fallback to default rule-based policies when predictions are unavailable or stale
- track prediction drift and confidence degradation

This matters because an ML model failing should not create billing instability.

### 5.6 Example predictive workflow for Recurr

A concrete predictive flow for this project:

1. Failed payment event lands in billing engine.
2. System stores payment attempt and dunning attempt state.
3. Event stream feeds feature pipeline.
4. Customer profile model scores risk of churn or repeat failure.
5. Model predicts high risk of non-recovery after third failed dunning cycle.
6. System recommends an earlier final action or a softer retry policy.
7. Decision is logged with confidence and policy version.
8. The actual business outcome is recorded as a training label.
9. Model is retrained periodically based on real outcomes.

This is the predictive layer that turns “fault-tolerant billing” into “self-improving billing resilience.”

### 5.7 Operational rule for ML

The ML layer must never be allowed to make irreversible billing decisions without a fallback safety path.

Rules:

- predictions are advisory unless they are wrapped in a policy guardrail
- critical actions still require the database-backed state transition model
- low-confidence predictions must fall back to conservative rules
- model failure must default to the safe baseline policy

---

## 6. Defensive resilience model

The system should assume all of the following can fail at any time:

- database writes may succeed but app may crash before the next action
- provider requests may time out without a clear response
- workers may restart mid-execution
- queue jobs may be retried due to Redis or worker restarts
- downstream merchants may reject or time out webhook delivery
- duplicate requests may arrive from the same client

The resilience model is:

- write the outcome first
- retry safely
- verify externally when ambiguity exists
- avoid destructive reprocessing
- never allow an ambiguous state to become permanent without reconciliation

---

## 6. Operational rules

These are the rules the platform should enforce:

- All mutating API routes must support idempotency.
- All state transitions must be persisted before side effects are emitted.
- All external calls must be retriable and safe to repeat.
- Payment operations must be deduplicated by payment attempt and provider idempotency key.
- Webhook retries must be persisted and scheduled, not in-memory only.
- Every worker should be stateless and safe to restart.
- Every retry path must be observable.
- Every final failure must be explicit and auditable.

---

## 7. Recommended implementation sequence for this repo

The repo already contains the structural foundation. The next sequence should be:

1. Harden idempotency at all mutation routes.
2. Standardize state transitions for subscriptions, invoices, and payment attempts.
3. Ensure each payment flow has a single safe execution path with provider idempotency.
4. Expand dunning retry policy coverage and final actions.
5. Make webhook retry cadence and final failure handling explicit and measurable.
6. Add recovery jobs that reconcile pending states on startup.
7. Add operational dashboards and alerts for retry volume, queue lag, failed deliveries, and payment anomalies.

This is the proper predictive fault-tolerant path for the current build.

---

## 8. Delivery flow in one sentence

The fault-tolerant design for this backend is: accept requests idempotently, lock and persist state transitions in the database, offload provider and webhook work to retryable background jobs, treat retries as business logic rather than infrastructure noise, and reconcile ambiguity using durable state and observability.

That is the correct architecture for a recurring billing platform that must remain correct under failure.

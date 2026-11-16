# Multi-Provider Payments and Predictive Failover

## Current mock implementation

The backend now routes payment calls through mock adapters for Nomba, Monnify, and Paystack. The live Nomba adapter remains in the codebase but is no longer used by payment flows. Checkout URLs use a provider-neutral Recurr mock path.

Configure the provider order with `PAYMENT_PROVIDER_ORDER`. Simulate charge outcomes with `PAYMENT_MOCK_<PROVIDER>_CHARGE_OUTCOME`:

- `SUCCEEDED`: charge succeeds
- `DECLINED`: the provider definitively declines; do not fail over
- `UNAVAILABLE`: provider is unavailable; try the next configured provider
- `UNKNOWN`: charge outcome is ambiguous; leave it processing and do not fail over
- `PROCESSING` or `REQUIRES_ACTION`: return that state without failover

Example: set Nomba to `UNAVAILABLE` and Monnify to `SUCCEEDED` to test an internal fallback to Monnify. The payment attempt records the provider that actually handled it. These mock adapters use synthetic credentials and do not demonstrate real provider-token portability or settlement.

## Goal

Evolve Recurr from a Nomba-only payment integration into a multi-provider payment platform that can use Nomba, Paystack, and Monnify (confirm the intended provider if “Minify” means something else).

The system should be able to:

- let a merchant configure one or more supported providers
- select a provider for each new payment based on eligibility and routing policy
- stop sending new payments to a provider whose health is degraded
- use predictive signals to identify likely provider degradation
- recover safely without creating duplicate charges

Provider failover is not simply “if provider A errors, immediately charge with provider B.” Payment outcomes can be ambiguous, and stored payment credentials are usually provider-specific. Correctness and customer protection take priority over automatic failover.

## Current repository position

There is already a useful starting seam:

- `src/modules/payments/payment.provider.ts` defines a `PaymentProvider` interface.
- `src/modules/nomba/nomba.service.ts` implements the Nomba adapter.
- `PaymentAttempt` stores a provider and provider reference.
- `PaymentMethod` stores a provider and provider-specific customer/payment-method references.
- `WebhookEvent` already records the provider associated with incoming events.

However, the provider contract currently returns the literal provider `"NOMBA"`, the Prisma `PaymentProvider` enum only contains `NOMBA`, and billing, dunning, checkout, payment-method, invoice, subscription, and portal flows import the Nomba implementation directly. Multi-provider support therefore requires routing through a registry or router across all payment entry points, not only adding another adapter.

## Architecture

```text
Billing / checkout / dunning / portal
                  |
                  v
       Payment provider router
       - eligibility checks
       - merchant routing policy
       - provider health / circuit breaker
       - safe fallback decision
                  |
       +----------+----------+
       |          |          |
     Nomba     Paystack   Monnify
       |          |          |
       +---- provider-specific APIs and webhooks
```

The router chooses a provider for a **new payment attempt**. Each attempt is permanently associated with the selected provider and that provider's reference. Retries or status checks for the same attempt must continue against that provider.

## Core safety invariants

1. **One attempt, one provider.** A payment attempt is never silently reassigned to another provider.
2. **No blind failover after an ambiguous charge.** A timeout or connection loss does not prove that the provider declined the charge. Query or reconcile the original provider before creating a new attempt.
3. **Provider-scoped idempotency.** Use a stable reference/idempotency key for retries to the same provider. Do not assume idempotency keys are interchangeable across providers.
4. **Provider-scoped credentials.** A Nomba token must not be sent to Paystack or Monnify. A customer needs a credential/token created with the alternate provider before that provider can charge it.
5. **Persist before side effects.** Record the selected provider, attempt, and reference before making the external request.
6. **A provider outage must not change billing truth.** Circuit breakers affect routing eligibility, not invoice or subscription state by themselves.
7. **ML advises; guarded policy decides.** Model output cannot override payment status, idempotency, locks, or reconciliation requirements.

## Provider contract and adapters

Refactor the provider interface so provider identity is generic rather than hard-coded to `"NOMBA"`. Define shared normalized results for:

- checkout creation
- reusable payment-method setup/tokenization
- tokenized charge
- transaction lookup/reconciliation
- provider health or capability information where appropriate
- webhook signature verification and event normalization

Keep API payloads, response parsing, authentication, and provider error mapping inside each adapter. Normalize provider-specific outcomes into Recurr's internal statuses, while preserving a sanitized provider code and diagnostic metadata for support and analysis.

Implement adapters separately:

- `NombaPaymentProvider`
- `PaystackPaymentProvider`
- `MonnifyPaymentProvider`

Do not leak raw provider response formats into billing, dunning, or route handlers. Avoid claiming all providers have identical capabilities: routing must check whether the provider supports the currency, operation, and payment method required by the specific flow.

## Data and configuration changes

### Provider identity

- Extend the Prisma `PaymentProvider` enum for each supported provider.
- Use the enum consistently for payment attempts, payment methods, webhook events, and provider configuration.
- Keep existing Nomba records mapped to `NOMBA`; deploy the schema change without rewriting historical provider references.

### Merchant provider configuration

Add a business-scoped configuration model or equivalent secure configuration mechanism for:

- enabled providers
- test/live mode
- supported currencies and payment methods
- primary provider and permitted fallback order
- routing mode: fixed, configured fallback, or health-aware
- provider credentials or secret references
- enabled/disabled status and operator-controlled pause

Never store provider secrets in plaintext application logs or return them through merchant APIs. Prefer managed secret storage; if secrets are stored in the database, encrypt them and define rotation and access controls.

### Provider-specific payment credentials

A payment method must represent a credential for a specific provider. Keep distinct provider customer and payment-method references, scoped by business, customer, mode, and provider. If the customer has not completed setup with a candidate provider, that provider is not eligible for an off-session charge.

Do not copy a provider token into another provider's fields. Provide an explicit setup/tokenization flow to enroll a payment method with an additional provider, subject to provider rules and customer consent.

### Attempt and routing records

For each payment attempt, persist:

- selected provider
- stable Recurr payment-attempt ID
- provider reference and provider idempotency key
- routing reason/policy version
- whether the selection was fallback or predictive
- provider result and reconciliation status

Keep routing decisions auditable. Avoid storing sensitive card data or unnecessary personal data in routing metadata.

## Routing flow

```text
Billing event becomes due
  -> create/claim invoice and payment attempt under existing transaction/lock rules
  -> load eligible providers for business, mode, currency, operation, and payment method
  -> remove providers that are manually disabled or circuit-open
  -> apply configured priority and guarded health/predictive policy
  -> persist selected provider and stable provider reference
  -> call that provider adapter
  -> normalize and persist result
  -> on definitive decline: apply business retry/fallback policy
  -> on timeout/unknown: reconcile with the same provider before any new charge
  -> emit merchant event after durable state is committed
```

The router should return an explicit decision, such as selected provider, reason, and eligible alternatives. If no provider is eligible, fail with a visible and auditable reason; do not silently pick an unsupported provider.

### Failover eligibility

Failover to another provider may be considered only when:

- the original attempt is definitively declined or proven not to have been accepted; or
- reconciliation confirms the original attempt did not charge; and
- the alternate provider supports the requested payment operation and currency; and
- the customer has a valid credential registered with that alternate provider; and
- business policy permits the fallback.

Do not fail over just because a request timed out, a worker restarted, or a webhook is delayed. Those are ambiguous outcomes and require reconciliation.

## Provider health and circuit breakers

Track health by provider, environment/mode, and where useful operation or region. Signals should include:

- request success, decline, and error rates
- timeout rate and latency percentiles
- transaction lookup/reconciliation failures
- webhook processing delays or signature failures
- recent health-check results

Distinguish provider declines from technical failures. A decline such as insufficient funds is a customer/payment outcome, not evidence that the provider is down.

Use configurable rolling windows and thresholds to move providers through states such as:

```text
CLOSED (normal routing)
  -> OPEN (temporarily excluded from new attempts)
  -> HALF_OPEN (limited probe traffic)
  -> CLOSED (recovered)
```

Circuit-breaker state should be observable and have a defined recovery path. Do not block status lookup or reconciliation merely because new charge traffic is circuit-open.

## Predictive machine-learning path

Predictive routing should be introduced only after reliable provider-level event data exists.

### Data

Capture normalized, timestamped outcomes for each provider request:

- provider, mode, operation, currency, and region
- outcome category: success, customer decline, provider error, timeout, unknown
- latency and retry count
- reconciliation result
- whether the request was a probe or normal traffic

Use operational data and provider responses, not raw card data. Define retention, access, and privacy rules for all training features.

### Model and policy

Start with health metrics and deterministic circuit-breaker rules as the baseline. Later, train a model to estimate short-horizon technical failure probability or expected latency for a provider/operation. Do not train a model to interpret a customer decline as provider failure.

The model may rank otherwise eligible providers or recommend opening a circuit. A guarded policy must:

- reject providers that are disabled, unsupported, or lack a valid payment credential
- enforce configured business routing preferences
- use confidence and freshness thresholds
- cap the effect of predictions and preserve a safe rule-based fallback
- log model version, features/decision reason, confidence, and resulting outcome

Measure model precision, false-positive failovers, payment success, duplicate-charge incidents, and customer impact. Begin in shadow mode (record recommendations without changing routing), then canary a small eligible traffic segment, and roll out only if safety and business metrics improve.

## Webhooks and reconciliation

Each adapter needs provider-specific callback verification followed by common event normalization. Keep the provider name and provider event ID in the durable webhook record. Deduplicate events within provider and mode, then reconcile the corresponding payment attempt using its stored provider and reference.

Reconciliation should cover:

- provider accepted a charge but Recurr did not persist the response
- provider callback arrived before or after a worker result
- duplicate or delayed callback
- worker crashed during the external call
- callback reports a status conflicting with the current attempt

Apply state transitions through the existing transaction and locking safeguards. Conflicting or unresolved outcomes should become visible operational cases, not be silently treated as failures.

## Implementation roadmap

### Phase 1: Provider-neutral contract

- Generalize provider identity/result types.
- Create a provider registry and router.
- Route existing Nomba calls through the router without changing default behavior.
- Remove direct Nomba imports from billing, dunning, checkout, invoice, subscription, payment-method, and portal flows.
- Add focused tests proving existing Nomba behavior remains unchanged.

### Phase 2: Provider-aware persistence

- Add provider enum values and merchant provider configuration.
- Add and validate migrations, preserving existing Nomba data.
- Ensure payment attempts, payment methods, and provider webhooks are provider-scoped.
- Add tests for credential/provider mismatch and attempt-provider immutability.

### Phase 3: Second provider in test mode

- Implement one additional adapter (Paystack or Monnify) for a bounded set of operations.
- Normalize checkout, tokenization, charge, lookup, and webhook results.
- Validate the end-to-end payment lifecycle in provider test mode.
- Document any capability differences before expanding supported operations.

### Phase 4: Deterministic routing and safe fallback

- Add merchant-configured provider priority and eligibility checks.
- Add reconciliation for ambiguous results.
- Permit fallback only after definitive decline or confirmed non-charge.
- Test timeout, duplicate request, delayed webhook, and worker restart scenarios.

### Phase 5: Health monitoring and circuit breakers

- Add provider-level metrics, dashboards, and operator controls.
- Implement configurable closed/open/half-open behavior.
- Test that circuit-open blocks new charges but still permits reconciliation.
- Alert on provider degradation, stuck unknown attempts, and failed reconciliation.

### Phase 6: Predictive routing

- Build a normalized provider event dataset and feature pipeline.
- Run predictions in shadow mode first.
- Compare recommendations against deterministic routing and actual outcomes.
- Canary guarded recommendations before enabling broader automated routing.
- Keep a switch to disable model-based routing without affecting payments.

## Acceptance criteria

The multi-provider implementation is ready for production rollout only when:

- all payment entry points use the provider router
- Nomba continues to work as the default after refactoring
- every attempt records exactly one provider and uses provider-specific credentials
- an unknown provider result cannot trigger an immediate alternate charge
- retries and callbacks are idempotent and reconcile to one authoritative attempt state
- each provider's webhook signatures and event IDs are validated and deduplicated
- provider health and circuit state are observable and operator-controllable
- migration, routing, fallback, outage, timeout, and recovery cases are covered by tests
- predictive routing has demonstrated value in shadow/canary evaluation and has a safe off switch

## Summary

Recurr can become multi-provider by routing all payment operations through a provider-neutral contract, persisting provider choice on each attempt, and treating provider health and ML predictions as constrained routing inputs. Safe failover requires provider-specific tokens and reconciliation of ambiguous payments. The system must never trade correctness for automatic switching.

# Predictive Fault-Tolerance Implementation Plan

## 1. Purpose and research question

This document is the implementation starting point for the Recurr school-project
artefact. It operationalises `methodology.md` using the existing Node.js,
PostgreSQL, Redis, BullMQ, and k6 backend.

The primary research question is:

> Does a safety-constrained predictive controller improve payment reliability
> beyond conventional reactive fault tolerance under the same workload and
> induced fault conditions?

The important comparison is **Configuration B (Reactive)** versus
**Configuration C (Predictive)**. Configuration A provides a lower baseline.

## 2. Current starting point

Already implemented in this repository:

- persisted subscriptions, invoices, payment attempts, dunning attempts, and
  webhook deliveries;
- idempotency records and PostgreSQL advisory locks;
- BullMQ workers for billing, dunning, cleanup, and webhook retries;
- mock payment-provider routing/failover and k6 load-test run/response storage;
- operational event logs and process-local business counters.

Not yet implemented:

- one-second operational telemetry storage;
- fault-event labels;
- experiment configuration/run tracking;
- ML feature export, training, or scoring;
- persisted predictions, controller decisions, and mitigation outcomes;
- infrastructure telemetry exporters/dashboard.

The existing `/health/metrics` counters are useful diagnostics but cannot be
used as the research dataset: they reset on process restart and do not contain
latency histograms, queue state, resource use, or experiment correlation.

## 3. Experimental configurations

All three configurations must use the **same API version, test data, workload,
fault scenario, observation period, and telemetry schema**. Only the selected
resilience behaviour changes.

| Configuration | Behaviour | Implementation boundary |
| --- | --- | --- |
| A — Baseline | Direct mock-provider request with measurement only. | Test-only experiment flag disables application retry/failover/controller paths for the experiment route. |
| B — Reactive | Timeouts, bounded retries, circuit breaker/failover, and existing idempotency protections. | Existing safe baseline; add explicit experiment configuration and circuit-breaker state/metrics where needed. |
| C — Predictive | Configuration B plus an advisory ML prediction and policy-guarded preventive action. | Controller may change routing/traffic behaviour but never bypass durable billing, locking, or idempotency. |

### Safety rules

- Run experiments only in `TEST` mode, with mock providers and non-production
  credentials.
- Keep database-backed idempotency and data-integrity protections enabled in
  every configuration. They are correctness controls, not the experimental
  variable.
- A prediction is advisory until its controller rule accepts it.
- A model or controller failure must fall back to Configuration B behaviour.
- Initial controller actions must be reversible: temporarily deprioritise an
  unhealthy provider, open a short-lived circuit, or route new work to a
  healthy mock provider. It must not cancel subscriptions or mark invoices paid.

## 4. First implementation milestone: common measurement pipeline

Implement this before ML training or automated mitigation.

### 4.1 Sampling contract

- Sample service telemetry every **one second** while an experiment is active.
- Use UTC `sampledAt` timestamps and one `experimentRunId` on every sample.
- Store aggregate service-level measurements, not payment data or request bodies.
- Preserve optional `requestId`, transaction/payment-attempt ID, and job ID only
  on event records where correlation is necessary.
- Store unknown/unavailable values as `NULL`; do not replace missing data with
  zero.
- Version the feature and label definitions from day one.

### 4.2 Essential telemetry fields

| Field group | Initial fields | Source in this project |
| --- | --- | --- |
| Process | CPU %, RSS/heap MB, event-loop delay | Node `process` and `perf_hooks` |
| HTTP | request count, success count, error count, timeout count, mean/p95/p99 latency | Express middleware with bounded route labels |
| Queue | waiting, active, failed job counts; oldest waiting-job age | BullMQ queue inspection |
| Database | active connections/pool use; connection acquisition errors | Prisma/`pg` adapter instrumentation; PostgreSQL query where available |
| Network/provider | bytes in/out where available; network/provider errors; provider-routing result | HTTP/provider wrapper and mock router |
| Service/container | health status, API/worker process restart count, container health/restart count when Docker is used | health probe plus Docker/host collector |

Do not use high-cardinality metric labels such as payment reference, request ID,
customer ID, raw URL, or error message. Store those only in correlated event
records when justified.

## 5. Proposed database model

Add these models in a dedicated Prisma migration. Keep them separate from live
billing entities so telemetry writes do not affect payment correctness.

| Table/model | Minimum fields and purpose |
| --- | --- |
| `ExperimentRun` | `id`, `configuration`, `workloadProfile`, `faultScenario`, `startedAt`, `endedAt`, `status`, `codeVersion`, `notes` — one controlled run. |
| `TelemetryRecord` | `experimentRunId`, `sampledAt`, CPU, memory, request rate, errors, timeouts, latency percentiles, queue metrics, DB connections, network errors, health, restart count, `featureSchemaVersion`. |
| `FaultEvent` | `experimentRunId`, `faultType`, `startedAt`, `endedAt`, `severity`, `injected`, `detectedAt`, `recoveredAt`, `details`. This creates reliable outcome labels. |
| `PredictionRecord` | `experimentRunId`, `telemetryRecordId`, `createdAt`, `failureProbability`, `predictedClass`, `horizonSeconds`, `modelVersion`, `predictionLatencyMs`, `featureSchemaVersion`. |
| `ControllerDecision` | `predictionId`, `decidedAt`, `decision`, `policyRule`, `reason`, `decisionLatencyMs`, `fallbackUsed`. |
| `MitigationAction` | `decisionId`, `actionType`, `startedAt`, `completedAt`, `status`, `executionLatencyMs`, `outcome`, `revertedAt`. |
| `ExperimentTransaction` | `experimentRunId`, `requestId`, `idempotencyKeyHash`, `paymentAttemptId`, `status`, `submittedAt`, `completedAt`, `responseLatencyMs`, `duplicateDetected`. |

Add indexes for `(experimentRunId, sampledAt)`, `(experimentRunId, startedAt)`,
and `(experimentRunId, submittedAt)`. Hash idempotency keys before storage;
never store secrets.

## 6. Labels and measurement definitions

### 6.1 Failure label

The initial model target is `payment_failure_next_30s`.

For a telemetry sample at time `t`, set the label to `true` only when a defined
fault event begins in `(t, t + 30 seconds]`. Until the full 30 seconds have
elapsed, leave the label `NULL`. Do not train on unlabelled recent samples.

Start with these explicit failure events:

1. all mock payment providers unavailable;
2. unexpected API 5xx or configured request timeout;
3. queue delay above the agreed threshold;
4. API or worker service unhealthy/restarted during the observation window.

Keep expected, injected TEST-mode provider outages identifiable as `injected`;
evaluate them separately from unexpected application failures.

### 6.2 Reliability formulas

- **Transaction success rate** = successful eligible transactions / submitted
  eligible transactions × 100.
- **Duplicate transaction rate** = unintended duplicates / eligible processed
  transactions × 100.
- **Availability** = healthy observation seconds / total observation seconds × 100.
- **Error rate** = failed requests / total requests × 100.
- **MTTR** = average of `recoveredAt - startedAt` over recovered fault events.
- **P95/P99 latency** = percentile of completed eligible transaction response
  latency for the experiment run.

Treat intentional `503` mock-provider exhaustion as a reliability outcome, not
as an automatically failed k6 check. Record it separately from unexpected HTTP
or application errors.

### 6.3 ML and controller evaluation

Evaluate C with precision, recall, F1, PR-AUC, false-positive count,
false-negative count, prediction latency, and prediction lead time. Because
failures are uncommon, PR-AUC is more informative than accuracy.

Record controller decision latency, mitigation execution latency,
prediction-to-intervention time, preventive-action count, unnecessary
intervention count, missed-intervention count, and mitigation success rate.

A mitigation succeeds only when its target condition improves within the
predefined window without causing an integrity breach or a worse availability
outcome. Define that window per fault scenario before running experiments.

## 7. Delivery phases

### Phase 1 — Measurement foundation

1. Add `ExperimentRun`, `TelemetryRecord`, `FaultEvent`, and
   `ExperimentTransaction` Prisma models and migration.
2. Create a test-only authenticated experiment-run API: start, stop, and read
   summary. k6 creates/finishes the run as it does today.
3. Add request instrumentation for request rate, errors, timeouts, and latency
   aggregates.
4. Add a worker telemetry sampler that writes one record per second for active
   experiment runs.
5. Add BullMQ queue depth/delay and basic process CPU/memory measurements.
6. Link k6 simulation responses to `ExperimentTransaction` records.

**Exit criteria:** a low k6 run produces one experiment record, approximately
one telemetry sample per second, request/transaction records, and a queryable
summary with success rate, duplicate rate, availability, p95/p99, throughput,
error rate, and MTTR where a recovery event occurs.

### Phase 2 — Controlled faults and reactive configuration

1. Add explicit, auditable TEST-only fault injectors for provider outage,
   latency/timeout, duplicate-request burst, service restart marker, and
   database interruption marker.
2. Implement an experiment configuration resolver for A/B/C.
3. Make B's timeout, retry, provider failover, and circuit-breaker policy
   observable and bounded.
4. Persist every injected and detected fault as `FaultEvent`.

**Exit criteria:** the same k6 profile and fault scenario can be repeated for
A and B, and their summaries are comparable without manual data merging.

### Phase 3 — Dataset and offline ML baseline

1. Export completed, labelled telemetry rows to a versioned CSV/Parquet dataset
   for Python.
2. Split datasets chronologically by experiment run; never randomly split
   adjacent one-second samples.
3. Train Logistic Regression first, then Random Forest/XGBoost only if the
   baseline and dataset size justify them. Defer LSTM until there is sufficient
   time-series data.
4. Select a threshold using validation data and document the precision/recall
   trade-off.
5. Calculate prediction lead time against `FaultEvent.startedAt`.

**Exit criteria:** a reproducible training/evaluation script emits model
version, feature schema, threshold, PR-AUC, precision, recall, F1, false
positives/negatives, prediction latency, and lead-time distribution.

### Phase 4 — Predictive controller

1. Add a scoring adapter that receives the latest telemetry features and has a
   strict timeout.
2. Persist every score as `PredictionRecord` before any controller action.
3. Add guardrails: minimum probability threshold, minimum lead time, cooldown,
   maximum action duration, and B-mode fallback.
4. Start with one reversible action: temporarily avoid/deprioritise a predicted
   unhealthy mock provider.
5. Persist the decision, action, and later outcome.

**Exit criteria:** C can be run with the same scenario as B; every prediction
can be traced to a decision, action/no-action, and observed fault outcome.

### Phase 5 — Evaluation and report evidence

1. Run each configuration for every fault scenario at least three times.
2. Keep workload profile, duration, fault start time, and environment stable.
3. Report median and spread across repetitions, not only the best run.
4. Present B-versus-C reliability, ML quality, controller effectiveness, and
   computational overhead separately.
5. State limitations: mock providers, local environment, dataset size,
   synthetic faults, and any missing host/container measurements.

## 8. Initial implementation order

The next code change should be **Phase 1, items 1–2**: create the experiment
and telemetry schema plus the start/finish API. Do not begin model integration
until a completed k6 run produces durable, timestamp-aligned records.

After that, implement the one-second sampler and HTTP aggregation, then update
the k6 script so every run carries `configuration` and `faultScenario`.

## 9. Definition of done for the first milestone

- [ ] Prisma migration applies cleanly.
- [ ] A TEST-only experiment run can start and complete.
- [ ] Telemetry records are persisted at about one-second intervals.
- [ ] Each record has UTC timestamp, experiment ID, schema version, and no PII.
- [ ] k6 responses link to the active experiment run.
- [ ] Summary endpoint calculates the Phase 1 reliability metrics.
- [ ] A documented low-profile run proves the data path end-to-end.
- [ ] No payment, invoice, or subscription state is changed by telemetry code.

# Operational Telemetry and ML Data Implementation

## Purpose

Define how to collect Node.js application, payment API, PostgreSQL, Redis,
Docker, and host metrics; display them in Recurr's own dashboard; and prepare
time-aligned data for a future fault-prediction model.

This is an implementation plan, not a claim that the monitoring stack is
already installed.

## Current starting point

- The k6 mock-provider test stores runs and individual responses in
  `MockLoadTestRun` and `MockLoadTestResponse`. This is useful for associating
  controlled load tests with later measurements.
- `GET /health/metrics` in `src/app.ts` returns the application counters from
  `src/lib/observability.ts`. These are in-process business-event counters;
  they reset when the Node process restarts and do not include infrastructure
  metrics or HTTP latency histograms.
- `docker-compose.yml` runs PostgreSQL and Redis. The Node API runs separately
  on the host in the local development setup.
- The custom React dashboard should remain the user-facing telemetry view.
  Grafana is optional and can be used as an internal troubleshooting tool.

## Target architecture

```text
Node.js API --OTLP--> OpenTelemetry Collector --Prometheus scrape--> Prometheus
                            |                                      |
                            +--> Tempo (optional traces)           +--> protected BE telemetry API --> React dashboard
                                                                   |
PostgreSQL --> postgres_exporter ----------------------------------+
Redis -------> redis_exporter ------------------------------------+
Docker ------> cAdvisor / Docker metrics exporter ----------------+
Windows host -> windows_exporter ---------------------------------+

Prometheus query API --> feature sampler --> append-only ML dataset
```

The browser must not query Prometheus, exporters, or Docker directly. The
backend provides an authenticated, read-only API for dashboard queries.
Prometheus stores operational time series; the feature sampler produces a
separate dataset for model training.

## Measurements

| Source | Initial measurements | Collection approach |
| --- | --- | --- |
| Node.js process | CPU time, RSS, heap used/limit, garbage collection, event-loop delay/utilization, uptime | OpenTelemetry Node SDK plus a small custom event-loop instrument |
| Payment/API server | Requests per second, in-flight requests, 4xx/5xx rate, latency histogram and p50/p95/p99 | Express HTTP server instrumentation; normalize route names |
| Payment routing | Direct success, successful fallback, provider unavailable, provider request errors | Bounded counters/histograms with a `mode` dimension to distinguish TEST simulations from LIVE traffic |
| PostgreSQL | Active/idle connections, transactions, locks/waits, deadlocks, cache hit ratio, query calls and mean time | `postgres_exporter`; enable `pg_stat_statements` for query aggregates |
| PostgreSQL client pool | Pool size, checked-out/idle clients, waiters, acquisition wait and timeouts | Instrument the `pg` pool used by `PrismaPg`; provide an explicit pool if the adapter must expose one |
| Redis | Memory, connected clients, commands/sec, command latency, hit/miss ratio, evictions, blocked clients | `redis_exporter` |
| Docker containers | CPU, memory, network and I/O; container availability | cAdvisor where supported; Docker Engine/Telegraf metrics for restart counts |
| Windows host | Overall CPU, memory, disk and network | `windows_exporter` installed on the Windows host |
| BullMQ workers | Queue depth, oldest waiting job age, active/failed jobs, retries | Worker-side gauges/counters exported by the Node process |

For PostgreSQL query p95, do not infer a percentile from `pg_stat_statements`
mean values. Add query-duration histograms in the application/driver layer,
grouped by a bounded operation or model name rather than raw SQL text.

## Implementation sequence

### Phase 0: Define metric and label contracts

1. List metric names, units, labels, and owners before adding instrumentation.
2. Use consistent timestamps and a common service/environment identity.
3. Keep labels bounded: method, normalized route, status class, provider, mode,
   and service version are suitable examples.
4. Never label metrics with request IDs, customer IDs, payment references,
   tokens, raw URLs, or arbitrary SQL.
5. Define model targets separately. Recommended initial labels:
   - `payment_failure_next_30s`: provider exhaustion or a defined payment
     failure event in the next 30 seconds.
   - `api_failure_next_30s`: an unexpected API failure in the next 30 seconds.

   Keep expected simulated TEST-mode provider outages distinct from unexpected
   API errors. Version the label definition so training data remains
   interpretable.

**Exit check:** metric names, units, dimensions, failure definitions, and the
sampling interval are documented.

### Phase 1: Add the local metrics and traces pipeline

1. Add an OpenTelemetry Collector service to Docker Compose. Receive OTLP from
   the host API on localhost-bound ports.
2. Configure the Collector's Prometheus exporter for metrics and add Prometheus
   to Compose with a named data volume and explicit local retention.
3. Add Tempo only when trace storage is ready to be used; send traces from the
   Collector to Tempo using OTLP.
4. Keep Prometheus, Collector, and exporter ports private to the development
   machine or Docker network. Do not expose unauthenticated metrics endpoints
   publicly.
5. Add Grafana only if useful for internal verification or alert authoring. It
   is not required for the React dashboard.

For local development, the API can send OTLP to the host-mapped Collector
endpoint. Prometheus scrapes the Collector and exporters by Docker service
name. Document the ports and targets in Compose and the telemetry README.

**Exit check:** Prometheus is healthy and can scrape a test metric from the
Collector.

### Phase 2: Instrument the Node API

1. Initialize the OpenTelemetry SDK before importing the Express application.
2. Instrument Express/HTTP and supported PostgreSQL/Redis clients.
3. Add process metrics and an event-loop delay histogram.
4. Add an HTTP request counter and duration histogram. Use normalized route
   templates, not raw request paths.
5. Add payment-routing counters for direct success, fallback success,
   provider-unavailable outcomes, and unexpected errors. Separate TEST and LIVE
   modes.
6. Preserve request correlation for traces, but do not use request IDs as
   metric labels.
7. Retain `/health/metrics` only for its existing business-counter/debug
   purpose, or deprecate it after equivalent counters are exported. Do not
   persist every scrape as an operational log.

**Exit check:** a k6 run changes API request/latency and routing metrics; process
metrics remain available across scrapes and reset behavior is understood.

### Phase 3: Instrument infrastructure

1. Add `postgres_exporter` and `redis_exporter` to Compose, configured using
   environment references or secret files rather than committed credentials.
2. Enable `pg_stat_statements` through an explicit database configuration and
   migration/restart procedure. Start with aggregate query metrics.
3. Expose PostgreSQL pool usage from the same pool used by Prisma. Include
   waiters and acquisition timeouts to detect saturation.
4. Add cAdvisor for container CPU/memory where Docker Desktop supports the
   required mounts. Add Docker Engine/Telegraf metrics for restart counts.
5. Install `windows_exporter` on Windows for actual host CPU and memory. A
   Linux exporter inside Docker Desktop reports the Linux/WSL environment, not
   necessarily Windows host utilization.
6. Add BullMQ queue depth and oldest-job-age metrics from the worker process.

**Exit check:** every configured scrape target is `up`; induce a controlled
PostgreSQL/Redis/API load and verify that the corresponding measurements move.

### Phase 4: Serve metrics to the custom FE dashboard

1. Add authenticated backend read endpoints, for example:
   `GET /api/v1/telemetry/operational?from=...&to=...&step=...`.
2. Validate and bound time ranges and step sizes. Query Prometheus using a
   service-side client; never accept arbitrary Prometheus query strings from
   the browser.
3. Return a stable, typed response grouped by timestamp and metric family.
4. Add dashboard time-range controls, refresh state, and charts for API
   throughput/errors/p95, Node saturation, Postgres pool/locks, Redis memory and
   clients, Docker containers, and host CPU/memory.
5. Show units, scrape freshness, missing-target warnings, and TEST/LIVE context.
   Keep k6 run history as a separate view and link to correlated operational
   charts by run time.
6. Poll at a modest interval (for example 5-10 seconds); avoid returning raw
   high-resolution series when the selected chart cannot display it.

**Exit check:** the dashboard shows aligned values from all sources, indicates
stale/missing data, and continues to work without Grafana.

### Phase 5: Build the ML feature dataset

1. Keep Prometheus as the operational time-series source. Do not write every
   scrape to the payment/business tables.
2. During controlled k6 runs, sample aligned features every second if the
   measured monitoring overhead is acceptable; otherwise begin at five seconds
   and use the same interval for all features in a row.
3. Write feature rows to an append-only analytics sink, not the live payment
   request path. For a small local prototype this can be a dedicated table or
   file export; for longer retention use a separate analytics database or
   columnar/object storage.
4. Include `sampledAt`, environment, service version, optional k6 run ID,
   traffic rate, API p95/error rate, Node CPU/memory/event-loop delay,
   PostgreSQL connection/pool/query measures, Redis measures, container/host
   utilization, and versioned labels.
5. Keep `loadTestRunId` as a dataset column or relation, not a Prometheus label.
   This links samples to the append-only k6 run history without creating
   per-run metric time series.
6. Compute future-failure labels only after the next 30 seconds are observed.
   Store an unset label as `NULL` until mature; do not train on the newest
   unlabeled interval.
7. Split train/validation/test data chronologically and by run or time period.
   Do not randomly split adjacent time rows, which would leak near-duplicate
   windows across splits.

**Exit check:** each ML row is timestamp-aligned, has a documented feature
definition, can be traced to its source, and has no future-data leakage.

### Phase 6: Validate and roll out prediction

1. Establish baseline telemetry without load, then run low/moderate k6 profiles.
2. Compare API histogram results to k6 summaries and check that all expected
   request outcomes and timestamps are represented.
3. Measure the overhead of instrumentation, exporters, dashboard polling, and
   ML sampling. Reduce scrape frequency or detail if monitoring materially
   changes the load-test result.
4. Train a simple baseline model first and evaluate recall, precision, false
   alarms, and lead time on later chronological runs.
5. Keep predictions advisory until performance is stable across multiple runs
   and failure types. Do not let an unvalidated model trigger automatic
   failover.

## Retention and security

- Use short operational retention in local Prometheus initially; decide on
  longer retention only after estimating metric cardinality and storage.
- Apply explicit retention and access control to traces and ML datasets.
- Avoid payment data, credentials, request/response bodies, and personal data in
  telemetry. Keep only the minimum dimensions needed for diagnosis/modeling.
- Keep exporter credentials out of Compose literals and source control.
- Restrict the backend telemetry endpoints to authorized merchant or operator
  roles as appropriate; separate merchant-facing metrics from internal host and
  infrastructure details.
- Treat observability storage as sensitive operational data and document
  cleanup/retention policies.

## Decisions to make before implementation

1. What exactly counts as each future failure label: provider exhaustion,
   unexpected API 5xx, payment failure, or a separate label for each?
2. Should the first ML dataset be limited to k6 test windows, or include
   production telemetry too? Start with controlled TEST runs.
3. Is one-second sampling required immediately? Start with five-second
   operational scrapes and enable one-second sampling only for bounded k6
   experiments after measuring overhead.
4. What retention and storage target is needed beyond local development?


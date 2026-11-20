Based on your approved methodology, you need to collect metrics in **four main categories**:

1. Infrastructure and service telemetry.
2. Machine learning prediction performance.
3. Payment transaction reliability.
4. Predictive controller performance and computational overhead.

Your experiment compares three configurations:

- **A — Baseline:** Payment processing without additional application-level fault-tolerance mechanisms.
- **B — Reactive:** Payment processing with conventional mechanisms such as timeouts, bounded retries and circuit breakers.
- **C — Predictive:** Reactive mechanisms plus the ML predictor and safety-constrained controller.

The most important comparison is **B versus C**. You need to demonstrate whether adding ML-based prediction actually improves reliability beyond conventional reactive fault tolerance.

# **1. Infrastructure and service telemetry**

These are the metrics your system should continuously collect to train and evaluate the ML model.

Collect them at approximately one-second intervals.

| Metric                    | What it measures                              | Unit         |
| ------------------------- | --------------------------------------------- | ------------ |
| CPU utilisation           | Processor usage by the application            | %            |
| Memory utilisation        | Memory consumed by the application            | MB or %      |
| Network bytes sent        | Outbound network traffic                      | Bytes        |
| Network bytes received    | Inbound network traffic                       | Bytes        |
| Network errors            | Failed network operations                     | Count        |
| Request latency           | Time taken to process requests                | ms           |
| Request throughput        | Requests processed per second                 | Requests/sec |
| Error count               | Failed HTTP requests or service operations    | Count        |
| Timeout count             | Requests that exceeded configured time limits | Count        |
| Queue depth               | Number of pending jobs or messages            | Count        |
| Queue processing delay    | Time jobs spend waiting before processing     | ms           |
| Database connection usage | Active database connections                   | Count        |
| Service health            | Whether the service is healthy or unhealthy   | Boolean      |
| Container restart count   | Number of container restarts                  | Count        |

**Why these matter:** These metrics provide the operational signals from which the model learns to recognise patterns associated with impending service failures.

For example, increasing CPU utilisation, rising request latency, increasing queue depth and a growing error count may collectively indicate an impending service failure.

# **2. Machine learning model evaluation metrics**

These metrics evaluate the predictive ability of your models.

You are considering Logistic Regression, Random Forest, XGBoost and potentially LSTM.

| Metric               | What it measures                                                | Importance |
| -------------------- | --------------------------------------------------------------- | ---------- |
| Precision            | How many predicted failures actually occur                      | High       |
| Recall               | How many actual failures the model detects                      | Very high  |
| F1-score             | Balance between precision and recall                            | Very high  |
| ROC-AUC              | Ability to distinguish failure from non-failure observations    | High       |
| PR-AUC               | Precision-recall performance, particularly with imbalanced data | High       |
| False-positive rate  | Frequency of false failure predictions                          | High       |
| False-negative rate  | Frequency of missed failures                                    | High       |
| Prediction latency   | Time taken to generate a prediction                             | Very high  |
| Prediction lead time | How long before a failure the model predicts it                 | Very high  |

For your research, prediction lead time is particularly important.

Suppose:

- At 10:00:00, the model predicts a possible service failure.
- At 10:00:20, the actual failure occurs.

Your prediction lead time is 20 seconds.

This matters because a model that predicts a failure only milliseconds before it happens may not give your controller sufficient time to intervene.

Your initial prediction horizon is 30 seconds. You should evaluate whether predictions provide enough lead time for the controller to execute preventive actions.

# **3. Payment transaction reliability metrics**

These metrics establish whether your predictive fault-tolerance system actually improves payment processing.

| Metric                       | Formula / measurement                                           | Purpose                                |
| ---------------------------- | --------------------------------------------------------------- | -------------------------------------- |
| Transaction Success Rate     | Successful transactions / eligible submitted transactions × 100 | Measures successful payment processing |
| Duplicate Transaction Rate   | Unintended duplicates / eligible processed transactions × 100   | Measures transaction integrity         |
| System Availability          | Operational observation time / total observation time × 100     | Measures service availability          |
| Mean Response Time           | Average request processing time                                 | Measures responsiveness                |
| P95 Latency                  | 95th percentile response time                                   | Measures tail latency                  |
| P99 Latency                  | 99th percentile response time                                   | Measures extreme response delays       |
| Throughput                   | Successfully processed transactions per second                  | Measures processing capacity           |
| Error Rate                   | Failed requests / total requests × 100                          | Measures service errors                |
| Mean Time to Recovery (MTTR) | Average time required to recover from a failure                 | Measures recovery effectiveness        |

You have already defined the first three formulas in your methodology.

I recommend retaining all three as primary reliability indicators.

The additional metrics, particularly P95/P99 latency, throughput and MTTR, will help explain *how* the predictive system improves or affects transaction processing.

# **4. Predictive controller metrics**

This category is particularly important because your research is not simply about predicting failures. It is about using ML predictions to initiate preventive fault-tolerance actions.

You need to evaluate whether the controller responds appropriately to the model's predictions.

| Metric                               | What it measures                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| Controller decision latency          | Time between receiving a prediction and making a decision                                 |
| Mitigation execution latency         | Time between approving an action and completing it                                        |
| Preventive actions triggered         | Number of mitigation actions executed                                                     |
| Actions triggered by false positives | Number of unnecessary interventions                                                       |
| Mitigation success rate              | Percentage of mitigation actions that successfully address the targeted condition         |
| Prediction-to-intervention time      | Time from prediction generation to mitigation execution                                   |
| Missed intervention count            | Number of relevant failure predictions that did not result in an appropriate intervention |

For example:

Your model predicts that a payment service has an 85% probability of failure within 30 seconds.

The controller receives the prediction, evaluates its policy rules and activates a circuit breaker.

You should record:

- Prediction timestamp.
- Predicted failure probability.
- Controller decision timestamp.
- Decision made.
- Mitigation execution timestamp.
- Mitigation outcome.
- Whether the failure occurred.
- Whether the intervention prevented or reduced the impact of the failure.

This gives you evidence that Activity A (prediction) and Activity B (controller intervention) are functioning as intended.

# **5. Recommended implementation priority**

You do not need to implement every possible metric immediately. Start with this set.

Essential implementation metrics

**Implementation checklist**

0/31 completed

**Infrastructure telemetry**

CPU utilisation

Memory utilisation

Request latency

Request throughput

Error count

Timeout count

Queue depth

Database connection usage

Container health and restart count

Network errors

**ML evaluation**

Precision

Recall

F1-score

PR-AUC

Prediction latency

Prediction lead time

False-positive count

False-negative count

**Payment reliability**

Transaction Success Rate

Duplicate Transaction Rate

Availability

P95 latency

P99 latency

Throughput

Error rate

MTTR

**Controller evaluation**

Controller decision latency

Mitigation execution latency

Number of preventive actions

Mitigation success rate

Unnecessary intervention count

&#x20;Copy checklist

# **6. How I recommend structuring your telemetry database**

Since you are building the artefact with Node.js, PostgreSQL, Redis and Python for ML, I recommend separating raw telemetry, predictions, controller decisions and transaction outcomes.

A possible structure:

| Table                  | Important fields                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `telemetry_records`    | timestamp, cpu, memory, latency, throughput, error_count, queue_depth, db_connections |
| `fault_events`         | fault_type, started_at, ended_at, severity                                            |
| `prediction_records`   | timestamp, failure_probability, predicted_class, model_version, prediction_horizon    |
| `controller_decisions` | prediction_id, decision, policy_rule, decision_timestamp                              |
| `mitigation_actions`   | decision_id, action_type, execution_status, execution_time, outcome                   |
| `transactions`         | transaction_id, idempotency_key, status, created_at, completed_at                     |
| `experiment_runs`      | configuration, workload, fault_scenario, start_time, end_time                         |

One important design decision: telemetry is generally system-level or service-level data, not necessarily transaction-level data. Use trace IDs or optional transaction correlation IDs where appropriate rather than forcing every telemetry record to reference a transaction.

# **7. Your experimental comparison**

This is where all the metrics come together.

| Evaluation area            | A: Baseline | B: Reactive        | C: Predictive        |
| -------------------------- | ----------- | ------------------ | -------------------- |
| Transaction Success Rate   | Measure     | Measure            | Measure              |
| Duplicate Transaction Rate | Measure     | Measure            | Measure              |
| Availability               | Measure     | Measure            | Measure              |
| P95/P99 latency            | Measure     | Measure            | Measure              |
| Throughput                 | Measure     | Measure            | Measure              |
| Error rate                 | Measure     | Measure            | Measure              |
| MTTR                       | Measure     | Measure            | Measure              |
| ML prediction metrics      | N/A         | N/A                | Measure              |
| Controller metrics         | N/A         | Reactive decisions | Predictive decisions |

Run the same workload and fault scenarios against all three configurations. Repeat experiments and compare their results.

Your fault scenarios should include:

- Container or service termination.
- Network degradation and latency spikes.
- Payment-provider simulator outage.
- Database interruption.
- CPU or memory contention.
- Duplicate request bursts.

Keep the workload, fault-injection conditions and observation periods comparable across configurations.

# **8. One important distinction for your research**

Do not confuse these three questions:

| Question                                       | Metrics that answer it                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| Can the ML model predict failures?             | Precision, recall, F1, PR-AUC, lead time                                             |
| Can the controller respond to predictions?     | Decision latency, mitigation latency, mitigation success                             |
| Does the complete system become more reliable? | Transaction success rate, duplicate rate, availability, latency, throughput and MTTR |

Your research contribution depends on answering all three.

**My recommendation:** Implement the telemetry collection and measurement infrastructure before spending too much time tuning the ML model. Without reliable telemetry and accurately labelled fault events, you will not have a defensible dataset or a credible experimental evaluation.

The next implementation step should be to establish a common metrics collection pipeline in your Node.js backend, with timestamps and experiment IDs attached to every observation. This will allow you to train the model and compare all three configurations using the same experimental data structure.&#x20;
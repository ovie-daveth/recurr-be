# Mock provider load test

This k6 test samples the API at 10, 100, or 1,000 requests per second. It calls
only the mock payment-provider router; it does not create invoices or payment
attempts. Each provider attempt does write a `MockProviderLoadEvent`, which the
existing five-minute load model uses to simulate provider degradation and
fallback.

The test route is disabled unless `MOCK_LOAD_TEST_ENABLED=true` and
`NODE_ENV` is `development` or `test`. It requires a merchant dashboard access
token, an active business, and an active reusable TEST payment method. Do not
point k6 at a production service or use LIVE credentials.

## Prepare the local service

1. Install k6 using the instructions at <https://grafana.com/docs/k6/latest/set-up/install-k6/>.
2. Set `MOCK_LOAD_TEST_ENABLED=true` in your local `.env` and restart the API.
3. Open `http://localhost:5000/api/docs`, authorize with your merchant session
   access token, and verify `POST /api/v1/dev/payments/simulate` with your
   business ID and active reusable TEST payment-method ID.
4. Open a VS Code terminal using **Command Prompt**, paste your access token
   when prompted, then run the k6 command below with your own IDs. Treat the
   access token as a secret; do not commit it or share terminal output
   containing it.

```cmd
set /p MERCHANT_SESSION=Paste your merchant access token:
npm run load:k6 -- -e PROFILE=low -e BUSINESS_ID=b321cc40-7c7b-4df8-a3b6-7ebdf0547638 -e PAYMENT_METHOD_ID=88feb767-5598-4f67-a934-4d6d7bf27b3e -e MERCHANT_SESSION=%MERCHANT_SESSION% load-tests/mock-provider.js
set MERCHANT_SESSION=
```

## Profiles

| Profile | Rate | Duration | Use |
| --- | ---: | ---: | --- |
| `low` | 10 requests/second | 30 seconds | Initial smoke run |
| `moderate` | 100 requests/second | 15 seconds | Local service stress |
| `high` | 1,000 requests/second | 5 seconds | Brief, isolated stress run only |

Change `PROFILE=low` to `PROFILE=moderate` or `PROFILE=high`. Run only one
profile at a time and wait at least five minutes between runs so the simulated
provider load window can expire and reset. The high profile is intentionally
short because every provider attempt writes to PostgreSQL and the model
serializes load updates per provider.

k6 reports request rate, latency, checks, dropped iterations, and the custom
`mock_provider_fallbacks` and `mock_provider_all_unavailable` counters. A `503`
means the mock router exhausted its providers; it is an expected simulation
outcome, not a real provider call. The API's mock capacity point is measured in
load units, not TPS, so these profiles test API throughput while triggering
the existing load-based failover heuristic; they do not represent real
provider capacity.

## Save each response for analysis

The dashboard and summary show aggregate metrics, not each response body. To
log every response as JSON (without logging the authorization header), run
this in the same Command Prompt where `MERCHANT_SESSION` is set:

```cmd
k6 run -e PROFILE=low -e BUSINESS_ID=YOUR_BUSINESS_ID -e PAYMENT_METHOD_ID=YOUR_TEST_PAYMENT_METHOD_ID -e "MERCHANT_SESSION=%MERCHANT_SESSION%" -e LOG_RESPONSES=true load-tests/mock-provider.js > k6-run.log 2>&1
```

Open `k6-run.log` in VS Code and search for `MOCK_LOAD_RESPONSE`. Each record
contains the HTTP status, response body, request ID when available, and k6
virtual-user/iteration identifiers. The file also includes the k6 summary.
Keep this output local; never include your token in the log yourself.

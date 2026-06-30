# Merchant, Business, and API Key Flow

## Decision

Recurr should separate human access from server-to-server API access.

The core model is:

```txt
MerchantUser = human who signs up and logs in
Business     = one business/product/workspace collecting recurring payments
ApiKey       = server credential tied to one Business
```

An API key is not the business. An API key belongs to a business.

## Product Flow

```txt
Merchant signs up
        |
Merchant verifies email
        |
Merchant becomes an ACTIVE dashboard user
        |
Merchant creates one or more Business records
        |
Merchant is OWNER of those businesses
        |
Merchant creates TEST or LIVE API keys under each business
        |
Merchant backend uses a business API key to call Recurr APIs
```

## Example

```txt
MerchantUser
- ada@example.com

Businesses
- Acme School
- Acme SaaS
- Acme Gym

API keys
- Acme School test key
- Acme School live key
- Acme SaaS test key
- Acme SaaS live key
- Acme Gym test key
```

## Entity Responsibilities

### MerchantUser

Represents a person who can access Recurr's dashboard.

Fields:

```txt
id
email
passwordHash
name
status: PENDING_VERIFICATION | ACTIVE | DISABLED
emailVerifiedAt
verificationTokenHash
lastLoginAt
createdAt
updatedAt
```

### Business

Represents one merchant business, product, or workspace that owns billing data.

Fields:

```txt
id
ownerUserId
type: BUSINESS | INDIVIDUAL
name
businessName
businessRegistrationNumber
taxId
website
legalName
contactName
contactPhone
country
status: ACTIVE | SUSPENDED
createdAt
updatedAt
```

Business owns:

```txt
plans
customers
subscriptions
invoices
payment methods
webhook endpoints
api keys
audit logs
```

### BusinessMember

Represents a user's role inside a business.

Fields:

```txt
businessId
userId
role: OWNER | ADMIN | DEVELOPER | SUPPORT
createdAt
```

For MVP, signup can create one `BusinessMember` record that makes the signing user the `OWNER`.

### ApiKey

Represents server-to-server credentials for one business.

Fields:

```txt
id
businessId
name
mode: TEST | LIVE
prefix
keyHash
lastUsedAt
revokedAt
expiresAt
createdAt
```

Rules:

```txt
Raw API keys are returned once.
Only key hashes are stored.
Revoked keys cannot authenticate.
Expired keys cannot authenticate.
Suspended businesses cannot use API keys.
TEST and LIVE keys must be distinguishable by mode and ideally prefix.
```

## API Flow

### Merchant Auth

```txt
POST /api/v1/merchants/signup
POST /api/v1/merchants/verify-email
POST /api/v1/merchants/login
GET  /api/v1/merchants/me
```

Signup creates a pending `MerchantUser`. Email verification activates the user and returns a dashboard JWT/session token.

### Business Management

```txt
POST /api/v1/businesses
GET  /api/v1/businesses
GET  /api/v1/businesses/:businessId
PATCH /api/v1/businesses/:businessId
```

These routes require a merchant dashboard JWT/session token.

### API Key Management

```txt
POST /api/v1/businesses/:businessId/api-keys
GET  /api/v1/businesses/:businessId/api-keys
POST /api/v1/businesses/:businessId/api-keys/:keyId/revoke
```

API key creation request:

```json
{
  "name": "Production server key",
  "mode": "LIVE"
}
```

Sandbox key request:

```json
{
  "name": "Sandbox integration key",
  "mode": "TEST"
}
```

### Merchant Backend API Usage

Merchant backend calls Recurr with:

```http
Authorization: Bearer sk_test_xxx
```

or:

```http
Authorization: Bearer sk_live_xxx
```

Recurr resolves:

```txt
API key -> Business -> billing resources
```

Then all plan/customer/subscription/invoice queries are scoped to that business.

## Important Design Rules

1. Merchant dashboard sessions and API keys are different credentials.
2. A merchant user can own or belong to multiple businesses.
3. A business can have multiple API keys.
4. API keys are always tied to exactly one business.
5. Billing resources belong to businesses, not directly to users.
6. API keys should support `TEST` and `LIVE` modes.
7. The term `Tenant` should be removed from public API/docs and replaced with `Business` or `Merchant business`.

## Refactor Target

Current implementation uses `Tenant` as the merchant/business account. Refactor toward:

```txt
Tenant       -> Business
tenantId     -> businessId
TenantStatus -> BusinessStatus
TenantType   -> BusinessType
tenantMiddleware -> apiKeyBusinessMiddleware
```

Keep the internal concept of multi-tenancy, but expose product language as `Business`.

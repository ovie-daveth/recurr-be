export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Recurr API",
    version: "0.2.0",
    description:
      "Merchant-facing API for Recurr subscription and recurring billing infrastructure. Successful API responses use { status: true, message, data }. Error responses use { error: { code, message, details } }.",
  },
  servers: [{ url: "/", description: "Current host" }],
  components: {
    securitySchemes: {
      merchantSession: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "Merchant dashboard JWT",
      },
      businessApiKey: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "Business API key",
      },
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "statusCode", "message", "details"],
            properties: {
              code: {
                type: "string",
                example: "INVALID_CREDENTIALS",
              },
              statusCode: {
                type: "integer",
                example: 401,
              },
              message: {
                type: "string",
                example: "Invalid email or password",
              },
              details: {
                type: "array",
                items: {},
                example: [],
              },
            },
          },
        },
      },
      SuccessResponse: {
        type: "object",
        required: ["status", "code", "message", "data"],
        properties: {
          status: { type: "boolean", enum: [true], example: true },
          code: { type: "integer", example: 200 },
          message: { type: "string", example: "Request successful" },
          data: { type: "object", additionalProperties: true },
        },
      },
      Pagination: {
        type: "object",
        properties: {
          limit: { type: "integer", example: 20 },
          nextCursor: {
            type: "string",
            nullable: true,
            example: "3f1a82f0-682f-40fb-a03a-c0ca4cf3ef4a",
          },
          hasMore: { type: "boolean", example: false },
        },
      },
      ApiKeyListStatus: {
        type: "string",
        enum: ["ACTIVE", "REVOKED", "EXPIRED"],
      },
      IdempotencyKeyHeader: {
        type: "string",
        minLength: 8,
        maxLength: 255,
        description:
          "Optional idempotency key for safe retries. Reusing the same key with the same business, route, and payload replays the original response. Reusing it with a different payload returns an error.",
        example: "idem_01JZ9K7V8A9R2Q3W4E5T6Y7U8I",
      },
      NombaWebhookPayload: {
        type: "object",
        additionalProperties: true,
        description:
          "Raw Nomba webhook JSON payload. The endpoint verifies the signature against the unmodified raw request body before parsing JSON.",
      },
      BusinessType: {
        type: "string",
        enum: ["BUSINESS", "INDIVIDUAL"],
        description:
          "Business profile type. BUSINESS requires businessName. INDIVIDUAL requires legalName.",
        example: "BUSINESS",
      },
      MerchantUserStatus: {
        type: "string",
        enum: ["PENDING_VERIFICATION", "ACTIVE", "DISABLED"],
        description:
          "Merchant dashboard account status. PENDING_VERIFICATION cannot use dashboard APIs until email is verified.",
      },
      BusinessStatus: {
        type: "string",
        enum: ["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED"],
        description:
          "Business workspace status. Only ACTIVE businesses should be allowed to bill with API keys.",
      },
      BusinessMemberRole: {
        type: "string",
        enum: ["OWNER", "ADMIN", "DEVELOPER", "SUPPORT"],
        description:
          "Dashboard role for a merchant user inside a business workspace.",
      },
      ApiKeyMode: {
        type: "string",
        enum: ["TEST", "LIVE"],
        description:
          "TEST keys are for sandbox integrations. LIVE keys are for production billing.",
        example: "TEST",
      },
      BillingInterval: {
        type: "string",
        enum: ["DAY", "WEEK", "MONTH", "YEAR", "CUSTOM"],
        description:
          "Plan billing cadence. CUSTOM still requires intervalCount to define the cycle.",
        example: "MONTH",
      },
      PlanStatus: {
        type: "string",
        enum: ["ACTIVE", "PAUSED", "ARCHIVED"],
        description:
          "Plan lifecycle status. New plans are normally ACTIVE.",
      },
      CustomerStatus: {
        type: "string",
        enum: ["ACTIVE", "DISABLED"],
        description:
          "Customer lifecycle status. Disabled customers are retained for audit/history instead of being deleted.",
      },
      PaymentMethodStatus: {
        type: "string",
        enum: ["PENDING_SETUP", "ACTIVE", "DISABLED", "EXPIRED"],
        description:
          "Payment method lifecycle. PENDING_SETUP means the customer has not completed provider checkout/tokenization yet.",
      },
      DunningAttemptStatus: {
        type: "string",
        enum: [
          "SCHEDULED",
          "PROCESSING",
          "SUCCEEDED",
          "FAILED",
          "CANCELLED",
          "EXHAUSTED",
        ],
      },
      WebhookEventStatus: {
        type: "string",
        enum: ["RECEIVED", "PROCESSED", "FAILED"],
        description:
          "Stored webhook processing status. RECEIVED means stored, PROCESSED means handled, FAILED means processing failed.",
      },
      SubscriptionStatus: {
        type: "string",
        enum: [
          "INCOMPLETE",
          "TRIALING",
          "ACTIVE",
          "PAST_DUE",
          "PAUSED",
          "CANCELLED",
          "EXPIRED",
        ],
        description:
          "Subscription lifecycle. Status changes are validated by the backend state machine.",
      },
      InvoiceStatus: {
        type: "string",
        enum: [
          "DRAFT",
          "OPEN",
          "PAYMENT_PROCESSING",
          "PAID",
          "PAYMENT_FAILED",
          "VOID",
          "UNCOLLECTIBLE",
        ],
      },
      PaymentAttemptStatus: {
        type: "string",
        enum: [
          "PENDING",
          "PROCESSING",
          "SUCCEEDED",
          "FAILED",
          "REQUIRES_ACTION",
          "ABANDONED",
        ],
      },
      Currency: {
        type: "string",
        enum: ["NGN"],
        description:
          "Supported billing currency. Amounts must be sent in the currency minor unit.",
        example: "NGN",
      },
      MerchantSignupRequest: {
        oneOf: [
          { $ref: "#/components/schemas/BusinessMerchantSignupRequest" },
          { $ref: "#/components/schemas/IndividualMerchantSignupRequest" },
        ],
        discriminator: {
          propertyName: "type",
          mapping: {
            BUSINESS: "#/components/schemas/BusinessMerchantSignupRequest",
            INDIVIDUAL: "#/components/schemas/IndividualMerchantSignupRequest",
          },
        },
        description:
          "Choose BUSINESS for a registered/company merchant. Choose INDIVIDUAL for a personal merchant profile.",
      },
      BusinessMerchantSignupRequest: {
        type: "object",
        description:
          "Use this when the merchant is signing up on behalf of a business/company.",
        required: [
          "type",
          "email",
          "password",
          "name",
          "businessName",
          "contactName",
          "contactPhone",
        ],
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: ["BUSINESS"],
            description: "Fixed discriminator value for business signup.",
            example: "BUSINESS",
          },
          email: { type: "string", format: "email", example: "ada@acme.com" },
          password: { type: "string", format: "password", minLength: 8 },
          name: { type: "string", example: "Ada Okafor" },
          businessName: { type: "string", example: "Acme SaaS Ltd" },
          businessRegistrationNumber: { type: "string", example: "RC123456" },
          taxId: { type: "string", example: "TIN123456" },
          website: { type: "string", format: "uri", example: "https://acme.com" },
          contactName: { type: "string", example: "Ada Okafor" },
          contactPhone: { type: "string", example: "+2348012345678" },
          country: { type: "string", default: "NG", example: "NG" },
        },
      },
      IndividualMerchantSignupRequest: {
        type: "object",
        description:
          "Use this when the merchant is an individual. legalName is the account holder's real name. displayName is optional and becomes the billing workspace display name.",
        required: [
          "type",
          "email",
          "password",
          "legalName",
          "contactPhone",
        ],
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: ["INDIVIDUAL"],
            description: "Fixed discriminator value for individual signup.",
            example: "INDIVIDUAL",
          },
          email: { type: "string", format: "email", example: "ada@example.com" },
          password: { type: "string", format: "password", minLength: 8 },
          legalName: { type: "string", example: "Ada Okafor" },
          displayName: {
            type: "string",
            example: "Ada Billing Studio",
            description:
              "Optional public/workspace display name. If omitted, legalName is used.",
          },
          contactPhone: { type: "string", example: "+2348012345678" },
          country: { type: "string", default: "NG", example: "NG" },
        },
      },
      MerchantVerifyEmailRequest: {
        type: "object",
        required: ["email", "token"],
        properties: {
          email: { type: "string", format: "email", example: "ada@acme.com" },
          token: { type: "string", example: "email-token-from-verification-link" },
        },
      },
      MerchantLoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email", example: "ada@acme.com" },
          password: { type: "string", format: "password", minLength: 8 },
        },
      },
      MerchantForgotPasswordRequest: {
        type: "object",
        required: ["email"],
        properties: {
          email: { type: "string", format: "email", example: "ada@acme.com" },
        },
      },
      MerchantResetPasswordRequest: {
        type: "object",
        required: ["email", "token", "password"],
        properties: {
          email: { type: "string", format: "email", example: "ada@acme.com" },
          token: {
            type: "string",
            example: "password-reset-token-from-email-link",
          },
          password: {
            type: "string",
            format: "password",
            minLength: 8,
            maxLength: 128,
          },
        },
      },
      MerchantAuthResponse: {
        type: "object",
        properties: {
          accessToken: {
            type: "string",
            description:
              "Short-lived dashboard access token. Use as the merchantSession Bearer token.",
          },
          token: {
            type: "string",
            description:
              "Backward-compatible alias of accessToken. Prefer accessToken in new clients.",
          },
          tokenType: { type: "string", enum: ["Bearer"], example: "Bearer" },
          expiresIn: {
            type: "integer",
            example: 900,
            description: "Access token lifetime in seconds.",
          },
          refreshToken: {
            type: "string",
            description:
              "Long-lived opaque refresh token. Store securely and exchange at /api/v1/merchants/refresh.",
          },
          refreshTokenExpiresAt: { type: "string", format: "date-time" },
          refreshTokenTtlDays: { type: "integer", example: 30 },
          session: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              userAgent: { type: "string", nullable: true },
              ipAddress: { type: "string", nullable: true },
              createdAt: { type: "string", format: "date-time" },
              expiresAt: { type: "string", format: "date-time" },
            },
          },
        },
      },
      MerchantAuthSuccessResponse: {
        allOf: [
          { $ref: "#/components/schemas/SuccessResponse" },
          {
            type: "object",
            properties: {
              data: { $ref: "#/components/schemas/MerchantAuthResponse" },
            },
          },
        ],
      },
      MerchantRefreshSessionRequest: {
        type: "object",
        required: ["refreshToken"],
        properties: {
          refreshToken: {
            type: "string",
            example: "mrt_refresh_token_returned_from_login_or_verify_email",
          },
        },
      },
      MerchantLogoutRequest: {
        type: "object",
        properties: {
          refreshToken: {
            type: "string",
            description:
              "Optional. If supplied, this exact refresh token is revoked together with the current access-token session.",
            example: "mrt_refresh_token_returned_from_login_or_verify_email",
          },
        },
      },
      UpdateMerchantProfileRequest: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 2, example: "Ada Okafor" },
        },
      },
      BusinessCreateRequest: {
        oneOf: [
          { $ref: "#/components/schemas/BusinessProfileCreateRequest" },
          { $ref: "#/components/schemas/IndividualBusinessCreateRequest" },
        ],
        discriminator: {
          propertyName: "type",
          mapping: {
            BUSINESS: "#/components/schemas/BusinessProfileCreateRequest",
            INDIVIDUAL: "#/components/schemas/IndividualBusinessCreateRequest",
          },
        },
        description:
          "Choose BUSINESS for a company workspace. Choose INDIVIDUAL for a personal workspace.",
      },
      BusinessProfileCreateRequest: {
        type: "object",
        description:
          "Creates a company/business workspace owned by the logged-in merchant.",
        required: ["type", "businessName", "contactName", "contactEmail", "contactPhone"],
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: ["BUSINESS"],
            description: "Fixed discriminator value for business workspace creation.",
            example: "BUSINESS",
          },
          businessName: { type: "string", example: "Acme School" },
          businessRegistrationNumber: { type: "string", example: "RC123456" },
          taxId: { type: "string", example: "TIN123456" },
          website: { type: "string", format: "uri", example: "https://school.acme.com" },
          contactName: { type: "string", example: "Ada Okafor" },
          contactEmail: { type: "string", format: "email", example: "billing@school.acme.com" },
          contactPhone: { type: "string", example: "+2348012345678" },
          country: { type: "string", default: "NG", example: "NG" },
        },
      },
      IndividualBusinessCreateRequest: {
        type: "object",
        description:
          "Creates an individual/personal workspace owned by the logged-in merchant.",
        required: ["type", "legalName", "contactName", "contactEmail", "contactPhone"],
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: ["INDIVIDUAL"],
            description: "Fixed discriminator value for individual workspace creation.",
            example: "INDIVIDUAL",
          },
          legalName: { type: "string", example: "Ada Okafor" },
          contactName: { type: "string", example: "Ada Okafor" },
          contactEmail: { type: "string", format: "email", example: "ada@example.com" },
          contactPhone: { type: "string", example: "+2348012345678" },
          country: { type: "string", default: "NG", example: "NG" },
        },
      },
      BusinessUpdateRequest: {
        type: "object",
        description:
          "Update business workspace details. If changing type, include businessName for BUSINESS or legalName for INDIVIDUAL.",
        additionalProperties: false,
        properties: {
          type: { $ref: "#/components/schemas/BusinessType" },
          businessName: { type: "string", example: "Acme School" },
          businessRegistrationNumber: { type: "string", example: "RC123456" },
          taxId: { type: "string", example: "TIN123456" },
          website: {
            type: "string",
            format: "uri",
            example: "https://school.acme.com",
          },
          legalName: { type: "string", example: "Ada Okafor" },
          contactName: { type: "string", example: "Ada Okafor" },
          contactEmail: {
            type: "string",
            format: "email",
            example: "billing@school.acme.com",
          },
          contactPhone: { type: "string", example: "+2348012345678" },
          country: { type: "string", example: "NG" },
        },
      },
      ApiKeyCreateRequest: {
        type: "object",
        required: ["name", "mode"],
        properties: {
          name: { type: "string", example: "Production server key" },
          mode: { $ref: "#/components/schemas/ApiKeyMode" },
          expiresAt: {
            type: "string",
            format: "date-time",
            description: "Optional. If omitted, the key does not expire automatically.",
          },
        },
      },
      PlanCreateRequest: {
        type: "object",
        required: ["name", "code", "amountMinor", "interval"],
        properties: {
          name: { type: "string", example: "Pro Monthly" },
          code: { type: "string", example: "pro_monthly" },
          amountMinor: {
            type: "integer",
            minimum: 100,
            maximum: 500000000,
            example: 500000,
            description:
              "Amount in minor units. For NGN, 500000 means NGN 5,000.00. Floating/decimal amounts are not accepted.",
          },
          currency: { $ref: "#/components/schemas/Currency" },
          interval: { $ref: "#/components/schemas/BillingInterval" },
          intervalCount: { type: "integer", default: 1, example: 1 },
          trialDays: { type: "integer", default: 0, example: 14 },
          metadata: { type: "object", additionalProperties: true },
        },
      },
      CustomerCreateRequest: {
        type: "object",
        required: ["email"],
        properties: {
          email: { type: "string", format: "email", example: "john@example.com" },
          name: { type: "string", example: "John Doe" },
          phone: { type: "string", example: "08000000000" },
          externalReference: { type: "string", example: "merchant-user-123" },
          metadata: { type: "object", additionalProperties: true },
        },
      },
      CustomerStatusUpdateRequest: {
        type: "object",
        required: ["status"],
        properties: {
          status: { $ref: "#/components/schemas/CustomerStatus" },
        },
      },
      PaymentMethodSetupCheckoutRequest: {
        type: "object",
        properties: {
          callbackUrl: {
            type: "string",
            format: "uri",
            example: "https://merchant.app/billing/payment-method/callback",
          },
          metadata: { type: "object", additionalProperties: true },
        },
      },
      SubscriptionCreateRequest: {
        type: "object",
        required: ["customerId", "planId", "paymentMethodId"],
        properties: {
          customerId: {
            type: "string",
            format: "uuid",
            example: "0b7867f2-8b5b-4c55-92ed-63e53e663768",
          },
          planId: {
            type: "string",
            format: "uuid",
            example: "56e2b8b5-4f73-4c13-af9e-f9a83684d1a7",
          },
          paymentMethodId: {
            type: "string",
            format: "uuid",
            example: "74af31ff-f7a8-444c-bf44-930c3d9249d5",
          },
          trialDays: {
            type: "integer",
            minimum: 0,
            maximum: 365,
            example: 14,
            description:
              "Optional override. If omitted, the plan trialDays value is used.",
          },
          metadata: { type: "object", additionalProperties: true },
        },
      },
      SubscriptionCancelRequest: {
        type: "object",
        properties: {
          cancelAtPeriodEnd: {
            type: "boolean",
            default: false,
            description:
              "When true, keeps the subscription usable until currentPeriodEnd. The billing worker cancels it instead of billing the next period.",
          },
        },
      },
      InvoicePayRequest: {
        type: "object",
        properties: {
          metadata: {
            type: "object",
            additionalProperties: true,
            description:
              "Optional merchant metadata attached to the Nomba charge request.",
            example: { source: "dashboard_retry" },
          },
        },
      },
      DevNombaWebhookSimulateRequest: {
        type: "object",
        required: ["merchantTxRef", "amountMinor"],
        properties: {
          merchantTxRef: {
            type: "string",
            example: "recur_attempt_8f5f0d8b-8899-4b41-97b4-98cc3c8d13ec",
            description:
              "Must match PaymentAttempt.providerReference for payment settlement testing.",
          },
          amountMinor: {
            type: "integer",
            example: 500000,
            description:
              "Amount in kobo/minor units. The simulator converts it to Nomba sandbox major-unit webhook amount.",
          },
          currency: { $ref: "#/components/schemas/Currency" },
          eventType: {
            type: "string",
            enum: ["payment_success", "payment_failed"],
            default: "payment_success",
          },
          orderReference: { type: "string", example: "test-order-001" },
          requestId: {
            type: "string",
            example: "550e8400-e29b-41d4-a716-446655440000",
          },
          transactionId: {
            type: "string",
            example: "WEB-ONLINE_C-dev-550e8400-e29b-41d4-a716-446655440000",
          },
          customerEmail: {
            type: "string",
            format: "email",
            example: "test@example.com",
          },
          mode: { $ref: "#/components/schemas/ApiKeyMode" },
          skipTransactionVerification: {
            type: "boolean",
            default: true,
            description:
              "Development convenience. When true, the simulator does not call Nomba transaction lookup before settling the payment attempt.",
          },
        },
      },
      DevRunDueBillingRequest: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 20,
            example: 20,
          },
          mode: { $ref: "#/components/schemas/ApiKeyMode" },
          subscriptionId: {
            type: "string",
            format: "uuid",
            description:
              "Optional. Process only one subscription, useful for local testing.",
          },
          skipTransactionVerification: {
            type: "boolean",
            default: true,
            description:
              "Development convenience. When true, a successful provider charge can settle without calling transaction lookup.",
          },
        },
      },
    },
    parameters: {
      Limit: {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        description: "Maximum records to return.",
      },
      Cursor: {
        name: "cursor",
        in: "query",
        required: false,
        schema: { type: "string", format: "uuid" },
        description: "Cursor from the previous response pagination.nextCursor.",
      },
      CreatedFrom: {
        name: "createdFrom",
        in: "query",
        required: false,
        schema: { type: "string", format: "date-time" },
      },
      CreatedTo: {
        name: "createdTo",
        in: "query",
        required: false,
        schema: { type: "string", format: "date-time" },
      },
    },
  },
  tags: [
    { name: "Health" },
    { name: "Merchants" },
    { name: "Businesses" },
    { name: "API Keys" },
    { name: "Plans" },
    { name: "Customers" },
    { name: "Payment Methods" },
    { name: "Subscriptions" },
    { name: "Invoices" },
    { name: "Payment Attempts" },
    { name: "Webhooks" },
    { name: "Development" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Health check",
        responses: { "200": { description: "Service is reachable" } },
      },
    },
    "/api/v1/dev/webhooks/nomba/simulate": {
      post: {
        tags: ["Development"],
        summary: "Simulate a signed Nomba webhook locally",
        description:
          "Development-only endpoint. Disabled in production. Creates a Nomba-shaped webhook payload, signs it with NOMBA_WEBHOOK_SECRET, stores it, and runs the webhook processor.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/DevNombaWebhookSimulateRequest",
              },
              examples: {
                paymentSuccess: {
                  value: {
                    merchantTxRef:
                      "recur_attempt_8f5f0d8b-8899-4b41-97b4-98cc3c8d13ec",
                    amountMinor: 500000,
                    currency: "NGN",
                    eventType: "payment_success",
                    orderReference: "test-order-001",
                    customerEmail: "test@example.com",
                    mode: "TEST",
                    skipTransactionVerification: true,
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Nomba webhook simulated" },
          "404": { description: "Not available in production" },
        },
      },
    },
    "/api/v1/dev/billing/run-due": {
      post: {
        tags: ["Development"],
        summary: "Manually run due subscription billing",
        description:
          "Development-only endpoint. Disabled in production. Finds due ACTIVE/TRIALING subscriptions, creates renewal invoice/payment attempt, and charges the saved payment method.",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DevRunDueBillingRequest" },
              examples: {
                default: {
                  value: {
                    limit: 20,
                    mode: "TEST",
                    skipTransactionVerification: true,
                  },
                },
                singleSubscription: {
                  value: {
                    subscriptionId: "0b7867f2-8b5b-4c55-92ed-63e53e663768",
                    skipTransactionVerification: true,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Due billing run completed" },
          "404": { description: "Not available in production" },
        },
      },
    },
    "/api/v1/merchants/signup": {
      post: {
        tags: ["Merchants"],
        summary: "Sign up a merchant and create the first pending business",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/MerchantSignupRequest" },
              examples: {
                business: {
                  summary: "Business merchant",
                  value: {
                    type: "BUSINESS",
                    email: "ada@acme.com",
                    password: "StrongPassword123!",
                    name: "Ada Okafor",
                    businessName: "Acme SaaS Ltd",
                    businessRegistrationNumber: "RC123456",
                    taxId: "TIN123456",
                    website: "https://acme.com",
                    contactName: "Ada Okafor",
                    contactPhone: "+2348012345678",
                    country: "NG",
                  },
                },
                individual: {
                  summary: "Individual merchant",
                  value: {
                    type: "INDIVIDUAL",
                    email: "ada@example.com",
                    password: "StrongPassword123!",
                    legalName: "Ada Okafor",
                    displayName: "Ada Billing Studio",
                    contactPhone: "+2348012345678",
                    country: "NG",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description:
              "Merchant created pending email verification. Testing mode currently returns verificationToken and verificationUrl directly instead of sending email.",
          },
        },
      },
    },
    "/api/v1/merchants/verify-email": {
      get: {
        tags: ["Merchants"],
        summary: "Verify merchant email from emailed link",
        parameters: [
          {
            name: "email",
            in: "query",
            required: true,
            schema: { type: "string", format: "email" },
            example: "ada@acme.com",
          },
          {
            name: "token",
            in: "query",
            required: true,
            schema: { type: "string" },
            example: "email-token-from-verification-link",
          },
        ],
        responses: {
          "200": {
            description:
              "Merchant activated and dashboard access/refresh tokens returned",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MerchantAuthSuccessResponse" },
              },
            },
          },
        },
      },
      post: {
        tags: ["Merchants"],
        summary: "Verify merchant email and return dashboard tokens",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/MerchantVerifyEmailRequest" },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Merchant activated and dashboard access/refresh tokens returned",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MerchantAuthSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/api/v1/merchants/login": {
      post: {
        tags: ["Merchants"],
        summary: "Log in merchant dashboard user",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/MerchantLoginRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Dashboard access/refresh tokens returned",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MerchantAuthSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/api/v1/merchants/forgot-password": {
      post: {
        tags: ["Merchants"],
        summary: "Request merchant password reset token",
        description:
          "Testing mode currently returns resetToken and resetUrl directly for existing accounts instead of sending email.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/MerchantForgotPasswordRequest" },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Password reset token created if the merchant account exists. Testing mode returns resetToken and resetUrl directly.",
          },
        },
      },
    },
    "/api/v1/merchants/reset-password": {
      post: {
        tags: ["Merchants"],
        summary: "Consume password reset token and set new password",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/MerchantResetPasswordRequest" },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Password reset successfully. Existing merchant sessions are revoked.",
          },
        },
      },
    },
    "/api/v1/merchants/refresh": {
      post: {
        tags: ["Merchants"],
        summary: "Rotate refresh token and return a new dashboard session",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/MerchantRefreshSessionRequest" },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Old refresh token revoked and new access/refresh tokens returned",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MerchantAuthSuccessResponse" },
              },
            },
          },
        },
      },
    },
    "/api/v1/merchants/logout": {
      post: {
        tags: ["Merchants"],
        security: [{ merchantSession: [] }],
        summary: "Revoke the current merchant session",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/MerchantLogoutRequest" },
            },
          },
        },
        responses: { "200": { description: "Current merchant session revoked" } },
      },
    },
    "/api/v1/merchants/me": {
      get: {
        tags: ["Merchants"],
        security: [{ merchantSession: [] }],
        summary: "Get current merchant user and businesses",
        responses: { "200": { description: "Merchant user returned" } },
      },
      patch: {
        tags: ["Merchants"],
        security: [{ merchantSession: [] }],
        summary: "Update current merchant profile",
        description:
          "Updates dashboard profile details. Email changes require a separate re-verification flow and are not handled here.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateMerchantProfileRequest" },
              example: { name: "Ada Okafor" },
            },
          },
        },
        responses: {
          "200": { description: "Merchant profile updated" },
          "400": {
            description: "Invalid update payload",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/api/v1/businesses": {
      get: {
        tags: ["Businesses"],
        security: [{ merchantSession: [] }],
        summary: "List merchant businesses",
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Cursor" },
          {
            name: "status",
            in: "query",
            required: false,
            schema: { $ref: "#/components/schemas/BusinessStatus" },
          },
          { $ref: "#/components/parameters/CreatedFrom" },
          { $ref: "#/components/parameters/CreatedTo" },
        ],
        responses: { "200": { description: "Businesses returned" } },
      },
      post: {
        tags: ["Businesses"],
        security: [{ merchantSession: [] }],
        summary: "Create another business for the merchant",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BusinessCreateRequest" },
              examples: {
                business: {
                  summary: "Business workspace",
                  value: {
                    type: "BUSINESS",
                    businessName: "Acme School",
                    businessRegistrationNumber: "RC123456",
                    taxId: "TIN123456",
                    website: "https://school.acme.com",
                    contactName: "Ada Okafor",
                    contactEmail: "billing@school.acme.com",
                    contactPhone: "+2348012345678",
                    country: "NG",
                  },
                },
                individual: {
                  summary: "Individual workspace",
                  value: {
                    type: "INDIVIDUAL",
                    legalName: "Ada Okafor",
                    contactName: "Ada Okafor",
                    contactEmail: "ada@example.com",
                    contactPhone: "+2348012345678",
                    country: "NG",
                  },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Business created" } },
      },
    },
    "/api/v1/businesses/{businessId}": {
      get: {
        tags: ["Businesses"],
        security: [{ merchantSession: [] }],
        summary: "Get one merchant business",
        parameters: [
          {
            name: "businessId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": { description: "Business returned" },
          "404": {
            description: "Business not found or merchant has no access",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
      patch: {
        tags: ["Businesses"],
        security: [{ merchantSession: [] }],
        summary: "Update business details",
        description:
          "Requires OWNER or ADMIN membership. Use this to update business profile/contact details.",
        parameters: [
          {
            name: "businessId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BusinessUpdateRequest" },
              examples: {
                businessDetails: {
                  summary: "Update business profile",
                  value: {
                    businessName: "Acme School Plus",
                    website: "https://school.acme.com",
                    contactName: "Ada Okafor",
                    contactEmail: "billing@school.acme.com",
                    contactPhone: "+2348012345678",
                  },
                },
                switchToIndividual: {
                  summary: "Switch to individual profile",
                  value: {
                    type: "INDIVIDUAL",
                    legalName: "Ada Okafor",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Business updated" },
          "400": {
            description: "Invalid update payload",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "404": {
            description: "Business not found or merchant cannot update it",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/api/v1/businesses/{businessId}/api-keys": {
      get: {
        tags: ["API Keys"],
        security: [{ merchantSession: [] }],
        summary: "List API keys for a business",
        parameters: [
          { name: "businessId", in: "path", required: true, schema: { type: "string" } },
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Cursor" },
          {
            name: "status",
            in: "query",
            required: false,
            schema: { $ref: "#/components/schemas/ApiKeyListStatus" },
          },
          {
            name: "mode",
            in: "query",
            required: false,
            schema: { $ref: "#/components/schemas/ApiKeyMode" },
          },
          { $ref: "#/components/parameters/CreatedFrom" },
          { $ref: "#/components/parameters/CreatedTo" },
        ],
        responses: { "200": { description: "API keys returned without secrets" } },
      },
      post: {
        tags: ["API Keys"],
        security: [{ merchantSession: [] }],
        summary: "Create TEST or LIVE API key for a business",
        parameters: [{ name: "businessId", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ApiKeyCreateRequest" },
              examples: {
                test: { value: { name: "Sandbox key", mode: "TEST" } },
                live: { value: { name: "Production key", mode: "LIVE" } },
              },
            },
          },
        },
        responses: { "201": { description: "Raw API key returned once" } },
      },
    },
    "/api/v1/businesses/{businessId}/api-keys/{id}/revoke": {
      post: {
        tags: ["API Keys"],
        security: [{ merchantSession: [] }],
        summary: "Revoke an API key",
        parameters: [
          { name: "businessId", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "API key revoked" } },
      },
    },
    "/api/v1/plans": {
      post: {
        tags: ["Plans"],
        security: [{ businessApiKey: [] }],
        summary: "Create plan under API key business/mode",
        description:
          "The plan is tagged with the API key mode. sk_test creates TEST plans; sk_live creates LIVE plans.",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: false,
            schema: { $ref: "#/components/schemas/IdempotencyKeyHeader" },
          },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/PlanCreateRequest" } } },
        },
        responses: {
          "201": { description: "Plan created" },
          "409": {
            description:
              "Idempotency key is already processing or was reused with a different payload",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
      get: {
        tags: ["Plans"],
        security: [{ businessApiKey: [] }],
        summary: "List plans under API key business/mode",
        description:
          "Only returns plans matching the API key mode. sk_test cannot list LIVE plans and sk_live cannot list TEST plans.",
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Cursor" },
          {
            name: "status",
            in: "query",
            required: false,
            schema: { $ref: "#/components/schemas/PlanStatus" },
          },
          { $ref: "#/components/parameters/CreatedFrom" },
          { $ref: "#/components/parameters/CreatedTo" },
        ],
        responses: { "200": { description: "Plans returned" } },
      },
    },
    "/api/v1/customers": {
      post: {
        tags: ["Customers"],
        security: [{ businessApiKey: [] }],
        summary: "Create customer under API key business/mode",
        description:
          "The customer is tagged with the API key mode. sk_test creates TEST customers; sk_live creates LIVE customers.",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: false,
            schema: { $ref: "#/components/schemas/IdempotencyKeyHeader" },
          },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CustomerCreateRequest" } } },
        },
        responses: {
          "201": { description: "Customer created" },
          "409": {
            description:
              "Idempotency key is already processing or was reused with a different payload",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
      get: {
        tags: ["Customers"],
        security: [{ businessApiKey: [] }],
        summary: "List customers under API key business/mode",
        description:
          "Only returns customers matching the API key mode. sk_test cannot list LIVE customers and sk_live cannot list TEST customers.",
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Cursor" },
          {
            name: "status",
            in: "query",
            required: false,
            schema: { $ref: "#/components/schemas/CustomerStatus" },
          },
          { $ref: "#/components/parameters/CreatedFrom" },
          { $ref: "#/components/parameters/CreatedTo" },
        ],
        responses: { "200": { description: "Customers returned" } },
      },
    },
    "/api/v1/customers/{id}/status": {
      post: {
        tags: ["Customers"],
        security: [{ businessApiKey: [] }],
        summary: "Update customer lifecycle status",
        description:
          "Soft lifecycle update scoped by API key mode. Use DISABLED instead of deleting customer records.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CustomerStatusUpdateRequest" },
              examples: {
                disable: { value: { status: "DISABLED" } },
                reactivate: { value: { status: "ACTIVE" } },
              },
            },
          },
        },
        responses: { "200": { description: "Customer status updated" } },
      },
    },
    "/api/v1/customers/{id}/payment-methods/setup-checkout": {
      post: {
        tags: ["Payment Methods"],
        security: [{ businessApiKey: [] }],
        summary: "Create Nomba checkout for reusable payment method setup",
        description:
          "Creates a pending payment method and returns a provider checkout URL. Customer, business, and TEST/LIVE mode are resolved from the API key. Recurr never collects raw card data.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          {
            name: "Idempotency-Key",
            in: "header",
            required: false,
            schema: { $ref: "#/components/schemas/IdempotencyKeyHeader" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/PaymentMethodSetupCheckoutRequest",
              },
              examples: {
                default: {
                  value: {
                    callbackUrl:
                      "https://merchant.app/billing/payment-method/callback",
                    metadata: { source: "mobile_app" },
                  },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Payment method setup checkout created" } },
      },
    },
    "/api/v1/customers/{id}/payment-methods": {
      get: {
        tags: ["Payment Methods"],
        security: [{ businessApiKey: [] }],
        summary: "List customer payment methods",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          {
            name: "status",
            in: "query",
            required: false,
            schema: { $ref: "#/components/schemas/PaymentMethodStatus" },
          },
        ],
        responses: { "200": { description: "Payment methods returned" } },
      },
    },
    "/api/v1/customers/{id}/payment-methods/{paymentMethodId}": {
      delete: {
        tags: ["Payment Methods"],
        security: [{ businessApiKey: [] }],
        summary: "Revoke a customer payment method",
        description:
          "Soft lifecycle action. Sets the payment method to DISABLED and reusable=false. Refuses revocation while attached to an open subscription.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "paymentMethodId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Payment method revoked" },
          "409": { description: "Payment method is attached to an open subscription" },
        },
      },
    },
    "/api/v1/customers/{id}": {
      delete: {
        tags: ["Customers"],
        security: [{ businessApiKey: [] }],
        summary: "Disable customer",
        description:
          "Soft delete. Sets customer status to DISABLED; the row is retained for audit/history.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": { description: "Customer disabled" } },
      },
    },
    "/api/v1/subscriptions": {
      post: {
        tags: ["Subscriptions"],
        security: [{ businessApiKey: [] }],
        summary: "Create subscription under API key business/mode",
        description:
          "Creates a subscription for an active customer, active plan, and active reusable payment method. If there is no trial, the first invoice and a pending payment attempt are created.",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: false,
            schema: { $ref: "#/components/schemas/IdempotencyKeyHeader" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SubscriptionCreateRequest" },
            },
          },
        },
        responses: {
          "201": { description: "Subscription created" },
          "409": { description: "Duplicate/open subscription or invalid lifecycle state" },
        },
      },
      get: {
        tags: ["Subscriptions"],
        security: [{ businessApiKey: [] }],
        summary: "List subscriptions under API key business/mode",
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Cursor" },
          {
            name: "status",
            in: "query",
            required: false,
            schema: { $ref: "#/components/schemas/SubscriptionStatus" },
          },
          { $ref: "#/components/parameters/CreatedFrom" },
          { $ref: "#/components/parameters/CreatedTo" },
        ],
        responses: { "200": { description: "Subscriptions returned" } },
      },
    },
    "/api/v1/subscriptions/{id}": {
      get: {
        tags: ["Subscriptions"],
        security: [{ businessApiKey: [] }],
        summary: "Get subscription with customer, plan, payment method, and invoices",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": { description: "Subscription returned" } },
      },
    },
    "/api/v1/subscriptions/{id}/pause": {
      post: {
        tags: ["Subscriptions"],
        security: [{ businessApiKey: [] }],
        summary: "Pause subscription",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": { description: "Subscription paused" } },
      },
    },
    "/api/v1/subscriptions/{id}/resume": {
      post: {
        tags: ["Subscriptions"],
        security: [{ businessApiKey: [] }],
        summary: "Resume paused or past-due subscription",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": { description: "Subscription resumed" } },
      },
    },
    "/api/v1/subscriptions/{id}/cancel": {
      post: {
        tags: ["Subscriptions"],
        security: [{ businessApiKey: [] }],
        summary: "Cancel subscription now or at period end",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SubscriptionCancelRequest" },
              examples: {
                immediate: { value: { cancelAtPeriodEnd: false } },
                periodEnd: { value: { cancelAtPeriodEnd: true } },
              },
            },
          },
        },
        responses: { "200": { description: "Subscription cancelled or scheduled to cancel" } },
      },
    },
    "/api/v1/invoices": {
      get: {
        tags: ["Invoices"],
        security: [{ businessApiKey: [] }],
        summary: "List invoices under API key business/mode",
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Cursor" },
          {
            name: "status",
            in: "query",
            required: false,
            schema: { $ref: "#/components/schemas/InvoiceStatus" },
          },
          {
            name: "subscriptionId",
            in: "query",
            required: false,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "customerId",
            in: "query",
            required: false,
            schema: { type: "string", format: "uuid" },
          },
          { $ref: "#/components/parameters/CreatedFrom" },
          { $ref: "#/components/parameters/CreatedTo" },
        ],
        responses: { "200": { description: "Invoices returned" } },
      },
    },
    "/api/v1/invoices/{id}": {
      get: {
        tags: ["Invoices"],
        security: [{ businessApiKey: [] }],
        summary: "Get invoice with items, payment attempts, and dunning attempts",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": { description: "Invoice returned" } },
      },
    },
    "/api/v1/invoices/{id}/pay": {
      post: {
        tags: ["Invoices"],
        security: [{ businessApiKey: [] }],
        summary: "Manually charge the saved payment method for an invoice",
        description:
          "Creates a new payment attempt for an OPEN or PAYMENT_FAILED invoice, charges the subscription's active reusable payment method through Nomba, and updates invoice/subscription state. Use Idempotency-Key for safe retries.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          {
            name: "Idempotency-Key",
            in: "header",
            required: false,
            schema: { $ref: "#/components/schemas/IdempotencyKeyHeader" },
          },
        ],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/InvoicePayRequest" },
              examples: {
                default: {
                  value: { metadata: { source: "dashboard_retry" } },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Payment attempt created. Invoice may be paid, failed, or still processing depending on provider result.",
          },
          "409": {
            description:
              "Invoice is already paid, not payable, already processing, or payment method is unusable.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "502": {
            description: "Nomba charge request failed after the payment attempt was recorded.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/api/v1/payment-attempts": {
      get: {
        tags: ["Payment Attempts"],
        security: [{ businessApiKey: [] }],
        summary: "List payment attempts under API key business/mode",
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Cursor" },
          {
            name: "status",
            in: "query",
            required: false,
            schema: { $ref: "#/components/schemas/PaymentAttemptStatus" },
          },
          {
            name: "invoiceId",
            in: "query",
            required: false,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "subscriptionId",
            in: "query",
            required: false,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "customerId",
            in: "query",
            required: false,
            schema: { type: "string", format: "uuid" },
          },
          { $ref: "#/components/parameters/CreatedFrom" },
          { $ref: "#/components/parameters/CreatedTo" },
        ],
        responses: { "200": { description: "Payment attempts returned" } },
      },
    },
    "/api/v1/payment-attempts/{id}": {
      get: {
        tags: ["Payment Attempts"],
        security: [{ businessApiKey: [] }],
        summary: "Get one payment attempt with invoice, subscription, customer, and payment method",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: {
          "200": { description: "Payment attempt returned" },
          "404": {
            description: "Payment attempt not found under the API key business/mode",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/api/v1/webhooks/events": {
      get: {
        tags: ["Webhooks"],
        security: [{ merchantSession: [] }],
        summary: "List stored webhook events",
        description:
          "Dashboard/testing endpoint for inspecting provider webhooks Recurr has received and stored. Use the merchant dashboard access token, not a business API key.",
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Cursor" },
          {
            name: "provider",
            in: "query",
            required: false,
            schema: { type: "string", default: "nomba", example: "nomba" },
          },
          {
            name: "mode",
            in: "query",
            required: false,
            schema: { $ref: "#/components/schemas/ApiKeyMode" },
          },
          {
            name: "status",
            in: "query",
            required: false,
            schema: { $ref: "#/components/schemas/WebhookEventStatus" },
          },
          {
            name: "eventType",
            in: "query",
            required: false,
            schema: { type: "string", example: "payment_success" },
          },
          {
            name: "providerEventId",
            in: "query",
            required: false,
            schema: { type: "string", example: "req_3f9a2c" },
          },
          { $ref: "#/components/parameters/CreatedFrom" },
          { $ref: "#/components/parameters/CreatedTo" },
        ],
        responses: {
          "200": { description: "Webhook events returned" },
          "401": {
            description: "Merchant dashboard session is missing or invalid",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/api/v1/webhooks/events/{id}": {
      get: {
        tags: ["Webhooks"],
        security: [{ merchantSession: [] }],
        summary: "Get one stored webhook event",
        description:
          "Returns the raw stored webhook payload, headers, processing status, and failure reason if processing failed.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": { description: "Webhook event returned" },
          "404": {
            description: "Webhook event not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/api/v1/webhooks/nomba": {
      post: {
        tags: ["Webhooks"],
        summary: "Receive verified Nomba webhook events",
        description:
          "Verifies the nomba-signature HMAC-SHA256 signature against the raw request body, stores the raw event, and treats payload requestId values idempotently. Timestamp tolerance is supported when a timestamp header is configured/sent.",
        parameters: [
          {
            name: "nomba-signature",
            in: "header",
            required: true,
            schema: { type: "string" },
            description:
              "Configurable with NOMBA_WEBHOOK_SIGNATURE_HEADER. HMAC-SHA256 hex digest of the raw body using NOMBA_WEBHOOK_SECRET.",
          },
          {
            name: "x-nomba-timestamp",
            in: "header",
            required: false,
            schema: { type: "string" },
            description:
              "Optional. Configurable with NOMBA_WEBHOOK_TIMESTAMP_HEADER. Required only when NOMBA_WEBHOOK_REQUIRE_TIMESTAMP=true.",
          },
          {
            name: "x-nomba-event-id",
            in: "header",
            required: false,
            schema: { type: "string" },
            description:
              "Optional. Configurable with NOMBA_WEBHOOK_EVENT_ID_HEADER. If absent, event.requestId is used for event idempotency.",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/NombaWebhookPayload" },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Webhook accepted. Duplicate provider events return duplicate=true and are not processed again.",
          },
          "400": {
            description: "Invalid webhook payload",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
          "401": {
            description: "Missing, expired, or invalid webhook signature/timestamp",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
  },
} as const;

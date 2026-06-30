export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Recurr API",
    version: "0.2.0",
    description:
      "Merchant-facing API for Recurr subscription and recurring billing infrastructure.",
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
            required: ["code", "message", "details"],
            properties: {
              code: {
                type: "string",
                example: "INVALID_CREDENTIALS",
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
          "Use this when the merchant is an individual collecting under their legal name.",
        required: [
          "type",
          "email",
          "password",
          "name",
          "legalName",
          "contactName",
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
          name: { type: "string", example: "Ada Okafor" },
          legalName: { type: "string", example: "Ada Okafor" },
          contactName: { type: "string", example: "Ada Okafor" },
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
          amountMinor: { type: "integer", example: 500000 },
          currency: { type: "string", default: "NGN", example: "NGN" },
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
    },
  },
  tags: [
    { name: "Health" },
    { name: "Merchants" },
    { name: "Businesses" },
    { name: "API Keys" },
    { name: "Plans" },
    { name: "Customers" },
    { name: "Webhooks" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Health check",
        responses: { "200": { description: "Service is reachable" } },
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
                    name: "Ada Okafor",
                    legalName: "Ada Okafor",
                    contactName: "Ada Okafor",
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
              "Merchant created pending email verification. In development, verificationToken and verificationUrl are returned for local testing. In production, the token is only sent by email.",
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
                schema: { $ref: "#/components/schemas/MerchantAuthResponse" },
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
                schema: { $ref: "#/components/schemas/MerchantAuthResponse" },
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
                schema: { $ref: "#/components/schemas/MerchantAuthResponse" },
              },
            },
          },
        },
      },
    },
    "/api/v1/merchants/forgot-password": {
      post: {
        tags: ["Merchants"],
        summary: "Request merchant password reset email",
        description:
          "Always returns a generic success message to avoid revealing whether an email is registered.",
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
              "Password reset email queued if the merchant account exists. In development, resetToken and resetUrl may be returned for local testing.",
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
                schema: { $ref: "#/components/schemas/MerchantAuthResponse" },
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
        parameters: [{ name: "businessId", in: "path", required: true, schema: { type: "string" } }],
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
        summary: "Create plan under API key business",
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
        summary: "List plans under API key business",
        responses: { "200": { description: "Plans returned" } },
      },
    },
    "/api/v1/customers": {
      post: {
        tags: ["Customers"],
        security: [{ businessApiKey: [] }],
        summary: "Create customer under API key business",
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
        summary: "List customers under API key business",
        responses: { "200": { description: "Customers returned" } },
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

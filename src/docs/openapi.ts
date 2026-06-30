export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Recurr API",
    version: "0.1.0",
    description:
      "Merchant-facing API for Recurr subscription and recurring billing infrastructure.",
  },
  servers: [
    {
      url: "/",
      description: "Current host",
    },
  ],
  components: {
    securitySchemes: {
      bearerApiKey: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "Recurr API key",
      },
    },
    schemas: {
      TenantCreateRequest: {
        oneOf: [
          { $ref: "#/components/schemas/BusinessTenantCreateRequest" },
          { $ref: "#/components/schemas/IndividualTenantCreateRequest" },
        ],
        discriminator: {
          propertyName: "type",
        },
      },
      BusinessTenantCreateRequest: {
        type: "object",
        required: ["type", "email", "businessName", "contactName", "contactPhone"],
        properties: {
          type: { type: "string", enum: ["BUSINESS"], example: "BUSINESS" },
          email: {
            type: "string",
            format: "email",
            example: "billing@acme.com",
          },
          businessName: { type: "string", example: "Acme SaaS Ltd" },
          businessRegistrationNumber: { type: "string", example: "RC123456" },
          taxId: { type: "string", example: "TIN123456" },
          website: { type: "string", format: "uri", example: "https://acme.com" },
          contactName: { type: "string", example: "Ada Okafor" },
          contactPhone: { type: "string", example: "+2348012345678" },
          country: { type: "string", example: "NG" },
          apiKeyName: { type: "string", example: "Production API key" },
        },
      },
      IndividualTenantCreateRequest: {
        type: "object",
        required: ["type", "email", "legalName", "contactName", "contactPhone"],
        properties: {
          type: { type: "string", enum: ["INDIVIDUAL"], example: "INDIVIDUAL" },
          email: {
            type: "string",
            format: "email",
            example: "ada@example.com",
          },
          legalName: { type: "string", example: "Ada Okafor" },
          contactName: { type: "string", example: "Ada Okafor" },
          contactPhone: { type: "string", example: "+2348012345678" },
          country: { type: "string", example: "NG" },
          apiKeyName: { type: "string", example: "Production API key" },
        },
      },
      TenantVerifyEmailRequest: {
        type: "object",
        required: ["email", "token"],
        properties: {
          email: { type: "string", format: "email", example: "billing@acme.com" },
          token: { type: "string", example: "email-token-from-verification-link" },
        },
      },
      PlanCreateRequest: {
        type: "object",
        required: ["name", "code", "amountMinor", "interval"],
        properties: {
          name: { type: "string", example: "Pro Monthly" },
          code: { type: "string", example: "pro_monthly" },
          amountMinor: { type: "integer", example: 500000 },
          currency: { type: "string", example: "NGN" },
          interval: {
            type: "string",
            enum: ["DAY", "WEEK", "MONTH", "YEAR", "CUSTOM"],
            example: "MONTH",
          },
          intervalCount: { type: "integer", example: 1 },
          trialDays: { type: "integer", example: 14 },
          metadata: {
            type: "object",
            additionalProperties: true,
            example: { users: 10, projects: 50 },
          },
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
          metadata: {
            type: "object",
            additionalProperties: true,
            example: { source: "merchant_app" },
          },
        },
      },
      ApiKeyCreateRequest: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", example: "Server integration key" },
        },
      },
      ErrorResponse: {
        type: "object",
        properties: {
          error: { type: "string" },
          details: {},
        },
      },
    },
  },
  tags: [
    { name: "Health" },
    { name: "Tenants" },
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
        responses: {
          "200": {
            description: "Service is reachable",
          },
        },
      },
    },
    "/api/v1/tenants": {
      post: {
        tags: ["Tenants"],
        summary: "Create a merchant tenant and first API key",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TenantCreateRequest" },
            },
          },
        },
        responses: {
          "201": {
            description:
              "Tenant created in PENDING_VERIFICATION. The raw API key and dev verification token are returned once.",
          },
          "409": { description: "Tenant email already exists" },
        },
      },
    },
    "/api/v1/tenants/verify-email": {
      post: {
        tags: ["Tenants"],
        summary: "Verify merchant email and activate tenant",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TenantVerifyEmailRequest" },
            },
          },
        },
        responses: {
          "200": { description: "Tenant email verified and tenant activated" },
          "400": { description: "Invalid verification token" },
          "404": { description: "Tenant not found" },
        },
      },
    },
    "/api/v1/api-keys": {
      get: {
        tags: ["API Keys"],
        security: [{ bearerApiKey: [] }],
        summary: "List API keys for the current tenant",
        responses: {
          "200": { description: "API keys returned without raw secrets" },
        },
      },
      post: {
        tags: ["API Keys"],
        security: [{ bearerApiKey: [] }],
        summary: "Create a new API key for the current tenant",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ApiKeyCreateRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "API key created. The raw API key is returned once.",
          },
        },
      },
    },
    "/api/v1/api-keys/{id}/revoke": {
      post: {
        tags: ["API Keys"],
        security: [{ bearerApiKey: [] }],
        summary: "Revoke an API key",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": { description: "API key revoked" },
          "400": { description: "Cannot revoke the key used by this request" },
          "404": { description: "API key not found" },
        },
      },
    },
    "/api/v1/plans": {
      get: {
        tags: ["Plans"],
        security: [{ bearerApiKey: [] }],
        summary: "List plans",
        responses: { "200": { description: "Plans returned" } },
      },
      post: {
        tags: ["Plans"],
        security: [{ bearerApiKey: [] }],
        summary: "Create a plan",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PlanCreateRequest" },
            },
          },
        },
        responses: { "201": { description: "Plan created" } },
      },
    },
    "/api/v1/plans/{id}": {
      get: {
        tags: ["Plans"],
        security: [{ bearerApiKey: [] }],
        summary: "Get a plan",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Plan returned" }, "404": { description: "Not found" } },
      },
      patch: {
        tags: ["Plans"],
        security: [{ bearerApiKey: [] }],
        summary: "Update a plan",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PlanCreateRequest" },
            },
          },
        },
        responses: { "200": { description: "Plan updated" }, "404": { description: "Not found" } },
      },
      delete: {
        tags: ["Plans"],
        security: [{ bearerApiKey: [] }],
        summary: "Archive a plan",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Plan archived" }, "404": { description: "Not found" } },
      },
    },
    "/api/v1/customers": {
      get: {
        tags: ["Customers"],
        security: [{ bearerApiKey: [] }],
        summary: "List customers",
        responses: { "200": { description: "Customers returned" } },
      },
      post: {
        tags: ["Customers"],
        security: [{ bearerApiKey: [] }],
        summary: "Create a customer",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CustomerCreateRequest" },
            },
          },
        },
        responses: { "201": { description: "Customer created" } },
      },
    },
    "/api/v1/customers/{id}": {
      get: {
        tags: ["Customers"],
        security: [{ bearerApiKey: [] }],
        summary: "Get a customer",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Customer returned" }, "404": { description: "Not found" } },
      },
      patch: {
        tags: ["Customers"],
        security: [{ bearerApiKey: [] }],
        summary: "Update a customer",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CustomerCreateRequest" },
            },
          },
        },
        responses: { "200": { description: "Customer updated" }, "404": { description: "Not found" } },
      },
    },
    "/api/v1/webhooks/nomba": {
      post: {
        tags: ["Webhooks"],
        summary: "Receive Nomba webhook events",
        responses: {
          "200": { description: "Webhook accepted" },
        },
      },
    },
  },
} as const;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openApiDocument = void 0;
exports.openApiDocument = {
    openapi: "3.0.3",
    info: {
        title: "Recurr API",
        version: "0.2.0",
        description: "Merchant-facing API for Recurr subscription and recurring billing infrastructure.",
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
            BusinessType: {
                type: "string",
                enum: ["BUSINESS", "INDIVIDUAL"],
                description: "Business profile type. BUSINESS requires businessName. INDIVIDUAL requires legalName.",
                example: "BUSINESS",
            },
            MerchantUserStatus: {
                type: "string",
                enum: ["PENDING_VERIFICATION", "ACTIVE", "DISABLED"],
                description: "Merchant dashboard account status. PENDING_VERIFICATION cannot use dashboard APIs until email is verified.",
            },
            BusinessStatus: {
                type: "string",
                enum: ["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED"],
                description: "Business workspace status. Only ACTIVE businesses should be allowed to bill with API keys.",
            },
            BusinessMemberRole: {
                type: "string",
                enum: ["OWNER", "ADMIN", "DEVELOPER", "SUPPORT"],
                description: "Dashboard role for a merchant user inside a business workspace.",
            },
            ApiKeyMode: {
                type: "string",
                enum: ["TEST", "LIVE"],
                description: "TEST keys are for sandbox integrations. LIVE keys are for production billing.",
                example: "TEST",
            },
            BillingInterval: {
                type: "string",
                enum: ["DAY", "WEEK", "MONTH", "YEAR", "CUSTOM"],
                description: "Plan billing cadence. CUSTOM still requires intervalCount to define the cycle.",
                example: "MONTH",
            },
            PlanStatus: {
                type: "string",
                enum: ["ACTIVE", "PAUSED", "ARCHIVED"],
                description: "Plan lifecycle status. New plans are normally ACTIVE.",
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
                description: "Choose BUSINESS for a registered/company merchant. Choose INDIVIDUAL for a personal merchant profile.",
            },
            BusinessMerchantSignupRequest: {
                type: "object",
                description: "Use this when the merchant is signing up on behalf of a business/company.",
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
                description: "Use this when the merchant is an individual collecting under their legal name.",
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
                description: "Choose BUSINESS for a company workspace. Choose INDIVIDUAL for a personal workspace.",
            },
            BusinessProfileCreateRequest: {
                type: "object",
                description: "Creates a company/business workspace owned by the logged-in merchant.",
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
                description: "Creates an individual/personal workspace owned by the logged-in merchant.",
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
                responses: { "201": { description: "Merchant created pending email verification" } },
            },
        },
        "/api/v1/merchants/verify-email": {
            post: {
                tags: ["Merchants"],
                summary: "Verify merchant email and return dashboard JWT",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/MerchantVerifyEmailRequest" },
                        },
                    },
                },
                responses: { "200": { description: "Merchant activated and dashboard token returned" } },
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
                responses: { "200": { description: "Dashboard token returned" } },
            },
        },
        "/api/v1/merchants/me": {
            get: {
                tags: ["Merchants"],
                security: [{ merchantSession: [] }],
                summary: "Get current merchant user and businesses",
                responses: { "200": { description: "Merchant user returned" } },
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
                requestBody: {
                    required: true,
                    content: { "application/json": { schema: { $ref: "#/components/schemas/PlanCreateRequest" } } },
                },
                responses: { "201": { description: "Plan created" } },
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
                requestBody: {
                    required: true,
                    content: { "application/json": { schema: { $ref: "#/components/schemas/CustomerCreateRequest" } } },
                },
                responses: { "201": { description: "Customer created" } },
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
                summary: "Receive Nomba webhook events",
                responses: { "200": { description: "Webhook accepted" } },
            },
        },
    },
};

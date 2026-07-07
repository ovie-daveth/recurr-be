"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const nomba_webhook_security_1 = require("./nomba-webhook.security");
(0, node_test_1.default)("Nomba canonical webhook signature matches pinned sample vector", () => {
    const payload = {
        event_type: "payment_success",
        requestId: "45f2dc2d-d559-4773-bba3-2XXXXXXXXXX",
        data: {
            merchant: {
                walletId: "6756ff80aafe04XXXXXXXXXX",
                walletBalance: 6052,
                userId: "b7b10e81-**-**-**-f4e23a132bbf",
            },
            terminal: {},
            transaction: {
                aliasAccountNumber: "5343270516",
                fee: 5,
                sessionId: "IFAP-TRANSFER-46501-e0339485-1a2f-4b43-9bd5-XXXXXXXXXX",
                type: "vact_transfer",
                transactionId: "API-VACT_TRA-B7B10-0435b274-807a-4bc7-8abe-9XXXXXXXXXX",
                aliasAccountName: "SAMPLE/JOHN DOE",
                responseCode: "null",
                originatingFrom: "api",
                transactionAmount: 10,
                narration: "John Does Transfer 10.00 To SAMPLE/JOHN DOE - Nomba",
                time: "2025-09-29T10:51:44Z",
                aliasAccountReference: "sampleAccountReference",
                aliasAccountType: "VIRTUAL",
            },
            customer: {
                bankCode: "090645",
                senderName: "John Does",
                bankName: "Nombank",
                accountNumber: "0000000000",
            },
        },
    };
    const timestamp = "2025-09-29T10:51:44Z";
    const rawBody = Buffer.from(JSON.stringify(payload));
    strict_1.default.equal((0, nomba_webhook_security_1.createNombaCanonicalString)(rawBody, timestamp), "payment_success:45f2dc2d-d559-4773-bba3-2XXXXXXXXXX:b7b10e81-**-**-**-f4e23a132bbf:6756ff80aafe04XXXXXXXXXX:API-VACT_TRA-B7B10-0435b274-807a-4bc7-8abe-9XXXXXXXXXX:vact_transfer:2025-09-29T10:51:44Z::2025-09-29T10:51:44Z");
    strict_1.default.equal((0, nomba_webhook_security_1.createNombaCanonicalSignatures)("sampleSecret", rawBody, timestamp)[0], "zj2S3DjHKtaQmQMn6Njm0RoFTG6WNi3ObogGyFE5xHA=");
});

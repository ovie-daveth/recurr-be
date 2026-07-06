import { Queue } from "bullmq";
import { getRedisConnectionOptions } from "../lib/redis";

export const BILLING_QUEUE_NAME = "recurr-billing";
export const DUNNING_QUEUE_NAME = "recurr-dunning";
export const WEBHOOK_QUEUE_NAME = "recurr-webhooks";

export type BillingRunDueJob = {
  businessId?: string;
  mode?: "TEST" | "LIVE";
  limit?: number;
};

export type DunningRunDueJob = {
  businessId?: string;
  mode?: "TEST" | "LIVE";
  limit?: number;
};

export type WebhookRunDueJob = {
  businessId?: string;
  endpointId?: string;
  limit?: number;
};

export function billingQueue() {
  return new Queue<BillingRunDueJob>(BILLING_QUEUE_NAME, {
    connection: getRedisConnectionOptions(),
  });
}

export function dunningQueue() {
  return new Queue<DunningRunDueJob>(DUNNING_QUEUE_NAME, {
    connection: getRedisConnectionOptions(),
  });
}

export function webhookQueue() {
  return new Queue<WebhookRunDueJob>(WEBHOOK_QUEUE_NAME, {
    connection: getRedisConnectionOptions(),
  });
}

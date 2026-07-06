import type {
  BillingRunDueJob,
  CleanupRunJob,
  DunningRunDueJob,
  WebhookRunDueJob,
} from "./queues";

type SchedulerQueue<T> = {
  add(name: string, data: T, opts?: { removeOnComplete?: number; removeOnFail?: number }): Promise<unknown>;
};

function intervalMs(envName: string, fallback: number) {
  const value = Number(process.env[envName]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function intervalMinutesMs(envName: string, fallbackMinutes: number) {
  const value = Number(process.env[envName]);
  const minutes = Number.isInteger(value) && value > 0 ? value : fallbackMinutes;
  return minutes * 60_000;
}

export function scheduleRecurringJobs(input: {
  billingQueue: SchedulerQueue<BillingRunDueJob>;
  cleanupQueue: SchedulerQueue<CleanupRunJob>;
  dunningQueue: SchedulerQueue<DunningRunDueJob>;
  webhookQueue: SchedulerQueue<WebhookRunDueJob>;
}) {
  const billingInterval = intervalMs("WORKER_BILLING_INTERVAL_MS", 60_000);
  const cleanupInterval = intervalMs(
    "WORKER_CLEANUP_INTERVAL_MS",
    intervalMinutesMs("CLEANUP_REPEAT_MINUTES", 15)
  );
  const dunningInterval = intervalMs("WORKER_DUNNING_INTERVAL_MS", 60_000);
  const webhookInterval = intervalMs("WORKER_WEBHOOK_INTERVAL_MS", 60_000);
  const mode =
    process.env.WORKER_DEFAULT_MODE === "LIVE" ||
    process.env.WORKER_DEFAULT_MODE === "TEST"
      ? process.env.WORKER_DEFAULT_MODE
      : undefined;
  const limit = Number(process.env.WORKER_RUN_LIMIT || 50);
  const jobLimit = Number.isInteger(limit) && limit > 0 ? limit : 50;
  const cleanupEnabled = process.env.CLEANUP_JOB_ENABLED !== "false";

  const timers = [
    setInterval(() => {
      void input.billingQueue.add(
        "billing.runDue",
        { mode, limit: jobLimit },
        {
          removeOnComplete: 100,
          removeOnFail: 500,
        }
      );
    }, billingInterval),
    ...(cleanupEnabled
      ? [
          setInterval(() => {
            void input.cleanupQueue.add(
              "cleanup.run",
              { mode },
              {
                removeOnComplete: 100,
                removeOnFail: 500,
              }
            );
          }, cleanupInterval),
        ]
      : []),
    setInterval(() => {
      void input.dunningQueue.add(
        "dunning.runDue",
        { mode, limit: jobLimit },
        {
          removeOnComplete: 100,
          removeOnFail: 500,
        }
      );
    }, dunningInterval),
    setInterval(() => {
      void input.webhookQueue.add(
        "webhook.runDue",
        { limit: jobLimit },
        {
          removeOnComplete: 100,
          removeOnFail: 500,
        }
      );
    }, webhookInterval),
  ];

  void input.billingQueue.add("billing.runDue", { mode, limit: jobLimit });
  if (cleanupEnabled) {
    void input.cleanupQueue.add("cleanup.run", { mode });
  }
  void input.dunningQueue.add("dunning.runDue", { mode, limit: jobLimit });
  void input.webhookQueue.add("webhook.runDue", { limit: jobLimit });

  return {
    stop() {
      timers.forEach((timer) => clearInterval(timer));
    },
  };
}

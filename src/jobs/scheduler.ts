import type { BillingRunDueJob, DunningRunDueJob } from "./queues";

type SchedulerQueue<T> = {
  add(name: string, data: T, opts?: { removeOnComplete?: number; removeOnFail?: number }): Promise<unknown>;
};

function intervalMs(envName: string, fallback: number) {
  const value = Number(process.env[envName]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function scheduleRecurringJobs(input: {
  billingQueue: SchedulerQueue<BillingRunDueJob>;
  dunningQueue: SchedulerQueue<DunningRunDueJob>;
}) {
  const billingInterval = intervalMs("WORKER_BILLING_INTERVAL_MS", 60_000);
  const dunningInterval = intervalMs("WORKER_DUNNING_INTERVAL_MS", 60_000);
  const mode =
    process.env.WORKER_DEFAULT_MODE === "LIVE" ||
    process.env.WORKER_DEFAULT_MODE === "TEST"
      ? process.env.WORKER_DEFAULT_MODE
      : undefined;
  const limit = Number(process.env.WORKER_RUN_LIMIT || 50);
  const jobLimit = Number.isInteger(limit) && limit > 0 ? limit : 50;

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
  ];

  void input.billingQueue.add("billing.runDue", { mode, limit: jobLimit });
  void input.dunningQueue.add("dunning.runDue", { mode, limit: jobLimit });

  return {
    stop() {
      timers.forEach((timer) => clearInterval(timer));
    },
  };
}

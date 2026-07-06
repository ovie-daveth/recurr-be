"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.advisoryLockKey = advisoryLockKey;
exports.tryAcquireTransactionAdvisoryLock = tryAcquireTransactionAdvisoryLock;
function advisoryLockKey(scope, id) {
    return `recurr:${scope}:${id}`;
}
async function tryAcquireTransactionAdvisoryLock(tx, key) {
    const result = await tx.$queryRaw `
    SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked
  `;
    return Boolean(result[0]?.locked);
}

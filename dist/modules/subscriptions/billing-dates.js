"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addBillingInterval = addBillingInterval;
exports.addDays = addDays;
function addBillingInterval(start, interval, intervalCount) {
    const count = Math.max(1, intervalCount);
    const next = new Date(start);
    switch (interval) {
        case "DAY":
            next.setUTCDate(next.getUTCDate() + count);
            return next;
        case "WEEK":
            next.setUTCDate(next.getUTCDate() + count * 7);
            return next;
        case "MONTH":
            next.setUTCMonth(next.getUTCMonth() + count);
            return next;
        case "YEAR":
            next.setUTCFullYear(next.getUTCFullYear() + count);
            return next;
        case "CUSTOM":
            next.setUTCDate(next.getUTCDate() + count);
            return next;
    }
}
function addDays(start, days) {
    const next = new Date(start);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}

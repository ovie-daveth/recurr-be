"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paginationQuerySchema = void 0;
exports.dateRangeFilter = dateRangeFilter;
exports.paginationArgs = paginationArgs;
exports.paginateResults = paginateResults;
const zod_1 = require("zod");
exports.paginationQuerySchema = zod_1.z.object({
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(20),
    cursor: zod_1.z.uuid().optional(),
    createdFrom: zod_1.z.iso.datetime().optional(),
    createdTo: zod_1.z.iso.datetime().optional(),
});
function dateRangeFilter(query) {
    if (!query.createdFrom && !query.createdTo) {
        return undefined;
    }
    return {
        ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
        ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
    };
}
function paginationArgs(query) {
    return {
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    };
}
function paginateResults(items, limit) {
    const hasMore = items.length > limit;
    const data = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? data[data.length - 1]?.id : null;
    return {
        data,
        pagination: {
            limit,
            nextCursor,
            hasMore,
        },
    };
}

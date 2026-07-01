import { z } from "zod";

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.uuid().optional(),
  createdFrom: z.iso.datetime().optional(),
  createdTo: z.iso.datetime().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function dateRangeFilter(query: Pick<PaginationQuery, "createdFrom" | "createdTo">) {
  if (!query.createdFrom && !query.createdTo) {
    return undefined;
  }

  return {
    ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
    ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
  };
}

export function paginationArgs(query: Pick<PaginationQuery, "cursor" | "limit">) {
  return {
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  };
}

export function paginateResults<T extends { id: string }>(items: T[], limit: number) {
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

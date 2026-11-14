import type { NextFunction, Request, RequestHandler, Response } from 'express';

export const ok = <T>(res: Response, data: T, meta?: Record<string, unknown>): Response =>
  res.status(200).json({ success: true, data, ...(meta ? { meta } : {}) });

export const created = <T>(res: Response, data: T): Response =>
  res.status(201).json({ success: true, data });

export const noContent = (res: Response): Response => res.status(204).send();

/** Wrap async handlers so rejected promises reach the error middleware. */
export const asyncHandler =
  (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    handler(req, res, next).catch(next);
  };

export interface Pagination {
  page: number;
  pageSize: number;
  limit: number;
  offset: number;
}

export function parsePagination(query: Record<string, unknown>): Pagination {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const rawSize = Number(query.pageSize ?? 20) || 20;
  const pageSize = Math.min(100, Math.max(1, rawSize));
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

export function paginated<T>(items: T[], total: number, p: Pagination) {
  return {
    items,
    page: p.page,
    pageSize: p.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / p.pageSize)),
  };
}

/** Express 4 does not parse `?a=1&a=2` into arrays consistently. */
export function queryString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

import { auditLogs, db } from '@wattnexa/database';
import type { Request } from 'express';
import { newId } from '../utils/crypto';
import { logger } from './logger';

export interface AuditInput {
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: newId(),
      actorId: input.actorId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadata: input.metadata ?? null,
      ipAddress: input.ipAddress ?? null,
    });
  } catch (error) {
    // Auditing must never break the request path.
    logger.warn({ err: error }, 'Failed to write audit log');
  }
}

export const auditFromRequest = (req: Request, input: Omit<AuditInput, 'actorId' | 'ipAddress'>) =>
  recordAudit({
    ...input,
    actorId: req.auth?.userId ?? null,
    ipAddress: req.ip ?? null,
  });

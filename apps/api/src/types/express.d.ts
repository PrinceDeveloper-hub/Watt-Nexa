import type { Role } from '@wattnexa/types';
import type { DeviceContext } from '../middleware/device-auth';

export interface AuthContext {
  userId: string;
  role: Role;
  sessionId: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
      device?: DeviceContext;
    }
  }
}

export {};

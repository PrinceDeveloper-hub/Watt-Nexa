/**
 * Shared domain + API contract types.
 * Kept dependency-free so both the API and the web client can import it.
 */

export type Role = 'user' | 'admin' | 'super_admin' | 'support_agent';

export type DeviceStatus = 'online' | 'offline' | 'connecting' | 'not_configured' | 'error';

export type DeviceEventType =
  | 'paired'
  | 'connected'
  | 'reconnected'
  | 'disconnected'
  | 'error'
  | 'credential_issued'
  | 'credential_revoked'
  | 'telemetry_rejected'
  | 'status_changed';

export interface DeviceEvent {
  id: number;
  deviceId: string;
  type: DeviceEventType;
  message: string | null;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
}

/** Which measurements a device actually reports, inferred from its readings. */
export type SensorCapability = {
  key: 'voltage' | 'current' | 'activePower' | 'apparentPower' | 'powerFactor' | 'energyKwh' | 'temperature' | 'frequency' | 'signalStrength';
  available: boolean;
};

export type TelemetrySource = 'hardware' | 'simulated';

export type HomeType = 'home' | 'apartment' | 'office' | 'shop' | 'other';

export type Bucket = 'hour' | 'day' | 'month';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type AlertType =
  | 'high_power'
  | 'unusual_consumption'
  | 'device_offline'
  | 'device_online'
  | 'high_temperature'
  | 'daily_threshold'
  | 'monthly_threshold'
  | 'bill_threshold'
  | 'device_error'
  | 'firmware_update'
  | 'account';

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  emailVerified: boolean;
  timezone: string;
  currency: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  expiresIn: number;
}

/** Single sensor reading. Optional fields are genuinely unavailable, not zero. */
export interface TelemetrySample {
  id?: number;
  deviceId: string;
  recordedAt: string;
  voltage: number | null;
  current: number | null;
  activePower: number | null;
  apparentPower: number | null;
  powerFactor: number | null;
  energyKwh: number | null;
  temperature: number | null;
  frequency: number | null;
  signalStrength: number | null;
  /** Device-supplied idempotency key, when the firmware sends one. */
  messageId?: string | null;
  source: TelemetrySource;
}

export interface LiveMetrics {
  deviceId: string;
  deviceName: string;
  status: DeviceStatus;
  lastSeenAt: string | null;
  reading: TelemetrySample | null;
  energyTodayKwh: number;
  energyMonthKwh: number;
}

export interface EnergyPoint {
  timestamp: string;
  energyKwh: number;
  averagePowerW: number;
  peakPowerW: number;
  samples: number;
}

export interface TariffSlabInput {
  minKwh: number;
  maxKwh: number | null;
  ratePerKwh: number;
}

export interface TariffInput {
  currency: string;
  fixedCharge: number;
  taxPercent: number;
  slabs: TariffSlabInput[];
}

export interface CostBreakdown {
  energyKwh: number;
  energyCost: number;
  fixedCharge: number;
  taxAmount: number;
  total: number;
  currency: string;
  slabs: Array<{ label: string; kwh: number; ratePerKwh: number; cost: number }>;
}

export interface BillEstimate extends CostBreakdown {
  periodStart: string;
  periodEnd: string;
  projectedMonthlyKwh: number;
  projectedMonthlyTotal: number;
}

export interface Insight {
  id: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  metric?: string;
}

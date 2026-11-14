const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/api/v1/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function request<T>(path: string, options: RequestOptions = {}, allowRetry = true): Promise<T> {
  const { body, headers, ...rest } = options;
  const response = await fetch(`${BASE}/api/v1${path}`, {
    credentials: 'include',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(headers ?? {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...rest,
  });

  if (response.status === 401 && allowRetry && !path.startsWith('/auth/refresh')) {
    if (await tryRefresh()) return request<T>(path, options, false);
  }

  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; error: { code: string; message: string; details?: unknown } }
    | null;

  if (!response.ok || !payload || payload.success === false) {
    const error = payload && payload.success === false ? payload.error : null;
    throw new ApiError(
      response.status,
      error?.code ?? 'REQUEST_FAILED',
      error?.message ?? 'The request could not be completed',
      error?.details,
    );
  }
  return payload.data;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
};

/** Authenticated binary download (CSV / PDF exports). */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const response = await fetch(`${BASE}/api/v1${path}`, { credentials: 'include' });
  if (!response.ok) throw new ApiError(response.status, 'DOWNLOAD_FAILED', 'Export could not be generated');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

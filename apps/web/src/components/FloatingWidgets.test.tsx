import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '@/lib/api';
import { ToastProvider } from '@/components/ui/toast';
import { NotificationCenter } from './FloatingWidgets';

afterEach(cleanup);

const response = {
  unread: 2,
  items: [
    {
      id: 'energy-1',
      alertId: 'alert-1',
      title: 'Power threshold exceeded',
      body: 'Live draw is above your threshold.',
      readAt: null,
      createdAt: '2026-11-14T10:00:00.000Z',
      alertType: 'high_power',
      severity: 'warning',
      deviceId: null,
    },
    {
      id: 'device-1',
      alertId: 'alert-2',
      title: 'Main Meter is offline',
      body: 'Check the device connection.',
      readAt: null,
      createdAt: '2026-11-14T09:00:00.000Z',
      alertType: 'device_offline',
      severity: 'warning',
      deviceId: 'device-id',
    },
  ],
};

function renderCenter() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <NotificationCenter open onOpenChange={vi.fn()} onAskWattbot={vi.fn()} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NotificationCenter', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue(response);
    vi.mocked(api.post).mockResolvedValue({ read: true });
  });

  it('filters persisted notifications by category', async () => {
    renderCenter();

    expect(await screen.findByText('Power threshold exceeded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Devices' }));

    expect(await screen.findByText('Main Meter is offline')).toBeTruthy();
    expect(screen.queryByText('Power threshold exceeded')).toBeNull();
  });

  it('marks all unread notifications through the existing API', async () => {
    renderCenter();
    await screen.findByText('Power threshold exceeded');
    fireEvent.click(screen.getByRole('button', { name: /mark all read/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/alerts/notifications/read-all'));
  });
});

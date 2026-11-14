import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api';

export interface HomeSummary {
  id: string;
  name: string;
  type: string;
  city: string | null;
  region: string | null;
  timezone: string;
  devices: Array<{ id: string; name: string; status: string }>;
}

const STORAGE_KEY = 'wattnexa-home';

export function useHomes() {
  const [homeId, setHomeId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  const query = useQuery({
    queryKey: ['homes'],
    queryFn: () => api.get<HomeSummary[]>('/homes'),
  });

  const homes = query.data ?? [];
  const active = homes.find((home) => home.id === homeId) ?? homes[0] ?? null;

  useEffect(() => {
    if (active && active.id !== homeId) {
      setHomeId(active.id);
      localStorage.setItem(STORAGE_KEY, active.id);
    }
  }, [active, homeId]);

  const select = (id: string) => {
    setHomeId(id);
    localStorage.setItem(STORAGE_KEY, id);
  };

  return { homes, home: active, homeId: active?.id ?? null, select, ...query };
}

export const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'last_90_days', label: 'Last 90 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'previous_month', label: 'Previous month' },
] as const;

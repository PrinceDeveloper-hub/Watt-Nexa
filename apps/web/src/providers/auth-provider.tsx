import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicUser } from '@wattnexa/types';
import * as React from 'react';
import { ApiError, api } from '@/lib/api';

interface AuthContextValue {
  user: PublicUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string, remember: boolean) => Promise<PublicUser>;
  register: (input: { name: string; email: string; password: string }) => Promise<{
    requiresVerification: boolean;
    email: string;
    devCode?: string;
  }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async (): Promise<PublicUser | null> => {
      try {
        return await api.get<PublicUser>('/auth/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 30_000,
  });

  const login = React.useCallback<AuthContextValue['login']>(
    async (email, password, remember) => {
      const result = await api.post<{ user: PublicUser }>('/auth/login', { email, password, remember });
      await queryClient.invalidateQueries({ queryKey: ['auth'] });
      queryClient.setQueryData(['auth', 'me'], result.user);
      return result.user;
    },
    [queryClient],
  );

  const register = React.useCallback<AuthContextValue['register']>(
    async (input) => api.post('/auth/register', input),
    [],
  );

  const logout = React.useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    queryClient.setQueryData(['auth', 'me'], null);
    queryClient.clear();
  }, [queryClient]);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data ?? null,
      isLoading: meQuery.isLoading,
      isAuthenticated: Boolean(meQuery.data),
      login,
      register,
      logout,
      refreshUser: async () => {
        await meQuery.refetch();
      },
    }),
    [login, logout, meQuery, register],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL as string | undefined) ?? window.location.origin;

/**
 * Single shared socket per tab. Cookies authenticate the handshake, so the
 * client never handles a token.
 */
export function useRealtime(handlers: Record<string, (payload: unknown) => void>): { connected: boolean } {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket: Socket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      path: '/socket.io',
    });

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    for (const [event, handler] of Object.entries(handlers)) {
      socket.on(event, handler);
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      for (const [event, handler] of Object.entries(handlers)) {
        socket.off(event, handler);
      }
      socket.disconnect();
    };
    // Handlers are re-registered on identity change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { connected };
}

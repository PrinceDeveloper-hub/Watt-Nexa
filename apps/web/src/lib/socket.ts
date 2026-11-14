import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL as string | undefined) ?? window.location.origin;
let sharedSocket: Socket | null = null;
let subscribers = 0;

function getSharedSocket(): Socket {
  if (!sharedSocket) {
    sharedSocket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      path: '/socket.io',
    });
  }
  return sharedSocket;
}

/**
 * Single shared socket per tab. Cookies authenticate the handshake, so the
 * client never handles a token.
 */
export function useRealtime(handlers: Record<string, (payload: unknown) => void>): { connected: boolean } {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = getSharedSocket();
    const currentHandlers = handlers;
    const wrappedHandlers = Object.entries(currentHandlers).map(([event, handler]) => {
      const wrapped = (payload: unknown) => handler(payload);
      socket.on(event, wrapped);
      return [event, wrapped] as const;
    });

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    subscribers += 1;
    setConnected(socket.connected);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      for (const [event, handler] of wrappedHandlers) {
        socket.off(event, handler);
      }
      subscribers -= 1;
      if (subscribers === 0) {
        socket.disconnect();
        sharedSocket = null;
      }
    };
    // A hook owns its handlers for its mounted lifetime; route changes cleanly unsubscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { connected };
}

import { writable } from 'svelte/store';
import { io, type Socket } from 'socket.io-client';
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { auth } from './auth';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';

let socketInstance: Socket | null = null;

// Why the server closed the session, shown on the login page
export const sessionTerminated = writable<string | null>(null);

export function getSocket(): Socket {
	if (!socketInstance && browser) {
		socketInstance = io(SERVER_URL, {
			autoConnect: false,
			transports: ['websocket'],
			withCredentials: true
		});
	}
	return socketInstance!;
}

export function connectSocket() {
	const socket = getSocket();
	if (!socket.connected) {
		socket.off('session:terminated');
		socket.on('session:terminated', ({ reason }: { reason?: string }) => {
			sessionTerminated.set(reason ?? 'Session terminée');
			auth.clearLocal();
			disconnectSocket();
			if (browser) goto('/login');
		});

		socket.connect();
	}
	return socket;
}

export function disconnectSocket() {
	if (socketInstance?.connected) {
		socketInstance.disconnect();
	}
	socketInstance = null;
}

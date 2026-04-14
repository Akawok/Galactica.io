import { writable } from 'svelte/store';
import { io, type Socket } from 'socket.io-client';
import { browser } from '$app/environment';

const SERVER_URL = 'http://localhost:3000';

let socketInstance: Socket | null = null;

export const socketStore = writable<Socket | null>(null);

export function getSocket(): Socket {
	if (!socketInstance && browser) {
		socketInstance = io(SERVER_URL, { autoConnect: false });
		socketStore.set(socketInstance);
	}
	return socketInstance!;
}

export function connectSocket(token: string) {
	const socket = getSocket();
	if (!socket.connected) {
		socket.auth = { token };
		socket.connect();
	}
	return socket;
}

export function disconnectSocket() {
	if (socketInstance?.connected) {
		socketInstance.disconnect();
	}
	socketInstance = null;
	socketStore.set(null);
}

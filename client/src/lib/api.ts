import { get } from 'svelte/store';
import { auth } from './stores/auth';

const BASE_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';

function readCsrfCookie(): string | null {
	if (typeof document === 'undefined') return null;
	for (const part of document.cookie.split(';')) {
		const [name, ...rest] = part.trim().split('=');
		if (name === 'galactica_csrf' && rest.length) {
			return decodeURIComponent(rest.join('='));
		}
	}
	return null;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...(options.headers as Record<string, string>)
	};

	const method = (options.method ?? 'GET').toUpperCase();
	if (method !== 'GET' && method !== 'HEAD') {
		const csrf = readCsrfCookie();
		if (csrf) headers['x-csrf-token'] = csrf;
	}

	const res = await fetch(`${BASE_URL}${path}`, {
		...options,
		headers,
		credentials: 'include'
	});

	let data: any = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}

	if (!res.ok) {
		if (res.status === 401 && get(auth).user) {
			auth.clearLocal();
		}
		throw new Error(data?.error ?? 'Erreur serveur');
	}
	return data as T;
}

export const api = {
	auth: {
		register: (username: string, email: string, password: string) =>
			request<{ csrfToken: string; user: any }>('/auth/register', {
				method: 'POST',
				body: JSON.stringify({ username, email, password })
			}),
		logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
		login: (email: string, password: string) =>
			request<{ csrfToken: string; user: any }>('/auth/login', {
				method: 'POST',
				body: JSON.stringify({ email, password })
			}),
		me: () => request<{ user: any }>('/auth/me'),
		forgotPassword: (email: string) =>
			request<{ ok: boolean; message: string }>('/auth/forgot-password', {
				method: 'POST',
				body: JSON.stringify({ email })
			}),
		resetPassword: (token: string, password: string) =>
			request<{ ok: boolean }>('/auth/reset-password', {
				method: 'POST',
				body: JSON.stringify({ token, password })
			}),
		sendVerification: () =>
			request<{ ok: boolean; alreadyVerified?: boolean }>('/auth/send-verification', {
				method: 'POST'
			}),
		verifyEmail: (token: string) =>
			request<{ ok: boolean }>('/auth/verify-email', {
				method: 'POST',
				body: JSON.stringify({ token })
			})
	},
	shop: {
		items: () => request<{ items: any[] }>('/shop/items'),
		inventory: () =>
			request<{
				inventory: any[];
				activeShip: string;
				activeBullet: string;
				activeBulletSecondary: string;
				points: number;
			}>('/shop/inventory'),
		buy: (itemId: string) =>
			request<{ points: number; galactics: number; inventory: string[] }>('/shop/buy', {
				method: 'POST',
				body: JSON.stringify({ itemId })
			}),
		equip: (type: 'ship' | 'bullet', sprite: string, role?: 'primary' | 'secondary') =>
			request<{ activeShip: string; activeBullet: string; activeBulletSecondary: string }>(
				'/shop/equip',
				{
					method: 'POST',
					body: JSON.stringify({ type, sprite, role })
				}
			)
	},
	stats: {
		me: () => request<{ user: any }>('/stats/me'),
		get: (userId: string) => request<{ user: any; games: any[] }>(`/stats/${userId}`)
	},
	leaderboard: {
		get: () => request<{ players: any[] }>('/leaderboard')
	},
	chat: {
		history: () => request<{ messages: any[] }>('/chat/history')
	}
};

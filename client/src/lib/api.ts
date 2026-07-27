import { get } from 'svelte/store';
import { auth } from './stores/auth';

const BASE_URL = 'http://localhost:3000';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
	const { token } = get(auth);

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...(options.headers as Record<string, string>)
	};

	if (token) headers['Authorization'] = `Bearer ${token}`;

	const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

	let data: any = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}

	if (!res.ok) {
		if ((res.status === 401 || res.status === 403) && token) {
			auth.logout();
		}
		throw new Error(data?.error ?? 'Erreur serveur');
	}
	return data as T;
}

export const api = {
	auth: {
		register: (username: string, email: string, password: string) =>
			request<{ token: string; user: any }>('/auth/register', {
				method: 'POST',
				body: JSON.stringify({ username, email, password })
			}),
		login: (email: string, password: string) =>
			request<{ token: string; user: any }>('/auth/login', {
				method: 'POST',
				body: JSON.stringify({ email, password })
			}),
		me: () => request<{ user: any }>('/auth/me')
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

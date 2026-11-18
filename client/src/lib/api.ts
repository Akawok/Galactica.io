import { get } from 'svelte/store';
import { auth } from './stores/auth';
import type { Attributes } from './shared/attributes';

// Same origin: Caddy in prod, the Vite proxy in dev (vite.config.ts)
export const BASE_URL = '/api';

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
	// Fastify rejects an empty body sent as JSON, so the header only goes with a body
	const headers: Record<string, string> = {
		...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
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

function post<T = { ok: boolean }>(path: string, body: unknown = {}): Promise<T> {
	return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

function toQuery(params: Record<string, string | number | undefined>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== '') search.set(key, String(value));
	}
	const qs = search.toString();
	return qs ? `?${qs}` : '';
}

export const api = {
	auth: {
		register: (username: string, email: string, password: string) =>
			post<{ csrfToken: string; user: any }>('/auth/register', { username, email, password }),
		logout: () => post('/auth/logout'),
		login: (email: string, password: string) =>
			post<{ csrfToken: string; user: any }>('/auth/login', { email, password }),
		me: () => request<{ user: any }>('/auth/me'),
		forgotPassword: (email: string) =>
			post<{ ok: boolean; message: string }>('/auth/forgot-password', { email }),
		resetPassword: (token: string, password: string) =>
			post('/auth/reset-password', { token, password }),
		sendVerification: () =>
			post<{ ok: boolean; alreadyVerified?: boolean }>('/auth/send-verification'),
		verifyEmail: (token: string) =>
			post('/auth/verify-email', { token })
	},
	shop: {
		items: () => request<{ items: any[] }>('/shop/items'),
		buy: (itemId: string) =>
			post<{ points: number; galactics: number; inventory: string[] }>('/shop/buy', { itemId }),
		equip: (type: 'ship' | 'bullet', sprite: string) =>
			post<{ activeShip: string; activeBullet: string; activeBulletSecondary: string }>(
				'/shop/equip',
				{ type, sprite }
			)
	},
	attributes: {
		save: (attributes: Attributes) =>
			post<{ attributes: Attributes }>('/attributes', { attributes }),
		reset: () =>
			post<{ attributes: Attributes; galactics: number; respecCost: number }>('/attributes/reset')
	},
	stats: {
		me: () => request<{ user: any }>('/stats/me')
	},
	leaderboard: {
		get: (sort: 'wins' | 'losses' | 'level' | 'desertions' = 'wins') =>
			request<{ players: any[] }>(`/leaderboard${toQuery({ sort })}`)
	},
	chat: {
		history: () => request<{ messages: any[] }>('/chat/history')
	},
	admin: {
		overview: () => request<AdminOverview>('/admin/overview'),
		users: (params: UserQuery) =>
			request<Paged<{ users: AdminUser[] }>>(`/admin/users${toQuery(params)}`),
		user: (userId: string) => request<AdminUserDetail>(`/admin/users/${userId}`),
		ban: (userId: string, body: { durationMinutes?: number; permanent?: boolean; reason?: string }) =>
			post<{ bannedUntil: string }>(`/admin/users/${userId}/ban`, body),
		unban: (userId: string) => post(`/admin/users/${userId}/unban`),
		mute: (userId: string, durationMinutes: number) =>
			post<{ mutedUntil: string | null }>(`/admin/users/${userId}/mute`, { durationMinutes }),
		kick: (userId: string) => post(`/admin/users/${userId}/kick`),
		rename: (userId: string, username: string) =>
			post<{ username: string }>(`/admin/users/${userId}/rename`, { username }),
		setRole: (userId: string, role: 'user' | 'moderator' | 'admin') =>
			post(`/admin/users/${userId}/role`, { role }),
		setResources: (userId: string, changes: ResourceChanges) =>
			request<ResourceChanges & { attributesReset: boolean }>(
				`/admin/users/${userId}/resources`,
				{ method: 'PATCH', body: JSON.stringify(changes) }
			),
		resetAttributes: (userId: string) => post(`/admin/users/${userId}/reset-attributes`),
		verifyEmail: (userId: string) => post(`/admin/users/${userId}/verify-email`),
		sendReset: (userId: string) => post(`/admin/users/${userId}/send-reset`),
		deleteUser: (userId: string, confirm: string) =>
			post(`/admin/users/${userId}/delete`, { confirm }),
		liveGames: () => request<{ rooms: LiveRoom[]; online: OnlinePlayer[] }>('/admin/games/live'),
		closeGame: (roomId: string, reason?: string) =>
			post(`/admin/games/${roomId}/close`, reason ? { reason } : {}),
		games: (params: { username?: string; page?: number; limit?: number }) =>
			request<Paged<{ games: AdminGame[] }>>(`/admin/games${toQuery(params)}`),
		chat: (params: { username?: string }) =>
			request<{ messages: AdminChatMessage[] }>(`/admin/chat${toQuery(params)}`),
		deleteMessage: (messageId: string) => post(`/admin/chat/${messageId}/delete`),
		purgeChat: (username?: string) =>
			post<{ deletedCount: number }>('/admin/chat/purge', username ? { username } : {}),
		announce: (message: string) => post<{ id: string }>('/admin/announce', { message }),
		audit: (params: { page?: number; limit?: number; action?: string; username?: string }) =>
			request<Paged<{ entries: AuditEntry[] }>>(`/admin/audit${toQuery(params)}`),
		items: () => request<{ items: any[] }>('/admin/items'),
		createItem: (item: NewItem) =>
			post<{ item: any }>('/admin/items', item),
		updateItem: (itemId: string, changes: ItemChanges) =>
			request<{ item: any }>(`/admin/items/${itemId}`, {
				method: 'PATCH',
				body: JSON.stringify(changes)
			}),
		replaceImages: (itemId: string, images: string[]) =>
			request<{ item: any }>(`/admin/items/${itemId}/images`, {
				method: 'POST',
				body: JSON.stringify({ images })
			}),
		deleteItem: (itemId: string) =>
			post<{ ok: boolean; owners: number }>(`/admin/items/${itemId}/delete`)
	}
};

export interface ItemChanges {
	name?: string;
	description?: string;
	price?: number;
	priceGalactics?: number;
}

export interface NewItem extends ItemChanges {
	name: string;
	price: number;
	type: 'ship' | 'bullet';
	bulletRole?: 'primary' | 'secondary';
	sprite: string;
	images?: string[];
}

export type Role = 'user' | 'moderator' | 'admin';
export type UserFilter = 'all' | 'online' | 'banned' | 'muted' | 'staff' | 'unverified';
export type UserSort = 'recent' | 'points' | 'level' | 'games' | 'name';

export type Paged<T> = T & { total: number; page: number; limit: number };

export interface UserQuery {
	[key: string]: string | number | undefined;
	q?: string;
	filter?: UserFilter;
	sort?: UserSort;
	page?: number;
}

export interface AdminUser {
	id: string;
	username: string;
	email?: string;
	role: Role;
	level: number;
	xp: number;
	points: number;
	galactics: number;
	stats: {
		wins?: number;
		losses?: number;
		totalGames?: number;
		currentStreak?: number;
		bestStreak?: number;
		desertions?: number;
	};
	createdAt: string | null;
	bannedUntil: string | null;
	banReason: string | null;
	mutedUntil: string | null;
	emailVerified: boolean;
	online: boolean;
}

export interface OnlinePlayer {
	userId: string;
	username: string;
	level: number;
	status: 'idle' | 'in-game' | 'spectating';
	roomId: string | null;
}

export interface AdminGame {
	id: string;
	roomId: string;
	players: { userId: string | null; username: string; score: number }[];
	winner: string | null;
	won?: boolean;
	createdAt: string | null;
	endedAt: string | null;
}

export interface AuditEntry {
	_id: string;
	action: string;
	actorUsername: string;
	targetId?: string;
	targetUsername?: string;
	details?: Record<string, any>;
	createdAt: string;
}

export interface AdminUserDetail {
	user: AdminUser & {
		attributes: Record<string, number>;
		attributePoints: number;
		respecCount: number;
		loadout: { ship: string; bullet: string; bulletSecondary: string };
		inventory: { id: string; name: string; type: string; bulletRole: string | null }[];
	};
	live: OnlinePlayer | null;
	games: AdminGame[];
	history: AuditEntry[];
}

export interface ResourceChanges {
	points?: number;
	galactics?: number;
	level?: number;
	xp?: number;
}

export interface LiveRoom {
	roomId: string;
	status: 'waiting' | 'playing' | 'roundEnd' | 'matchEnd';
	training: boolean;
	// userId is null for the training bot
	players: { userId: string | null; username: string; level: number; score: number }[];
	spectatorCount: number;
	createdAt: number | null;
}

export interface AdminChatMessage {
	id: string;
	username: string;
	message: string;
	timestamp: string;
	level: number | null;
	system: boolean;
	announcement: boolean;
}

export interface AdminOverview {
	players: {
		total: number;
		newToday: number;
		newWeek: number;
		banned: number;
		muted: number;
		unverified: number;
	};
	live: {
		online: number;
		inGame: number;
		spectating: number;
		roomsWaiting: number;
		roomsPlaying: number;
	};
	games: { total: number; today: number; week: number };
	chat: { today: number };
	topPlayers: {
		id: string;
		username: string;
		level: number;
		points: number;
		wins: number;
		totalGames: number;
	}[];
	latestSignups: { id: string; username: string; level: number; createdAt: string }[];
	recentActions: AuditEntry[];
}

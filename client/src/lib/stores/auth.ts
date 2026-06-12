import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';

export interface AuthUser {
	id: string;
	username: string;
	points: number;
	galactics?: number;
	xp: number;
	level: number;
	activeShip: string;
	activeBullet: string;
	activeBulletSecondary: string;
}

function createAuthStore() {
	const stored = browser ? localStorage.getItem('galactica_token') : null;
	const storedUser = browser ? localStorage.getItem('galactica_user') : null;

	const { subscribe, set, update } = writable<{
		token: string | null;
		user: AuthUser | null;
	}>({
		token: stored,
		user: storedUser ? JSON.parse(storedUser) : null
	});

	return {
		subscribe,
		login(token: string, user: AuthUser) {
			if (browser) {
				localStorage.setItem('galactica_token', token);
				localStorage.setItem('galactica_user', JSON.stringify(user));
			}
			set({ token, user });
		},
		logout() {
			if (browser) {
				localStorage.removeItem('galactica_token');
				localStorage.removeItem('galactica_user');
			}
			set({ token: null, user: null });
		},
		updateUser(updates: Partial<AuthUser>) {
			update((state) => {
				if (!state.user) return state;
				const user = { ...state.user, ...updates };
				if (browser) localStorage.setItem('galactica_user', JSON.stringify(user));
				return { ...state, user };
			});
		}
	};
}

export const auth = createAuthStore();
export const isAuthenticated = derived(auth, ($auth) => !!$auth.token && !!$auth.user);
export const currentUser = derived(auth, ($auth) => $auth.user);
export const token = derived(auth, ($auth) => $auth.token);

import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';

export type UserRole = 'user' | 'moderator' | 'admin';

export interface AuthUser {
	id: string;
	username: string;
	role?: UserRole;
	points: number;
	galactics?: number;
	xp: number;
	level: number;
	activeShip: string;
	activeBullet: string;
	activeBulletSecondary: string;
}

const USER_KEY = 'galactica_user';

function createAuthStore() {
	if (browser) {
		localStorage.removeItem('galactica_token');
	}

	let initialUser: AuthUser | null = null;
	try {
		const stored = browser ? localStorage.getItem(USER_KEY) : null;
		initialUser = stored ? JSON.parse(stored) : null;
	} catch {
		if (browser) localStorage.removeItem(USER_KEY);
	}

	const { subscribe, set, update } = writable<{ user: AuthUser | null }>({
		user: initialUser
	});

	function persist(user: AuthUser | null) {
		if (!browser) return;
		if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
		else localStorage.removeItem(USER_KEY);
	}

	return {
		subscribe,
		login(user: AuthUser) {
			persist(user);
			set({ user });
		},
		clearLocal() {
			persist(null);
			set({ user: null });
		},
		updateUser(updates: Partial<AuthUser>) {
			update((state) => {
				if (!state.user) return state;
				const user = { ...state.user, ...updates };
				persist(user);
				return { user };
			});
		}
	};
}

export const auth = createAuthStore();
export const isAuthenticated = derived(auth, ($auth) => !!$auth.user);
export const currentUser = derived(auth, ($auth) => $auth.user);

export const isStaff = derived(
	auth,
	($auth) => $auth.user?.role === 'moderator' || $auth.user?.role === 'admin'
);

import { writable } from 'svelte/store';

export interface ChatMessage {
	id?: string;
	username: string;
	message: string;
	timestamp: number;
	level?: number;
	system?: boolean;
	announcement?: boolean;
}

export interface ChatRemoval {
	ids?: string[];
	username?: string;
	all?: boolean;
}

export const chatMessages = writable<ChatMessage[]>([]);

export function addMessage(msg: ChatMessage) {
	chatMessages.update((msgs) => [...msgs.slice(-199), msg]);
}

// Sent by the server when a moderator deletes messages, so they vanish from every open chat
export function removeMessages({ ids, username, all }: ChatRemoval) {
	if (all) {
		chatMessages.set([]);
		return;
	}
	const idSet = new Set(ids ?? []);
	chatMessages.update((msgs) =>
		msgs.filter(
			(m) => !(m.id && idSet.has(m.id)) && !(username && !m.system && m.username === username)
		)
	);
}

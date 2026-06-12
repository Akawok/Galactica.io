import { writable } from 'svelte/store';

export interface ChatMessage {
	username: string;
	message: string;
	timestamp: number;
}

export const chatMessages = writable<ChatMessage[]>([]);

export function addMessage(msg: ChatMessage) {
	chatMessages.update((msgs) => [...msgs.slice(-199), msg]);
}

import { BASE_URL } from './api';

export interface ItemImageRef {
	type: string;
	sprite: string;
	frames?: number;
	imageVersion?: number;
	imageExt?: 'webp' | 'png';
}

const TYPE_DIR: Record<string, string> = {
	ship: 'spaceships',
	bullet: 'bullets',
	cosmetic: 'cosmetics'
};

export function itemFrameUrls(item: ItemImageRef): string[] {
	const dir = TYPE_DIR[item.type];
	if (!dir || !item.sprite) return [];
	const count = Math.max(1, item.frames ?? 1);
	const ext = item.imageExt ?? 'png';
	const version = item.imageVersion ? `?v=${item.imageVersion}` : '';
	return Array.from(
		{ length: count },
		(_, i) => `${BASE_URL}/assets/${dir}/${item.sprite}/f${i + 1}.${ext}${version}`
	);
}

export function itemImageUrl(item: ItemImageRef): string {
	return itemFrameUrls(item)[0] ?? '';
}

// 1 → 2 → 3 → 4 → 3 → 2 → 1…: the reactor flame grows then shrinks without jumping back
export function pingPongOrder(count: number): number[] {
	const forward = Array.from({ length: count }, (_, i) => i);
	return count > 2 ? [...forward, ...forward.slice(1, -1).reverse()] : forward;
}

export function findItem<T extends ItemImageRef>(
	items: T[],
	type: string,
	sprite: string | undefined
): T | undefined {
	return items.find((i) => i.type === type && i.sprite === sprite);
}

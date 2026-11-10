export interface Item {
	_id: string;
	name: string;
	type: 'ship' | 'bullet' | 'cosmetic';
	bulletRole?: 'primary' | 'secondary' | null;
	price: number;
	priceGalactics?: number;
	description: string;
	sprite: string;
	frames?: number;
	imageVersion?: number;
	imageExt?: 'webp' | 'png';
}

export type ItemTab = 'ship' | 'primary' | 'secondary';

export const ITEM_TABS: { key: ItemTab; label: string }[] = [
	{ key: 'ship', label: 'Vaisseaux' },
	{ key: 'primary', label: 'Tir principal' },
	{ key: 'secondary', label: 'Tir secondaire' }
];

export function filterByTab(items: Item[], tab: ItemTab): Item[] {
	if (tab === 'ship') return items.filter((i) => i.type === 'ship');
	return items.filter((i) => i.type === 'bullet' && i.bulletRole === tab);
}

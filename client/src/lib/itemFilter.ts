export interface Item {
	_id: string;
	name: string;
	type: 'ship' | 'bullet' | 'cosmetic';
	bulletRole?: 'primary' | 'secondary' | null;
	price: number;
	description: string;
	sprite: string;
	stats: Record<string, number>;
}

export type ItemTab = 'ship' | 'primary' | 'secondary';

export const ITEM_TABS: { key: ItemTab; label: string }[] = [
	{ key: 'ship', label: '🚀 Vaisseaux' },
	{ key: 'primary', label: '🔫 Tir principal' },
	{ key: 'secondary', label: '💥 Tir secondaire' }
];

export function filterByTab(items: Item[], tab: ItemTab): Item[] {
	if (tab === 'ship') return items.filter((i) => i.type === 'ship');
	return items.filter((i) => i.type === 'bullet' && i.bulletRole === tab);
}

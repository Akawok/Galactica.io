const dateFormat = new Intl.DateTimeFormat('fr-FR', {
	day: '2-digit',
	month: '2-digit',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit'
});

export function formatDate(value: string | number | Date | null | undefined): string {
	if (!value) return '—';
	return dateFormat.format(new Date(value));
}

export function timeAgo(value: string | number | Date | null | undefined): string {
	if (!value) return '—';
	const diff = Date.now() - new Date(value).getTime();
	const minutes = Math.round(diff / 60_000);
	if (minutes < 1) return "à l'instant";
	if (minutes < 60) return `il y a ${minutes} min`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `il y a ${hours} h`;
	const days = Math.round(hours / 24);
	if (days < 30) return `il y a ${days} j`;
	return formatDate(value);
}

export function timeLeft(value: string | null | undefined): string | null {
	if (!value) return null;
	const end = new Date(value).getTime();
	const diff = end - Date.now();
	if (diff <= 0) return null;
	if (new Date(value).getUTCFullYear() >= 9999) return 'définitif';
	const minutes = Math.ceil(diff / 60_000);
	if (minutes < 60) return `encore ${minutes} min`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `encore ${hours} h`;
	return `encore ${Math.round(hours / 24)} j`;
}

export function isActive(value: string | null | undefined): boolean {
	return !!value && new Date(value).getTime() > Date.now();
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
	return `${n.toLocaleString('fr-FR')} ${n > 1 ? pluralWord : word}`;
}

export function formatNumber(n: number | null | undefined): string {
	return (n ?? 0).toLocaleString('fr-FR');
}

export const ROLE_LABEL: Record<string, string> = {
	user: 'Joueur',
	moderator: 'Modérateur',
	admin: 'Admin'
};

export const ROOM_STATUS_LABEL: Record<string, string> = {
	waiting: 'En attente',
	playing: 'En combat',
	roundEnd: 'Entre deux manches',
	matchEnd: 'Se termine'
};

export const PLAYER_STATUS_LABEL: Record<string, string> = {
	idle: 'Au lobby',
	'in-game': 'En partie',
	spectating: 'Spectateur'
};

export const ACTION_LABEL: Record<string, string> = {
	ban: 'Bannissement',
	unban: 'Levée de ban',
	mute: 'Mise en sourdine',
	kick: 'Déconnexion forcée',
	'self-rename': 'Pseudo changé par le joueur',
	rename: 'Changement de pseudo',
	'role-change': 'Changement de rôle',
	resources: 'Ressources modifiées',
	'reset-attributes': 'Caractéristiques remises à zéro',
	'verify-email': 'Email validé',
	'send-reset': 'Lien de mot de passe envoyé',
	'delete-account': 'Compte supprimé',
	'game-close': 'Partie arrêtée',
	'chat-delete': 'Message supprimé',
	'chat-purge': 'Chat vidé',
	announce: 'Annonce',
	'item-create': 'Item créé',
	'item-update': 'Item modifié',
	'item-delete': 'Item supprimé'
};

export function describeAudit(entry: { action: string; details?: Record<string, any> }): string {
	const d = entry.details ?? {};
	switch (entry.action) {
		case 'ban':
			return [
				d.permanent ? 'définitif' : `jusqu'au ${formatDate(d.bannedUntil)}`,
				d.reason ? `« ${d.reason} »` : null
			]
				.filter(Boolean)
				.join(' · ');
		case 'mute':
			return d.mutedUntil ? `jusqu'au ${formatDate(d.mutedUntil)}` : 'levée';
		case 'rename':
		case 'self-rename':
			return `${d.from} → ${d.to}`;
		case 'role-change':
			return ROLE_LABEL[d.role] ?? d.role;
		case 'resources': {
			const parts: string[] = [];
			const labels: Record<string, string> = {
				points: 'crédits',
				galactics: 'Galactics',
				level: 'niveau',
				xp: 'XP'
			};
			for (const key of Object.keys(labels)) {
				if (d.before?.[key] !== d.after?.[key])
					parts.push(`${labels[key]} ${d.before?.[key]} → ${d.after?.[key]}`);
			}
			if (d.attributesReset) parts.push('caractéristiques remises à zéro');
			return parts.join(' · ');
		}
		case 'game-close':
			return `#${d.roomId}${d.players?.length ? ` (${d.players.join(' vs ')})` : ''}`;
		case 'chat-delete':
		case 'announce':
			return d.message ? `« ${d.message} »` : '';
		case 'chat-purge':
			return plural(d.deletedCount ?? 0, 'message');
		case 'item-create':
			return d.name ?? d.sprite ?? '';
		case 'item-update':
			return d.sprite ?? '';
		case 'item-delete':
			return [d.name ?? d.sprite, d.owners ? `retiré de ${plural(d.owners, 'inventaire')}` : null]
				.filter(Boolean)
				.join(' · ');
		default:
			return '';
	}
}

<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type ItemChanges } from '$lib/api';
	import { ITEM_TABS, filterByTab, type Item, type ItemTab } from '$lib/itemFilter';
	import { itemFrameUrls } from '$lib/itemImages';
	import ItemPreview from '$lib/components/ItemPreview.svelte';
	import Gem from '@lucide/svelte/icons/gem';
	import Plus from '@lucide/svelte/icons/plus';

	interface PickedImage {
		name: string;
		dataUrl: string;
		base64: string;
	}

	const MAX_FRAMES = 8;
	const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
	const ACCEPTED_TYPES = ['image/webp', 'image/png'];
	const TYPE_FOLDER: Record<string, string> = { ship: 'spaceships', bullet: 'bullets' };

	let items = $state<Item[]>([]);
	let loading = $state(true);
	let listError = $state<string | null>(null);
	let listTab = $state<ItemTab>('ship');
	const listed = $derived(filterByTab(items, listTab));

	let kind = $state<ItemTab>('ship');
	let name = $state('');
	let sprite = $state('');
	let spriteTouched = $state(false);
	let description = $state('');
	let price = $state(0);
	let priceGalactics = $state(0);
	let newImages = $state<PickedImage[]>([]);
	let creating = $state(false);
	let createError = $state<string | null>(null);
	let createdName = $state<string | null>(null);

	const createType = $derived(kind === 'ship' ? 'ship' : 'bullet');
	const effectiveSprite = $derived(spriteTouched ? sprite : slugify(name));

	let selected = $state<Item | null>(null);
	let editName = $state('');
	let editDescription = $state('');
	let editPrice = $state(0);
	let editGalactics = $state(0);
	let editImages = $state<PickedImage[]>([]);
	let saving = $state(false);
	let editError = $state<string | null>(null);
	let editDone = $state<string | null>(null);
	let confirmingDelete = $state(false);
	let deletedNotice = $state<string | null>(null);

	onMount(loadItems);

	async function loadItems() {
		loading = true;
		listError = null;
		try {
			items = (await api.admin.items()).items;
		} catch (e) {
			listError = e instanceof Error ? e.message : 'Chargement impossible';
		} finally {
			loading = false;
		}
	}

	function slugify(value: string): string {
		return value
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40);
	}

	function readAsDataUrl(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(new Error(`Lecture impossible : ${file.name}`));
			reader.readAsDataURL(file);
		});
	}

	// Files are sorted by name so that ship-1.png, ship-2.png… become f1, f2…
	async function pickImages(files: FileList | null): Promise<PickedImage[]> {
		const list = Array.from(files ?? []).sort((a, b) =>
			a.name.localeCompare(b.name, undefined, { numeric: true })
		);
		if (list.length > MAX_FRAMES) throw new Error(`${MAX_FRAMES} images maximum`);
		if (new Set(list.map((f) => f.type)).size > 1)
			throw new Error('Toutes les images doivent avoir le même format');
		for (const f of list) {
			if (!ACCEPTED_TYPES.includes(f.type)) throw new Error(`${f.name} n'est ni un WebP ni un PNG`);
			if (f.size > MAX_IMAGE_BYTES) throw new Error(`${f.name} dépasse 2 Mo`);
		}
		return Promise.all(
			list.map(async (f) => {
				const dataUrl = await readAsDataUrl(f);
				return { name: f.name, dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
			})
		);
	}

	async function onNewImages(e: Event) {
		createError = null;
		try {
			newImages = await pickImages((e.currentTarget as HTMLInputElement).files);
		} catch (err) {
			newImages = [];
			createError = err instanceof Error ? err.message : 'Images invalides';
		}
	}

	async function onEditImages(e: Event) {
		editError = null;
		editDone = null;
		try {
			editImages = await pickImages((e.currentTarget as HTMLInputElement).files);
		} catch (err) {
			editImages = [];
			editError = err instanceof Error ? err.message : 'Images invalides';
		}
	}

	function resetCreateForm() {
		name = '';
		sprite = '';
		spriteTouched = false;
		description = '';
		price = 0;
		priceGalactics = 0;
		newImages = [];
	}

	async function createItem(e: SubmitEvent) {
		e.preventDefault();
		if (creating) return;
		createError = null;
		createdName = null;
		if (newImages.length === 0) {
			createError = 'Ajoute au moins une image';
			return;
		}
		creating = true;
		try {
			const { item } = await api.admin.createItem({
				name: name.trim(),
				description: description.trim(),
				price: price || 0,
				priceGalactics: priceGalactics || 0,
				type: createType,
				bulletRole: kind === 'ship' ? undefined : kind,
				sprite: effectiveSprite,
				images: newImages.map((i) => i.base64)
			});
			items = [...items, item];
			showTab(kind);
			createdName = item.name;
			resetCreateForm();
			(e.target as HTMLFormElement).reset();
		} catch (err) {
			createError = err instanceof Error ? err.message : 'Création impossible';
		} finally {
			creating = false;
		}
	}

	function showTab(tab: ItemTab) {
		listTab = tab;
		if (selected && !filterByTab([selected], tab).length) selected = null;
	}

	function select(item: Item) {
		selected = item;
		editName = item.name;
		editDescription = item.description ?? '';
		editPrice = item.price ?? 0;
		editGalactics = item.priceGalactics ?? 0;
		editImages = [];
		editError = null;
		editDone = null;
		confirmingDelete = false;
		deletedNotice = null;
	}

	function replaceInList(updated: Item) {
		items = items.map((i) => (i._id === updated._id ? updated : i));
		select(updated);
	}

	async function saveDetails() {
		if (!selected || saving) return;
		const changes: ItemChanges = {};
		if (editName.trim() !== selected.name) changes.name = editName.trim();
		if (editDescription.trim() !== (selected.description ?? ''))
			changes.description = editDescription.trim();
		if ((editPrice || 0) !== (selected.price ?? 0)) changes.price = editPrice || 0;
		if ((editGalactics || 0) !== (selected.priceGalactics ?? 0))
			changes.priceGalactics = editGalactics || 0;
		if (Object.keys(changes).length === 0) {
			editDone = 'Rien à enregistrer';
			return;
		}
		saving = true;
		editError = null;
		editDone = null;
		try {
			const { item } = await api.admin.updateItem(selected._id, changes);
			replaceInList(item);
			editDone = 'Modifications enregistrées';
		} catch (err) {
			editError = err instanceof Error ? err.message : 'Enregistrement impossible';
		} finally {
			saving = false;
		}
	}

	async function saveImages() {
		if (!selected || saving || editImages.length === 0) return;
		saving = true;
		editError = null;
		editDone = null;
		try {
			const { item } = await api.admin.replaceImages(
				selected._id,
				editImages.map((i) => i.base64)
			);
			replaceInList(item);
			editDone = 'Images remplacées';
		} catch (err) {
			editError = err instanceof Error ? err.message : 'Envoi impossible';
		} finally {
			saving = false;
		}
	}

	async function deleteSelected() {
		if (!selected || saving) return;
		const target = selected;
		saving = true;
		editError = null;
		editDone = null;
		try {
			const { owners } = await api.admin.deleteItem(target._id);
			items = items.filter((i) => i._id !== target._id);
			selected = null;
			deletedNotice = `${target.name} supprimé${owners ? `, retiré de ${owners} inventaire${owners > 1 ? 's' : ''}` : ''}`;
		} catch (err) {
			editError = err instanceof Error ? err.message : 'Suppression impossible';
			confirmingDelete = false;
		} finally {
			saving = false;
		}
	}

	function kindLabel(item: Item): string {
		if (item.type === 'ship') return 'Vaisseau';
		return item.bulletRole === 'secondary' ? 'Tir secondaire' : 'Tir principal';
	}
</script>

<div class="layout">
	<section class="panel">
		<h2><Plus size={16} /> Nouvel item</h2>
		<form onsubmit={createItem} class="form">
			<div class="kind-picker" role="radiogroup" aria-label="Type d'item">
				{#each ITEM_TABS as tab (tab.key)}
					<button
						type="button"
						role="radio"
						aria-checked={kind === tab.key}
						class:active={kind === tab.key}
						onclick={() => (kind = tab.key)}>{tab.label}</button
					>
				{/each}
			</div>

			<label>
				<span>Nom</span>
				<input bind:value={name} maxlength="40" required placeholder="Faucon noir" />
			</label>

			<label>
				<span>Dossier des images</span>
				<input
					value={effectiveSprite}
					oninput={(e) => {
						spriteTouched = true;
						sprite = slugify(e.currentTarget.value);
					}}
					maxlength="40"
					required
				/>
				<small>
					assets/{TYPE_FOLDER[createType]}/<strong>{effectiveSprite || '…'}</strong>/f1.webp
				</small>
			</label>

			<label>
				<span>Description</span>
				<input bind:value={description} maxlength="200" placeholder="Vaisseau noir." />
			</label>

			<div class="row">
				<label>
					<span>Prix en crédits</span>
					<input type="number" bind:value={price} min="0" max="1000000" step="1" required />
				</label>
				<label>
					<span>Prix en Galactics</span>
					<input type="number" bind:value={priceGalactics} min="0" max="10000" step="1" />
				</label>
			</div>
			{#if price === 0 && priceGalactics === 0}
				<p class="hint">Gratuit : il sera donné à tous les joueurs.</p>
			{/if}

			<label>
				<span>Images (WebP ou PNG, une par étape d'animation)</span>
				<input type="file" accept="image/webp,image/png" multiple onchange={onNewImages} />
				<small>Les fichiers sont pris dans l'ordre de leur nom, {MAX_FRAMES} max.</small>
			</label>

			{#if newImages.length}
				<div class="picked">
					<ItemPreview urls={newImages.map((i) => i.dataUrl)} size={72} alt="aperçu" />
					<ol>
						{#each newImages as img, i (img.name)}
							<li>f{i + 1} ← {img.name}</li>
						{/each}
					</ol>
				</div>
			{/if}

			{#if createError}<p class="error" role="alert">{createError}</p>{/if}
			{#if createdName}<p class="success">{createdName} est en vente dans le hangar.</p>{/if}

			<button class="btn btn-primary" type="submit" disabled={creating}>
				{creating ? 'Création…' : "Créer l'item"}
			</button>
		</form>
	</section>

	<section class="panel">
		<h2>Items existants</h2>
		<div class="tabs">
			{#each ITEM_TABS as tab (tab.key)}
				<button class:active={listTab === tab.key} onclick={() => showTab(tab.key)}>
					{tab.label}
					<span class="count">{filterByTab(items, tab.key).length}</span>
				</button>
			{/each}
		</div>

		{#if loading}
			<p class="muted">Chargement…</p>
		{:else if listError}
			<p class="error" role="alert">{listError}</p>
		{:else if listed.length === 0}
			<p class="muted">Aucun item dans cette catégorie.</p>
		{:else}
			<ul class="item-list">
				{#each listed as item (item._id)}
					<li>
						<button
							class="item-row"
							class:selected={selected?._id === item._id}
							onclick={() => select(item)}
						>
							<ItemPreview urls={itemFrameUrls(item)} size={44} alt={item.name} />
							<span class="item-main">
								<span class="item-name">{item.name}</span>
								<span class="item-meta"
									>{item.sprite} · {item.frames ?? 0} image{(item.frames ?? 0) > 1
										? 's'
										: ''}</span
								>
							</span>
							<span class="item-price">
								{#if !item.price && !item.priceGalactics}
									Gratuit
								{:else}
									{#if item.price}⭐ {item.price}{/if}
									{#if item.priceGalactics}<span class="gem"
											><Gem size={11} />{item.priceGalactics}</span
										>{/if}
								{/if}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if selected}
			<div class="editor">
				<div class="editor-head">
					<ItemPreview urls={itemFrameUrls(selected)} size={64} alt={selected.name} />
					<div>
						<h3>{selected.name}</h3>
						<p class="muted">
							{kindLabel(selected)} · assets/{TYPE_FOLDER[selected.type]}/{selected.sprite}/
						</p>
					</div>
				</div>

				<label>
					<span>Nom</span>
					<input bind:value={editName} maxlength="40" />
				</label>
				<label>
					<span>Description</span>
					<input bind:value={editDescription} maxlength="200" />
				</label>
				<div class="row">
					<label>
						<span>Prix en crédits</span>
						<input type="number" bind:value={editPrice} min="0" max="1000000" step="1" />
					</label>
					<label>
						<span>Prix en Galactics</span>
						<input type="number" bind:value={editGalactics} min="0" max="10000" step="1" />
					</label>
				</div>
				<button class="btn btn-secondary" onclick={saveDetails} disabled={saving}>
					Enregistrer
				</button>

				<label class="replace">
					<span>Remplacer les images</span>
					<input type="file" accept="image/webp,image/png" multiple onchange={onEditImages} />
				</label>
				{#if editImages.length}
					<div class="picked">
						<ItemPreview urls={editImages.map((i) => i.dataUrl)} size={64} alt="aperçu" />
						<button class="btn btn-secondary" onclick={saveImages} disabled={saving}>
							Remplacer par ces {editImages.length} image{editImages.length > 1 ? 's' : ''}
						</button>
					</div>
				{/if}

				{#if editError}<p class="error" role="alert">{editError}</p>{/if}
				{#if editDone}<p class="success">{editDone}</p>{/if}

				<div class="delete-zone">
					{#if confirmingDelete}
						<p>
							Supprimer {selected.name} ? Ses images seront effacées, il sera retiré des inventaires
							et les joueurs qui l'utilisent reprendront l'équipement de base.
						</p>
						<div class="delete-actions">
							<button class="btn btn-danger btn-sm" onclick={deleteSelected} disabled={saving}>
								Supprimer définitivement
							</button>
							<button class="btn btn-secondary btn-sm" onclick={() => (confirmingDelete = false)}>
								Annuler
							</button>
						</div>
					{:else}
						<button class="btn btn-secondary btn-sm" onclick={() => (confirmingDelete = true)}>
							Supprimer cet item
						</button>
					{/if}
				</div>
			</div>
		{:else if deletedNotice}
			<p class="success">{deletedNotice}</p>
		{/if}
	</section>
</div>

<style>
	.delete-zone {
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px solid rgba(255, 90, 90, 0.25);
	}
	.delete-zone p {
		margin: 0 0 0.75rem;
		font-size: 0.85rem;
	}
	.delete-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
		gap: 1.25rem;
		align-items: start;
	}
	@media (max-width: 860px) {
		.layout {
			grid-template-columns: 1fr;
		}
	}
	.panel {
		background: rgba(10, 14, 36, 0.85);
		border: 1px solid rgba(77, 217, 255, 0.15);
		border-radius: 14px;
		padding: 1.25rem;
	}
	h2 {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 1rem;
		color: #c0c8ff;
		margin-bottom: 1rem;
	}
	h3 {
		font-size: 1rem;
		color: #c0e8ff;
	}
	.form,
	.editor {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	label > span {
		font-size: 0.78rem;
		color: #8090c0;
	}
	small,
	.hint {
		font-size: 0.72rem;
		color: #5a6290;
	}
	small strong {
		color: #4dd9ff;
		font-weight: 600;
	}
	input[type='file'] {
		padding: 0.45rem;
		font-size: 0.82rem;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}
	.kind-picker,
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.kind-picker button,
	.tabs button {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		background: rgba(5, 8, 22, 0.85);
		border: 1px solid rgba(77, 217, 255, 0.18);
		border-radius: 8px;
		color: #8090c0;
		padding: 0.4rem 0.75rem;
		font-size: 0.8rem;
		cursor: pointer;
		font-family: inherit;
	}
	.kind-picker button.active,
	.tabs button.active {
		border-color: #4dd9ff;
		color: #c0e8ff;
		box-shadow: 0 0 10px rgba(77, 217, 255, 0.25);
	}
	.count {
		font-size: 0.7rem;
		color: #5a6290;
	}
	.picked {
		display: flex;
		align-items: center;
		gap: 1rem;
		background: rgba(5, 5, 25, 0.8);
		border-radius: 10px;
		padding: 0.6rem 0.8rem;
	}
	.picked ol {
		list-style: none;
		font-size: 0.75rem;
		color: #8090c0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.error {
		color: #ff8080;
		font-size: 0.82rem;
	}
	.success {
		color: #80e880;
		font-size: 0.82rem;
	}
	.muted {
		color: #5a6290;
		font-size: 0.82rem;
	}
	.tabs {
		margin-bottom: 0.85rem;
	}
	.item-list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.item-row {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.8rem;
		background: rgba(5, 8, 22, 0.85);
		border: 1px solid rgba(77, 217, 255, 0.12);
		border-radius: 10px;
		padding: 0.45rem 0.7rem;
		cursor: pointer;
		text-align: left;
		color: inherit;
		font-family: inherit;
	}
	.item-row:hover {
		border-color: rgba(77, 217, 255, 0.4);
	}
	.item-row.selected {
		border-color: #ffcc55;
		box-shadow: 0 0 10px rgba(255, 204, 85, 0.25);
	}
	.item-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.item-name {
		color: #c0c8ff;
		font-size: 0.9rem;
	}
	.item-meta {
		color: #5a6290;
		font-size: 0.72rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.item-price {
		display: flex;
		gap: 0.4rem;
		font-size: 0.78rem;
		font-weight: 700;
		color: #ffcc55;
		white-space: nowrap;
	}
	.gem {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		color: #c9a0ff;
	}
	.editor {
		margin-top: 1.25rem;
		padding-top: 1.25rem;
		border-top: 1px solid rgba(77, 217, 255, 0.12);
	}
	.editor-head {
		display: flex;
		align-items: center;
		gap: 0.9rem;
	}
	.replace {
		margin-top: 0.5rem;
	}
</style>

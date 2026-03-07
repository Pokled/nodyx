<script lang="ts">
    import NetworkDoctor from '$lib/components/NetworkDoctor.svelte';
    import { page } from '$app/stores';
    import { invalidateAll } from '$app/navigation';
    import { PUBLIC_API_URL } from '$env/static/public';

    // ── Instances liées (Galaxy Bar) ──────────────────────────────────────────

    const user = $derived($page.data.user as { linked_instances?: string[] } | null);
    let linkedSlugs = $state<string[]>([]);
    $effect(() => { linkedSlugs = user?.linked_instances ?? [] });

    // Toutes les instances du directory (pour validation + noms/logos)
    const directoryInstances = $derived($page.data.directoryInstances as Array<{
        slug: string; name: string; url: string; logo_url: string | null;
    }> ?? []);

    let newSlug   = $state('');
    let slugError = $state('');
    let slugLoading = $state(false);

    async function addInstance() {
        slugError = '';
        const slug = newSlug.trim().toLowerCase();
        if (!slug) return;
        if (!/^[a-z0-9-]{1,50}$/.test(slug)) { slugError = 'Slug invalide (lettres, chiffres, tirets)'; return; }
        if (linkedSlugs.includes(slug)) { slugError = 'Déjà ajouté'; return; }
        if (!directoryInstances.find(i => i.slug === slug)) {
            slugError = 'Instance introuvable dans l\'annuaire';
            return;
        }

        slugLoading = true;
        try {
            const res = await fetch(`${PUBLIC_API_URL}/api/v1/users/me/linked-instances`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${$page.data.token}` },
                body: JSON.stringify({ action: 'add', slug }),
            });
            const json = await res.json();
            if (!res.ok) { slugError = json.error ?? 'Erreur'; return; }
            linkedSlugs = json.linked_instances ?? [];
            newSlug = '';
            invalidateAll();
        } finally {
            slugLoading = false;
        }
    }

    async function removeInstance(slug: string) {
        const res = await fetch(`${PUBLIC_API_URL}/api/v1/users/me/linked-instances`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${$page.data.token}` },
            body: JSON.stringify({ action: 'remove', slug }),
        });
        const json = await res.json();
        if (res.ok) {
            linkedSlugs = json.linked_instances ?? [];
            invalidateAll();
        }
    }
</script>

<div class="min-h-screen bg-[#050505] text-white p-8">
    <div class="max-w-2xl mx-auto space-y-12">
        <header>
            <h1 class="text-5xl font-black italic uppercase tracking-tighter mb-2">Settings</h1>
            <div class="h-1 w-20 bg-indigo-600"></div>
        </header>

        <section>
            <h2 class="text-sm font-bold text-gray-500 uppercase tracking-[0.2em] mb-6">Infrastructure & Réseau</h2>
            <NetworkDoctor />
        </section>

        <!-- ── Instances liées ──────────────────────────────────────────────── -->
        {#if user}
        <section>
            <h2 class="text-sm font-bold text-gray-500 uppercase tracking-[0.2em] mb-2">Mes instances (Galaxy Bar)</h2>
            <p class="text-xs text-gray-600 mb-6">
                Les instances sur lesquelles tu as un compte s'affichent dans la barre latérale gauche pour un accès rapide.
            </p>

            <!-- Liste des instances liées -->
            {#if linkedSlugs.length > 0}
                <div class="flex flex-col gap-2 mb-6">
                    {#each linkedSlugs as slug}
                        {@const known = directoryInstances.find(i => i.slug === slug)}
                        <div class="flex items-center justify-between gap-3 px-3 py-2.5
                                    rounded-lg border border-gray-800 bg-gray-900/60">
                            <div class="flex items-center gap-2.5">
                                <div class="w-7 h-7 rounded-lg bg-indigo-900 border border-gray-700
                                            flex items-center justify-center overflow-hidden shrink-0">
                                    {#if known?.logo_url}
                                        <img src={known.logo_url} alt={known.name} class="w-full h-full object-cover" />
                                    {:else}
                                        <span class="text-xs font-bold text-indigo-300">{slug.charAt(0).toUpperCase()}</span>
                                    {/if}
                                </div>
                                <div>
                                    <p class="text-sm font-medium text-white">{known?.name ?? slug}</p>
                                    <p class="text-xs text-gray-600 font-mono">{known?.url ?? slug + '.nexusnode.app'}</p>
                                </div>
                            </div>
                            <button
                                onclick={() => removeInstance(slug)}
                                class="text-xs text-gray-600 hover:text-red-400 transition-colors px-2 py-1"
                            >
                                Retirer
                            </button>
                        </div>
                    {/each}
                </div>
            {:else}
                <p class="text-sm text-gray-600 mb-6">Aucune instance liée pour l'instant.</p>
            {/if}

            <!-- Ajouter une instance -->
            {#if directoryInstances.length > 0}
                <div class="flex gap-2">
                    <div class="flex-1 relative">
                        <input
                            list="directory-slugs"
                            type="text"
                            bind:value={newSlug}
                            placeholder="slug (ex: french-godot)"
                            onkeydown={(e) => e.key === 'Enter' && addInstance()}
                            class="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700
                                   text-sm text-gray-200 placeholder-gray-600
                                   focus:outline-none focus:border-indigo-600 transition-colors"
                        />
                        <datalist id="directory-slugs">
                            {#each directoryInstances.filter(i => !linkedSlugs.includes(i.slug)) as inst}
                                <option value={inst.slug}>{inst.name}</option>
                            {/each}
                        </datalist>
                        {#if slugError}
                            <p class="absolute -bottom-5 left-0 text-xs text-red-400">{slugError}</p>
                        {/if}
                    </div>
                    <button
                        onclick={addInstance}
                        disabled={slugLoading}
                        class="px-4 py-2 rounded-lg bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50
                               text-sm font-semibold text-white transition-colors"
                    >
                        {slugLoading ? '…' : 'Ajouter'}
                    </button>
                </div>
                <p class="text-xs text-gray-700 mt-7">
                    Le slug est le sous-domaine de l'instance — ex: <code class="text-indigo-500">french-godot</code> pour <code class="text-gray-500">french-godot.nexusnode.app</code>
                </p>
            {/if}
        </section>
        {/if}
    </div>
</div>
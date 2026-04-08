<script lang="ts">
	import { t } from '$lib/i18n';
	const tFn = $derived($t);

	interface Props {
		config:   Record<string, unknown>;
		instance: Record<string, unknown>;
		user:     Record<string, unknown> | null;
		title?:   string | null;
	}

	let { config, instance, user }: Props = $props();

	// Config fields with defaults
	const style           = $derived((config.style as string) ?? 'centered');
	const overlayOpacity  = $derived((config.overlay_opacity as number) ?? 0.5);
	const ctaText         = $derived((config.cta_text as string) ?? null);
	const ctaUrl          = $derived((config.cta_url as string) ?? null);
	const subtitle        = $derived((config.subtitle as string) ?? null);
	const bgImageUrl      = $derived((config.background_image_url as string) ?? (instance.banner_url as string) ?? null);
	const nightImageUrl   = $derived((config.night_image_url as string) ?? null);

	// Dynamic variant (resolved server-side via featuredEvent / heroVariant from page data)
	const variant         = $derived((config._variant as string) ?? 'default');
	const featuredEvent   = $derived((config._featured_event as Record<string,unknown>) ?? null);
	const isLive          = $derived(variant === 'live');
	const isEvent         = $derived(variant === 'event' && !!featuredEvent);

	// Derive display name and description from instance
	const name        = $derived((instance.name as string) ?? 'Nodyx');
	const description = $derived((instance.description as string) ?? '');
	const logoUrl     = $derived((instance.logo_url as string) ?? null);
	const heroLetter  = $derived(name?.charAt(0).toUpperCase() ?? 'N');

	// Event variant info
	const eventTitle  = $derived(isEvent ? (featuredEvent?.title as string) : null);
	const eventCover  = $derived(isEvent ? (featuredEvent?.cover_url as string) : null);

	// Effective background
	const effectiveBg = $derived(eventCover ?? bgImageUrl);
</script>

<section
	class="relative overflow-hidden noise"
	style="background: #0a0a0f; border-bottom: 1px solid rgba(255,255,255,.05); min-height: 220px"
>
	<!-- Background image -->
	{#if effectiveBg}
		<img
			src={effectiveBg} alt=""
			class="absolute inset-0 w-full h-full object-cover transition-opacity duration-700"
			style="opacity:{overlayOpacity * 0.12}"
		/>
	{/if}

	<!-- Decorative orbs -->
	<div class="absolute -top-40 -left-20 w-[500px] h-[500px] rounded-full pointer-events-none"
	     style="background: radial-gradient(circle, rgba(124,58,237,.14) 0%, transparent 65%)"></div>
	<div class="absolute -bottom-20 right-0 w-96 h-96 rounded-full pointer-events-none"
	     style="background: radial-gradient(circle, rgba(6,182,212,.08) 0%, transparent 65%)"></div>

	<!-- Decorative letter -->
	<div class="absolute right-6 top-1/2 -translate-y-1/2 opacity-70 select-none pointer-events-none"
	     style="font-family:'Space Grotesk',sans-serif; font-weight:800; font-size:clamp(140px,20vw,280px); line-height:1; background:linear-gradient(135deg,rgba(124,58,237,.5) 0%,rgba(6,182,212,.2) 50%,transparent 80%); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text"
	     aria-hidden="true">{heroLetter}</div>

	<!-- Live badge -->
	{#if isLive}
		<div class="absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-1.5"
		     style="background:rgba(239,68,68,.15); border:1px solid rgba(239,68,68,.4)">
			<span class="w-2 h-2 rounded-full animate-pulse" style="background:#ef4444"></span>
			<span class="text-xs font-black uppercase tracking-widest" style="color:#ef4444">Live</span>
		</div>
	{/if}

	<div class="relative z-10 px-8 pt-6 pb-5 flex flex-col gap-4">

		{#if isEvent && eventTitle}
			<!-- Event variant: show event title instead of instance name -->
			<div class="flex items-center gap-3 mb-1">
				<span class="h-px w-10" style="background:linear-gradient(to right,#7c3aed,#06b6d4)"></span>
				<span class="text-[10px] font-black uppercase tracking-[.22em]" style="color:#a78bfa;font-family:'Space Grotesk',sans-serif">
					{tFn('home.upcoming_event') || 'Événement à venir'}
				</span>
			</div>
			<h1 class="font-extrabold leading-none" style="font-family:'Space Grotesk',sans-serif; font-size:clamp(1.4rem,2.8vw,2.2rem); background:linear-gradient(135deg,#a78bfa,#06b6d4); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text">
				{eventTitle}
			</h1>
		{:else}
			<!-- Default: instance identity -->
			<div class="flex items-center gap-5">
				{#if logoUrl}
					<img src={logoUrl} alt={name}
					     class="w-12 h-12 object-cover shrink-0"
					     style="outline:2px solid rgba(124,58,237,.5); outline-offset:2px" />
				{:else}
					<div class="w-12 h-12 flex items-center justify-center shrink-0 text-xl font-black text-white"
					     style="font-family:'Space Grotesk',sans-serif; background:linear-gradient(135deg,rgba(124,58,237,.4),rgba(6,182,212,.15)); border:1px solid rgba(124,58,237,.3)">
						{heroLetter}
					</div>
				{/if}
				<div>
					<h1 class="font-extrabold leading-none mb-1"
					    style="font-family:'Space Grotesk',sans-serif; font-size:clamp(1.3rem,2.5vw,1.9rem); background:linear-gradient(135deg,#a78bfa,#06b6d4); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text">
						{name}
					</h1>
					{#if subtitle || description}
						<p class="text-sm max-w-lg leading-relaxed" style="color:#6b7280">
							{subtitle || description}
						</p>
					{/if}
				</div>
			</div>
		{/if}

		<!-- CTA row -->
		<div class="flex items-center gap-2 mt-1">
			{#if ctaText && ctaUrl}
				<a href={ctaUrl}
				   class="px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-white transition-all"
				   style="font-family:'Space Grotesk',sans-serif; background:linear-gradient(135deg,#7c3aed,#0e7490); border:1px solid rgba(124,58,237,.4)">
					{ctaText}
				</a>
			{:else if user}
				<a href="/forum"
				   class="px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-white transition-all"
				   style="font-family:'Space Grotesk',sans-serif; background:linear-gradient(135deg,#7c3aed,#0e7490); border:1px solid rgba(124,58,237,.4)">
					{tFn('common.forum')}
				</a>
			{:else}
				<a href="/auth/login"
				   class="px-4 py-2.5 text-sm font-bold uppercase tracking-wider transition-all"
				   style="font-family:'Space Grotesk',sans-serif; color:#9ca3af; border:1px solid rgba(255,255,255,.1)">
					{tFn('common.login')}
				</a>
				<a href="/auth/register"
				   class="px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-white transition-all"
				   style="font-family:'Space Grotesk',sans-serif; background:linear-gradient(135deg,#7c3aed,#0e7490); border:1px solid rgba(124,58,237,.4)">
					{tFn('common.join')}
				</a>
			{/if}
		</div>
	</div>
</section>

<style>
	.noise::after {
		content: ''; position: absolute; inset: 0; pointer-events: none;
		background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
		opacity: .4;
	}
</style>

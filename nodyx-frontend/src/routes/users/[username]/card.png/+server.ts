import type { RequestHandler } from './$types'
import { apiFetch } from '$lib/api'
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import { error } from '@sveltejs/kit'
import { readFileSync } from 'fs'

// Load system fonts once at module level (DejaVu — always available on Ubuntu)
const fontRegular = readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
const fontBold    = readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')

// FNV-1a hash → deterministic hue from username
function fnv1a(str: string): number {
	let h = 2166136261
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i)
		h = (h * 16777619) >>> 0
	}
	return h
}

function userHue(username: string): number {
	return fnv1a(username) % 360
}

function calcLevel(pts: number) {
	const level = Math.floor(Math.sqrt(Math.max(0, pts) / 10)) + 1
	const from  = (level - 1) * (level - 1) * 10
	const to    = level * level * 10
	const pct   = Math.min(100, Math.round(((pts - from) / (to - from)) * 100))
	return { level, pct }
}

// Helper: simple text span
function text(content: string, style: Record<string, unknown>) {
	return { type: 'span', props: { style: { display: 'flex', ...style }, children: content } }
}

// Helper: flex div
function flex(style: Record<string, unknown>, children: unknown[]) {
	return { type: 'div', props: { style: { display: 'flex', ...style }, children } }
}

// Helper: absolute positioned div (single child or background — no display needed for satori if single child)
function abs(style: Record<string, unknown>, children?: unknown) {
	return {
		type: 'div',
		props: {
			style: { display: 'flex', position: 'absolute', ...style },
			children: children !== undefined ? [children] : undefined,
		},
	}
}

export const GET: RequestHandler = async ({ params, fetch }) => {
	const { username } = params

	const res = await apiFetch(fetch, `/users/${username}/profile`)
	if (!res.ok) error(404, 'User not found')
	const profile = await res.json()

	const displayName = (profile.display_name || profile.username) as string
	const pts         = Number(profile.points ?? 0)
	const { level, pct } = calcLevel(pts)
	const postCount   = Number(profile.post_count ?? 0)
	const grade       = profile.grade?.name as string | null ?? null
	const gradeBg     = (profile.grade?.color as string | null) ?? '#6366f1'
	const initials    = displayName.trim().charAt(0).toUpperCase()

	// Deterministic gradient from username
	const hue = userHue(username)
	const c1  = `hsl(${hue}, 65%, 30%)`
	const c2  = `hsl(${(hue + 60) % 360}, 55%, 25%)`

	// Fetch avatar as data URL
	let avatarDataUrl: string | null = null
	if (profile.avatar) {
		try {
			const r = await fetch(profile.avatar)
			if (r.ok) {
				const buf = await r.arrayBuffer()
				const b64 = Buffer.from(buf).toString('base64')
				const ct  = r.headers.get('content-type') ?? 'image/jpeg'
				avatarDataUrl = `data:${ct};base64,${b64}`
			}
		} catch { /* ignore */ }
	}

	const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
	const xpW = Math.round((pct / 100) * 242) // track is 242px wide

	// ── Layout (600×315) ──────────────────────────────────────────────────────
	const tree = flex(
		{
			width: '600px',
			height: '315px',
			flexDirection: 'column',
			background: '#09090f',
			fontFamily: 'sans-serif',
			position: 'relative',
			overflow: 'hidden',
		},
		[
			// ── Banner ────────────────────────────────────────────────────────
			abs({ top: 0, left: 0, right: 0, height: '130px', background: `linear-gradient(135deg, ${c1}, ${c2})` }),

			// ── Dark bottom section ────────────────────────────────────────
			abs({ top: '110px', left: 0, right: 0, bottom: 0, background: '#0d0d16' }),

			// ── Avatar circle ─────────────────────────────────────────────
			abs(
				{
					top: '74px', left: '28px',
					width: '76px', height: '76px',
					borderRadius: '50%',
					border: '3px solid #09090f',
					overflow: 'hidden',
					background: '#1a1040',
					alignItems: 'center',
					justifyContent: 'center',
				},
				avatarDataUrl
					? { type: 'img', props: { src: avatarDataUrl, style: { width: '76px', height: '76px', objectFit: 'cover' } } }
					: text(initials, { fontSize: '28px', fontWeight: '700', color: 'rgba(255,255,255,0.7)' })
			),

			// ── Outer ring ─────────────────────────────────────────────────
			abs({ top: '70px', left: '24px', width: '84px', height: '84px', borderRadius: '50%', border: '1.5px solid rgba(99,102,241,0.4)' }),

			// ── Level badge (top-right) ────────────────────────────────────
			abs(
				{ top: '14px', right: '18px', flexDirection: 'column', alignItems: 'flex-end', gap: '0px' },
				flex({ flexDirection: 'column', alignItems: 'flex-end', gap: '0px' }, [
					text('LEVEL', { fontSize: '10px', fontWeight: '700', color: 'rgba(255,255,255,0.35)', letterSpacing: '1.5px' }),
					text(String(level), { fontSize: '38px', fontWeight: '900', color: 'rgba(255,255,255,0.9)', letterSpacing: '-2px', lineHeight: '1' }),
				])
			),

			// ── Name + grade area ──────────────────────────────────────────
			abs(
				{ top: '136px', left: '120px', flexDirection: 'column', gap: '5px' },
				flex({ flexDirection: 'column', gap: '5px' }, [
					text(displayName, {
						fontSize: '20px',
						fontWeight: '800',
						color: 'rgba(255,255,255,0.9)',
						letterSpacing: '-0.5px',
					}),
					...(grade
						? [flex(
							{
								padding: '2px 8px',
								background: gradeBg + '22',
								border: `1px solid ${gradeBg}55`,
								alignItems: 'center',
								justifyContent: 'center',
							},
							[text(grade.toUpperCase(), { fontSize: '9px', fontWeight: '700', color: gradeBg, letterSpacing: '1.2px' })]
						  )]
						: []
					),
				])
			),

			// ── XP progress bar ────────────────────────────────────────────
			abs(
				{ top: '192px', left: '28px', right: '28px', flexDirection: 'column', gap: '3px' },
				flex({ flexDirection: 'column', gap: '3px' }, [
					flex(
						{ width: '100%', height: '3px', background: 'rgba(255,255,255,0.07)' },
						[flex({ width: `${xpW}px`, height: '3px', background: 'linear-gradient(90deg,#6366f1,#a855f7)' }, [])]
					),
					text(`${pct}% vers le niveau ${level + 1}`, { fontSize: '9px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.3px' }),
				])
			),

			// ── Stats row ──────────────────────────────────────────────────
			abs(
				{ bottom: '36px', left: '28px', right: '28px' },
				flex(
					{
						width: '100%',
						borderTop: '1px solid rgba(255,255,255,0.07)',
						paddingTop: '14px',
						alignItems: 'center',
					},
					[
						// Posts
						flex({ flex: '1', flexDirection: 'column', gap: '2px' }, [
							text(fmt(postCount), { fontSize: '18px', fontWeight: '800', color: 'rgba(255,255,255,0.85)', letterSpacing: '-0.5px' }),
							text('POSTS', { fontSize: '9px', color: 'rgba(255,255,255,0.25)', fontWeight: '700', letterSpacing: '1px' }),
						]),
						flex({ width: '1px', height: '28px', background: 'rgba(255,255,255,0.07)', flexShrink: '0', margin: '0 20px' }, []),
						// XP
						flex({ flex: '1', flexDirection: 'column', gap: '2px' }, [
							text(fmt(pts), { fontSize: '18px', fontWeight: '800', color: 'rgba(255,255,255,0.85)', letterSpacing: '-0.5px' }),
							text('POINTS XP', { fontSize: '9px', color: 'rgba(255,255,255,0.25)', fontWeight: '700', letterSpacing: '1px' }),
						]),
						flex({ width: '1px', height: '28px', background: 'rgba(255,255,255,0.07)', flexShrink: '0', margin: '0 20px' }, []),
						// Level
						flex({ flex: '1', flexDirection: 'column', gap: '2px' }, [
							text(`Lv. ${level}`, { fontSize: '18px', fontWeight: '800', color: 'rgba(255,255,255,0.85)', letterSpacing: '-0.5px' }),
							text('NIVEAU', { fontSize: '9px', color: 'rgba(255,255,255,0.25)', fontWeight: '700', letterSpacing: '1px' }),
						]),
					]
				)
			),

			// ── Nodyx branding ─────────────────────────────────────────────
			abs(
				{ bottom: '12px', right: '18px' },
				text('nodyx.org', { fontSize: '9px', color: 'rgba(255,255,255,0.12)', fontWeight: '700', letterSpacing: '1px' })
			),
		]
	)

	const svg = await satori(tree, {
		width: 600,
		height: 315,
		fonts: [
			{ name: 'sans-serif', data: fontRegular, weight: 400, style: 'normal' },
			{ name: 'sans-serif', data: fontBold,    weight: 700, style: 'normal' },
			{ name: 'sans-serif', data: fontBold,    weight: 800, style: 'normal' },
			{ name: 'sans-serif', data: fontBold,    weight: 900, style: 'normal' },
		],
	})

	const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 600 } })
	const png   = Buffer.from(resvg.render().asPng())

	return new Response(png.buffer as ArrayBuffer, {
		headers: {
			'Content-Type':  'image/png',
			'Cache-Control': 'public, max-age=3600, s-maxage=3600',
		},
	})
}

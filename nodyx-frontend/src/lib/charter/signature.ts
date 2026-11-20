// L'écran Bienvenue (lot 7d-3, maquette v4 validée le 20/11/2026) : la signature qu'on
// vient de tracer se réécrit sous ses yeux. Le tracé ne quitte JAMAIS le navigateur (D15) :
// on le rejoue depuis la mémoire de la porte, puis il est jeté avec elle.
import type { Point } from './door'

/**
 * Les traits du tableau de signature, recadrés dans une boîte (sans déformation, centrés)
 * et écrits en un chemin SVG. Vide si rien n'a été tracé.
 */
export function signaturePath(strokes: Point[][], box = { w: 280, h: 92, pad: 6 }): string {
	const pts = strokes.flat()
	if (!pts.length) return ''
	const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
	const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
	const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1)
	const k = Math.min((box.w - 2 * box.pad) / w, (box.h - 2 * box.pad) / h)
	const ox = (box.w - w * k) / 2 - minX * k, oy = (box.h - h * k) / 2 - minY * k
	const n = (v: number) => String(Math.round(v * 10) / 10)
	return strokes
		.filter(st => st.length)
		.map(st => st.map((p, i) => `${i ? 'L' : 'M'}${n(p.x * k + ox)} ${n(p.y * k + oy)}`).join(' '))
		.join(' ')
}

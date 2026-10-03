/**
 * paletteFromImage.ts — « les couleurs de ta bannière »
 * (SPECS/NODYX_APPARENCE_CDC.md, onglet Ambiance).
 *
 * Propose à l'admin des accents tirés de sa propre bannière : un clic et
 * l'instance prend les couleurs de son décor. Tout se calcule dans le
 * navigateur, sur une réduction de l'image : aucun service externe.
 *
 * Un accent doit porter de la COULEUR : les noirs, blancs et gris sont
 * écartés, les teintes vives ET bien présentes passent devant, et les
 * propositions sont assez différentes entre elles pour valoir un choix.
 */
import { rgbToOklch, rgbToHex } from './shellTheme'

type Bin = { r: number; g: number; b: number; n: number }

/**
 * Pixels RGBA (ImageData.data) → jusqu'à `count` couleurs d'accent, de la
 * plus marquante à la moins marquante. Fonction pure, testée.
 */
export function extractPalette(pixels: Uint8ClampedArray | number[], count = 5): string[] {
	// 1. Regroupement grossier (4 bits par canal) : 4096 cases au plus.
	const bins = new Map<number, Bin>()
	for (let i = 0; i + 3 < pixels.length; i += 4) {
		if (pixels[i + 3] < 128) continue                       // transparent
		const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]
		const key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4)
		const bin = bins.get(key)
		if (bin) { bin.r += r; bin.g += g; bin.b += b; bin.n++ }
		else bins.set(key, { r, g, b, n: 1 })
	}

	// 2. Score : présence × saturation AU CARRÉ. Mesuré sur la vraie bannière
	//    des Vieux Looters (29/09) : à saturation simple, les grands aplats de
	//    brun terne passaient devant l'or lumineux qui fait son identité ; au
	//    carré, l'or arrive en tête. Les quasi-neutres et les tons trop sombres
	//    (L < 0,35) ne font pas des accents.
	const scored = [...bins.values()].map(bin => {
		const rgb: [number, number, number] = [bin.r / bin.n / 255, bin.g / bin.n / 255, bin.b / bin.n / 255]
		const lch = rgbToOklch(rgb)
		return { rgb, lch, score: bin.n * lch.c * lch.c }
	}).filter(c => c.lch.c >= 0.05 && c.lch.l >= 0.35 && c.lch.l <= 0.95)
		.sort((a, b) => b.score - a.score)

	// 3. Diversité : une proposition doit se distinguer des précédentes
	//    (distance en OKLab, perceptuellement uniforme).
	const picked: typeof scored = []
	const lab = (c: typeof scored[number]) => [c.lch.l, c.lch.c * Math.cos(c.lch.h * Math.PI / 180), c.lch.c * Math.sin(c.lch.h * Math.PI / 180)]
	for (const cand of scored) {
		const [l1, a1, b1] = lab(cand)
		if (picked.every(p => { const [l2, a2, b2] = lab(p); return Math.hypot(l1 - l2, a1 - a2, b1 - b2) > 0.1 })) {
			picked.push(cand)
			if (picked.length === count) break
		}
	}
	return picked.map(c => rgbToHex(c.rgb))
}

/**
 * Charge une image et renvoie ses pixels réduits (64 px de côté au plus :
 * largement assez pour une palette, instantané même pour une grande bannière).
 * Navigateur uniquement. null si l'image n'est pas lisible (autre origine
 * sans CORS, fichier cassé) : l'écran se contente alors du sélecteur libre.
 */
export async function loadImagePixels(url: string, size = 64): Promise<Uint8ClampedArray | null> {
	try {
		const img = new Image()
		img.crossOrigin = 'anonymous'
		img.decoding = 'async'
		img.src = url
		await img.decode()
		const ratio = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight))
		const w = Math.max(1, Math.round(img.naturalWidth * ratio)), h = Math.max(1, Math.round(img.naturalHeight * ratio))
		const canvas = document.createElement('canvas')
		canvas.width = w; canvas.height = h
		const ctx = canvas.getContext('2d', { willReadFrequently: true })
		if (!ctx) return null
		ctx.drawImage(img, 0, 0, w, h)
		return ctx.getImageData(0, 0, w, h).data
	} catch {
		return null
	}
}

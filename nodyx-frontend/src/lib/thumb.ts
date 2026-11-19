// La vignette d'une image téléversée, à la taille où elle est AFFICHÉE
// (nodyx-core/src/services/thumbnails.ts). Seules les images de l'instance
// (/uploads/…) sont réduites ; une adresse d'ailleurs passe telle quelle.
//
//   <img src={thumb(cover, 320)} srcset={thumbSrcset(cover, 320)} …>
//
// `cssWidth` : la largeur d'affichage en pixels CSS ; la vignette est la plus petite
// largeur prédéfinie qui la couvre (et le double pour les écrans haute densité).
export const THUMB_WIDTHS = [64, 128, 256, 384, 512, 768, 1024, 1536] as const

const LOCAL = /^\/uploads\/(?!_)([^?#]+\.(?:jpe?g|png|webp|gif|avif))$/i

function widthFor(px: number): number {
	return THUMB_WIDTHS.find(w => w >= px) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1]
}

/** La vignette, ou l'adresse d'origine si ce n'est pas une image de l'instance. */
export function thumb(url: string | null | undefined, cssWidth: number, opts: { still?: boolean } = {}): string {
	if (!url) return ''
	const m = LOCAL.exec(url)
	if (!m || url.includes('..')) return url
	return `/uploads/_w/${widthFor(Math.max(1, Math.round(cssWidth)))}${opts.still ? 's' : ''}/${m[1]}`
}

/** « 1x, 2x » pour les écrans haute densité ; vide si l'image n'est pas réductible. */
export function thumbSrcset(url: string | null | undefined, cssWidth: number, opts: { still?: boolean } = {}): string | undefined {
	const one = thumb(url, cssWidth, opts)
	if (!url || one === url) return undefined
	const two = thumb(url, cssWidth * 2, opts)
	return one === two ? undefined : `${one} 1x, ${two} 2x`
}

/** L'adresse d'origine d'une vignette (« /uploads/_w/384/posts/a.webp » → « /uploads/posts/a.webp »). */
export function originalOf(url: string): string | null {
	const m = /\/uploads\/_w\/\d{1,4}s?\/([^?#]+)$/.exec(url)
	return m && !m[1].includes('..') ? `/uploads/${m[1]}` : null
}

/**
 * Filet de sécurité : une vignette qui ne charge pas (image illisible, disque plein…)
 * est remplacée UNE fois par l'image d'origine. Jamais une image cassée à cause des
 * vignettes. Posé une fois par le layout ; renvoie de quoi le retirer.
 */
export function installThumbFallback(doc: Document = document): () => void {
	const onError = (e: Event) => {
		const img = e.target as HTMLImageElement | null
		if (!img || img.tagName !== 'IMG' || img.dataset.thumbFallback) return
		const orig = originalOf(new URL(img.currentSrc || img.src, doc.baseURI).pathname)
		if (!orig) return
		img.dataset.thumbFallback = '1'
		img.removeAttribute('srcset')
		img.src = orig
	}
	doc.addEventListener('error', onError, true)
	return () => doc.removeEventListener('error', onError, true)
}

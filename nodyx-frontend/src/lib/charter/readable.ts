// Une charte publiée que la personne connectée peut relire ? (rempli par le layout depuis
// /charter/status ; l'entrée « La charte » du menu du profil n'apparaît que si oui)
import { writable } from 'svelte/store'

export const charterReadable = writable<{ members: boolean; team: boolean }>({ members: false, team: false })

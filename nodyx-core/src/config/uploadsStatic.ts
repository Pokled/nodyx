import path from 'node:path'
import type { FastifyStaticOptions } from '@fastify/static'

/**
 * Comment le cœur sert `uploads/` sous `/uploads/`.
 *
 * `dotfiles: 'ignore'` : un fichier ou un dossier caché (`.gitkeep`, `.env`, `.cache/…`)
 * répond 404, comme s'il n'existait pas. Par défaut @fastify/static les sert (`'allow'`) :
 * le 20/11/2026 il n'y avait que des `.gitkeep` vides, mais un fichier caché déposé là un
 * jour (par un outil, une sauvegarde, un éditeur) aurait été public.
 */
export const uploadsStaticOptions = (cwd: string = process.cwd()): FastifyStaticOptions => ({
  root:          path.join(cwd, 'uploads'),
  prefix:        '/uploads/',
  decorateReply: false,
  dotfiles:      'ignore',
})

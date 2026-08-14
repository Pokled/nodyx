// Jeton d'extension : la seule identité acceptée par les routes /extensions/*.
//
// Une frame d'extension vit dans une origine opaque. Son `Origin` vaut donc
// `null`, et n'importe qui peut produire ça : ce n'est PAS une
// authentification. L'identité vient de ce jeton, et de lui seul.
// cf NODYX_SDK_SECURITY.md §4.3
//
// Chaque claim ferme un rejeu précis. Un jeton frappé pour une extension, une
// surface, un utilisateur et une instance ne vaut nulle part ailleurs.

import jwt from 'jsonwebtoken'
import { createHmac } from 'crypto'
import { SURFACE } from './limits'

export interface ExtensionTokenClaims {
  /** Origine de l'instance émettrice. */
  iss: string
  /** Toujours `nodyx-extension` : un jeton utilisateur ne peut pas s'y substituer. */
  aud: 'nodyx-extension'
  /** Instance : un jeton ne traverse pas d'une instance à l'autre. */
  ins: string
  /** Extension destinataire. */
  ext: string
  /** Surface destinataire, `page` ou `widget:<id>`. */
  sur: string
  /** Utilisateur, ou null pour un visiteur. */
  sub: string | null
  /** Permissions ACCORDÉES par l'admin, pas celles demandées au manifeste. */
  prm: string[]
  jti: string
  iat: number
  exp: number
}

export interface MintInput {
  issuer:      string
  instanceId:  string
  extensionId: string
  surface:     string
  userId:      string | null
  permissions: string[]
  jti:         string
  ttlSeconds?: number
}

export interface ExpectedAudience {
  instanceId:  string
  extensionId: string
  surface:     string
}

export type VerifyResult =
  | { ok: true;  claims: ExtensionTokenClaims }
  | { ok: false; code: VerifyErrorCode; message: string }

export type VerifyErrorCode =
  | 'TOKEN_INVALID'
  | 'SESSION_EXPIRED'
  | 'TOKEN_WRONG_AUDIENCE'
  | 'TOKEN_WRONG_INSTANCE'
  | 'TOKEN_WRONG_EXTENSION'
  | 'TOKEN_WRONG_SURFACE'
  | 'TOKEN_REVOKED'

/**
 * Secret dédié, dérivé du secret applicatif.
 *
 * Le claim `aud` suffirait en théorie à séparer les deux familles de jetons.
 * On dérive quand même une clé distincte : ainsi un jeton de session
 * d'utilisateur ne peut pas valider ici, et un jeton d'extension ne peut pas
 * valider ailleurs, même si un jour quelqu'un oublie de vérifier `aud`. Une
 * frontière qui tient sans dépendre d'un contrôle applicatif vaut mieux qu'une
 * frontière qui en dépend.
 */
export function deriveExtensionSecret(appSecret: string): string {
  return createHmac('sha256', appSecret).update('nodyx-extension-token-v1').digest('hex')
}

export function mintExtensionToken(input: MintInput, appSecret: string): string {
  const now = Math.floor(Date.now() / 1000)
  const ttl = input.ttlSeconds ?? SURFACE.tokenTtlSeconds
  const claims: ExtensionTokenClaims = {
    iss: input.issuer,
    aud: 'nodyx-extension',
    ins: input.instanceId,
    ext: input.extensionId,
    sur: input.surface,
    sub: input.userId,
    prm: [...input.permissions].sort(),
    jti: input.jti,
    iat: now,
    exp: now + ttl,
  }
  // Pas de `noTimestamp` : l'option supprimerait le `iat` que l'on pose ici.
  return jwt.sign(claims, deriveExtensionSecret(appSecret), { algorithm: 'HS256' })
}

/**
 * Vérifie un jeton CONTRE la cible réellement appelée.
 *
 * `expected` n'est pas décoratif : sans lui, un jeton légitime obtenu pour un
 * widget servirait à appeler au nom d'une page, ou d'une autre extension. La
 * vérification cryptographique dit seulement que nous avons émis ce jeton,
 * pas qu'il vaut pour cet appel là.
 */
export function verifyExtensionToken(
  token: string,
  expected: ExpectedAudience,
  appSecret: string,
  isRevoked?: (jti: string) => boolean,
): VerifyResult {
  let claims: ExtensionTokenClaims
  try {
    claims = jwt.verify(token, deriveExtensionSecret(appSecret), {
      algorithms: ['HS256'],          // jamais `none`, jamais de négociation
      audience:   'nodyx-extension',
    }) as ExtensionTokenClaims
  } catch (e) {
    const name = (e as Error).name
    if (name === 'TokenExpiredError') {
      return { ok: false, code: 'SESSION_EXPIRED', message: 'jeton d\'extension expiré' }
    }
    if (name === 'JsonWebTokenError' && /audience/i.test((e as Error).message)) {
      return { ok: false, code: 'TOKEN_WRONG_AUDIENCE', message: 'ce jeton n\'est pas un jeton d\'extension' }
    }
    return { ok: false, code: 'TOKEN_INVALID', message: 'jeton d\'extension invalide' }
  }

  if (claims.ins !== expected.instanceId) {
    return { ok: false, code: 'TOKEN_WRONG_INSTANCE', message: 'jeton émis pour une autre instance' }
  }
  if (claims.ext !== expected.extensionId) {
    return { ok: false, code: 'TOKEN_WRONG_EXTENSION', message: 'jeton émis pour une autre extension' }
  }
  if (claims.sur !== expected.surface) {
    return { ok: false, code: 'TOKEN_WRONG_SURFACE', message: 'jeton émis pour une autre surface' }
  }
  if (isRevoked?.(claims.jti)) {
    return { ok: false, code: 'TOKEN_REVOKED', message: 'jeton révoqué : extension désactivée, désinstallée, ou permission retirée' }
  }

  return { ok: true, claims }
}

/** L'extension détient elle cette capacité, telle qu'accordée par l'admin ? */
export function tokenGrants(claims: ExtensionTokenClaims, capability: string): boolean {
  return claims.prm.includes(capability)
}

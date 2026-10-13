// ─── Le chinois simplifié doit atteindre ses lecteurs, et seulement eux ──────
//
// Demandé dans l'issue #765. Un navigateur chinois annonce sa langue sous
// plusieurs formes (`zh-CN`, `zh-Hans`, `zh-Hans-CN`, `zh-SG`, `zh`) : toutes
// doivent recevoir le simplifié. Les variantes traditionnelles (Taïwan, Hong
// Kong, Macao, `zh-Hant`) s'écrivent avec d'autres caractères : leur servir du
// simplifié serait leur imposer une écriture qui n'est pas la leur, elles
// gardent le repli habituel en attendant une traduction traditionnelle.
//
// Ces contrôles échouent sur le code d'avant : `zh-Hans` n'existait pas.

import { describe, it, expect } from 'vitest'
import { getLocaleFromAcceptLanguage, isKnownLocale, LOCALES } from './i18n'

describe('détection du chinois', () => {
  it('sert le simplifié à un navigateur chinois simplifié', () => {
    // En-têtes réels : Chrome et Edge en Chine, Safari, Firefox, Singapour.
    for (const h of [
      'zh-CN,zh;q=0.9,en;q=0.8',
      'zh-CN',
      'zh-cn',
      'zh-Hans-CN,zh-Hans;q=0.9',
      'zh-Hans',
      'zh-SG,zh;q=0.9',
      'zh',
    ]) {
      expect(getLocaleFromAcceptLanguage(h), h).toBe('zh-Hans')
    }
  })

  it("n'impose pas le simplifié aux lecteurs du traditionnel", () => {
    // Le 2e est l'en-tête réel de Chrome à Taïwan : son `zh` générique suit
    // le traditionnel, il ne doit pas réveiller le simplifié.
    for (const h of ['zh-TW', 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-TW,zh;q=0.9']) {
      expect(getLocaleFromAcceptLanguage(h), h).not.toBe('zh-Hans')
    }
  })

  it('tient compte de la langue suivante pour un lecteur du traditionnel', () => {
    expect(getLocaleFromAcceptLanguage('zh-TW,en-US;q=0.8')).toBe('en')
  })

  it('ne détourne pas les autres langues', () => {
    expect(getLocaleFromAcceptLanguage('fr-FR,fr;q=0.9')).toBe('fr')
    expect(getLocaleFromAcceptLanguage('pt-BR')).toBe('pt-BR')
    expect(getLocaleFromAcceptLanguage('en-US,en;q=0.9')).toBe('en')
  })
})

describe('câblage de la langue', () => {
  it('zh-Hans est une langue connue, donc sélectionnable', () => {
    expect(isKnownLocale('zh-Hans')).toBe(true)
  })

  it("s'affiche comme le portugais : la langue, puis la variante entre parenthèses", () => {
    // Même logique que « Português (BR) » / « Português (PT) » : le jour où le
    // chinois traditionnel arrivera, « 中文 (繁體) » se distinguera sans ambiguïté.
    const zh = LOCALES.find((l) => l.code === 'zh-Hans')
    expect(zh?.label).toBe('中文 (简体)')
    expect(zh?.flagIcon).toBe('twemoji:flag-china')
  })
})

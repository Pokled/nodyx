# Nexus Plugins

Ce dossier contient les plugins officiels et communautaires pour Nexus.

Un plugin est un bundle autonome qui étend les fonctionnalités de Nexus
**sans modifier le code source principal**. Chaque plugin est un dossier
contenant un fichier manifeste et ses ressources.

> Le fichier manifeste s'appelle différemment selon la catégorie :
> `template.json` pour les `table-templates/`, `plugin.json` pour les futures catégories backend.

---

## Structure

```
plugins/
  table-templates/    ← Thèmes visuels pour la Table collaborative
  (à venir)
    channel-bots/     ← Bots/automations dans les canaux
    garden-themes/    ← Thèmes pour la page Jardin
    ...
```

---

## Créer un plugin

### 1. Choisir la bonne catégorie

| Catégorie | Description |
|-----------|-------------|
| `table-templates/` | Thème visuel pour les salons vocaux (table, couleurs, texture) |

### 2. Lire le README de la catégorie

Chaque sous-dossier contient son propre `README.md` avec la spec complète
du format attendu et les exemples.

### 3. Soumettre via Pull Request

Crée ton dossier dans la bonne catégorie et ouvre une PR.
Les templates officiels du Core Team sont là pour t'inspirer.

---

## Plugins officiels

| Plugin | Catégorie | Auteur |
|--------|-----------|--------|
| `brasserie-de-nuit` | table-templates | Nexus Core Team |
| `table-de-feutre` | table-templates | Nexus Core Team |
| `pierre-et-braise` | table-templates | Nexus Core Team |

---

*Les plugins sont sous licence AGPL-3.0 comme le reste du projet,
sauf mention contraire dans leur propre `plugin.json`.*

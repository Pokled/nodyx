# Nexus — Moteur Audio

Nexus intègre une chaîne de traitement audio côté client conçue pour délivrer une qualité vocale professionnelle dans n'importe quel salon vocal — sans matériel dédié, sans service externe, et sans envoyer votre audio ailleurs qu'à vos pairs directement.

---

## Comment ça fonctionne

Quand vous rejoignez un salon vocal, le signal de votre microphone traverse une chaîne de nœuds Web Audio API avant d'atteindre la connexion WebRTC :

```
Microphone
    │
    ▼
[GainNode]            ← Amplification / atténuation du micro (0.1×–2.0×)
    │
    ▼
[BiquadFilterNode]    ← Filtre passe-haut à 80 Hz (optionnel)
    │
    ▼
[RNNoise WASM]        ← Suppression IA du bruit de fond (optionnel)
    │
    ▼
[BiquadFilterNode ×3] ← EQ Broadcast — 3 bandes (optionnel)
    │
    ▼
WebRTC PeerConnection → pairs
```

Tout s'exécute **dans votre navigateur**. Aucun audio n'est traité côté serveur.

---

## Paramètres

Tous les réglages sont accessibles via le bouton ⚙ dans la barre vocale (VoicePanel), et sont persistés automatiquement dans `localStorage`.

---

### Gain du microphone

**Plage :** 0.1× – 2.0× (défaut : 1.0×)

Ajuste le volume d'entrée de votre microphone avant tout traitement.

- `1.0` = pas de changement (niveau nominal)
- `2.0` = double le signal (+6 dB) — utile pour les microphones peu sensibles
- `0.5` = réduit le signal de moitié (−6 dB) — utile pour les micros trop forts ou qui saturent

---

### Filtre passe-haut (80 Hz)

**Défaut : activé**

Un filtre BiquadFilter `highpass` qui coupe tout ce qui est en dessous de 80 Hz. Élimine :
- Le ronronnement des ventilateurs PC
- Le bourdonnement de la climatisation
- Les vibrations mécaniques du bureau
- Le bruit de manipulation basse fréquence

Impact quasi nul sur l'intelligibilité de la voix. Il est recommandé de le laisser activé.

---

### RNNoise — Suppression IA du bruit de fond

**Défaut : désactivé** *(nécessite `@jitsi/rnnoise-wasm`)*

RNNoise est un modèle de réseau de neurones (entraîné par Mozilla/Xiph) compilé en WebAssembly. Il s'exécute entièrement dans votre navigateur, analyse votre audio par trames de 10 ms, et supprime le bruit de fond en temps réel.

Il est efficace contre :
- Les clics de clavier et de souris
- Le bruit de la rue
- La musique d'ambiance
- Le bruit de foule

> **Note :** RNNoise nécessite le package `@jitsi/rnnoise-wasm`. S'il n'est pas installé, le bouton est désactivé dans l'interface. Pour l'activer en production, exécutez `npm install @jitsi/rnnoise-wasm` dans `nexus-frontend/`.

---

### Mode Broadcast — EQ 3 bandes

**Défaut : désactivé — Intensité : 60%**

C'est la fonctionnalité audio qui distingue Nexus. Le Mode Broadcast applique un égaliseur à trois bandes réglé pour la voix humaine, reproduisant la chaîne de traitement utilisée dans le podcasting professionnel et la radio.

#### Les trois bandes

| Bande | Type | Fréquence | Gain | Rôle |
|---|---|---|---|---|
| Coupe bas-médium | Peaking | 200 Hz | −3 dB | Élimine le côté "boueux" et en boîte |
| Boost de présence | Peaking | 3 000 Hz | +4 dB | Ajoute de la clarté, tranche dans le mix |
| Air | High shelf | 8 000 Hz | +3 dB | Ajoute de la "brillance" et de l'ouverture |

#### Curseur d'intensité

Le curseur **Intensité** (0–100%) met à l'échelle les gains des trois bandes proportionnellement. À 0% l'EQ est plat. À 100% les gains sont appliqués à pleine puissance. Le défaut à 60% est un réglage équilibré adapté à la plupart des microphones.

#### Avant / après

| Sans Mode Broadcast | Avec Mode Broadcast |
|---|---|
| Plat, légèrement boueux | Clair, présent, qualité radio |
| Voix noyée dans les bas-médiums | Voix en avant dans le mix |
| Manque de brillance | Luminosité naturelle |

> Discord n'offre aucun EQ côté client pour la voix. Le Mode Broadcast fournit une qualité audio digne d'un podcast, sans matériel supplémentaire.

---

### Débit Opus

**Options :** **32 kbps** (défaut) / 64 kbps / 128 kbps

Contrôle le débit du codec Opus appliqué à la prochaine connexion pair.

| Débit | Cas d'utilisation |
|---|---|
| **32 kbps** | **Défaut — optimisé voix, fonctionne via VPN et liens congestionnés** |
| 64 kbps | Meilleure qualité, bonne bande passante |
| 128 kbps | Audio haute qualité, musique ou flux d'enregistrement |

Les changements prennent effet à la **prochaine connexion** (reconnectez-vous au salon vocal pour les appliquer).

> **Paramètres codec additionnels (v1.3) :** Le DTX (Discontinuous Transmission) est désactivé par défaut — il provoque des rafales audio à la reprise de parole sur les liens à perte. Le mono est forcé pour réduire de moitié le débit sans impacter l'intelligibilité vocale. Le FEC (Forward Error Correction) reste actif pour la résilience face aux pertes de paquets.

---

## Résumé

| Fonctionnalité | Technologie | Exécuté sur |
|---|---|---|
| Gain micro | Web Audio GainNode | Navigateur |
| Filtre passe-haut | Web Audio BiquadFilter | Navigateur |
| Suppression IA du bruit | RNNoise WASM (Mozilla/Xiph) | Navigateur |
| EQ Broadcast | Web Audio BiquadFilter ×3 | Navigateur |
| Codec vocal | Opus (standard WebRTC) | Navigateur → Pairs |

Tout le traitement est **local et privé**. Aucune donnée audio n'est envoyée à un serveur au-delà de vos connexions pair-à-pair directes.

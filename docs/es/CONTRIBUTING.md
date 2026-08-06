# Contribuir a Nodyx
### Bienvenido a la comunidad Nodyx

---

> "Nodyx pertenece a su comunidad. No a sus creadores."
> Si estás leyendo este archivo, eres potencialmente un constructor de la internet libre.
> Bienvenido.

---

## Antes de empezar

Lee estos archivos en este orden:
1. `ARCHITECTURE.md` — Cómo está construido Nodyx
2. `MANIFESTO.md` — El alma del proyecto
3. `ROADMAP.md` — Hacia dónde vamos

Si no estás de acuerdo con el Manifiesto, puede que Nodyx no sea el proyecto adecuado para ti.
No pasa nada.

---

## Dónde contribuir

### Puedes contribuir libremente en
```
nodyx-frontend/src/lib/locales/  , Traducir la interfaz
docs/                            , La documentación, y sus traducciones
nodyx-frontend/src/              , Funcionalidades y correcciones del front
nodyx-docs/                      , El sitio de documentación nodyx.dev
```

### No puedes modificar sin validación
```
nodyx-core/src/          , Código principal del servidor
docs/en/ARCHITECTURE.md
docs/en/MANIFESTO.md
```

Si crees que algo en el núcleo debería cambiar, abre un Issue y explica por qué. El debate está abierto. La modificación unilateral, no.

---

## Crear un plugin

### Estructura mínima
```
nodyx-plugins/mi-plugin/
├── plugin.json     — Manifiesto obligatorio
├── index.ts        — Punto de entrada
├── README.md       — Documentación
└── LICENSE         — Licencia (MIT recomendada)
```

### plugin.json mínimo
```json
{
  "name": "mi-plugin",
  "version": "1.0.0",
  "description": "Qué hace mi plugin",
  "author": "Tu nombre o usuario",
  "license": "MIT",
  "nodyxVersion": ">=1.0.0"
}
```

### Reglas de los plugins
1. Un plugin nunca modifica las tablas del núcleo (usuarios, comunidades, categorías, hilos, publicaciones)
2. Un plugin puede añadir sus propias tablas con el prefijo `plugin_{nombre}_`
3. Un plugin solo usa los hooks documentados en ARCHITECTURE.md
4. Un plugin no puede deshabilitar otro plugin
5. Un plugin debe funcionar aunque sus dependencias opcionales no estén presentes

---

## Contribuir al código del núcleo

### Proceso
1. Haz un fork del repositorio
2. Crea una rama: `feat/mi-funcionalidad` o `fix/mi-corrección`
3. Código en TypeScript, comentarios en inglés
4. Los tests son obligatorios para cualquier nueva ruta de API
5. Abre un Pull Request con una descripción clara

### Formato de los commits (obligatorio)

Sigue [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add voice channel mute shortcut
fix: correct JWT expiry check
docs: update installation guide
refactor: extract voice signaling to separate module
test: add auth middleware unit tests
chore: update dependencies
```

Todos los mensajes de commit y comentarios de código deben estar en **inglés**.

### Lo que no vamos a fusionar
- Código sin tests
- Código que rompe los tests existentes
- Código con dependencias propietarias
- Código con puertas traseras (obvio)
- Código que centraliza datos de los usuarios
- Código que contradice ARCHITECTURE.md sin debate previo

---

## Traducir Nodyx

Traducir es la contribución más accesible. No se necesita saber programar, ni crear una cuenta en ningún sitio, salvo en GitHub.

**Estado en vivo: [nodyx.org/translate](https://nodyx.org/translate)** muestra cada idioma, cuánto lleva avanzado, y enlaza directamente al archivo que hay que editar.

### La interfaz

Toda la interfaz de la aplicación cabe en un archivo JSON por idioma:

```
nodyx-frontend/src/lib/locales/
  fr.json          , idioma de origen
  en.json          , referencia, mantenida al 100%
  de.json  es.json  pt-PT.json  ru.json  vi.json
```

1. Abre [nodyx.org/translate](https://nodyx.org/translate) y busca tu idioma
2. Pulsa «Traducir en GitHub», el repositorio se copia para ti
3. Rellena las claves que falten, dejando cada `{{variable}}` exactamente como está
4. Abre un Pull Request

La integración continua comprueba que ninguna variable se haya alterado, así que traducir no puede romper la aplicación. Nosotros revisamos, fusionamos, y tu trabajo sale en la siguiente versión.

¿Tu idioma no está en la lista? Copia `en.json`, nómbralo con el código de tu idioma, y abre una Issue para que lo conectemos al selector de idiomas.

### La documentación
1. Ve a `docs/`
2. Copia la carpeta `en/` y renómbrala con el código de tu idioma (`de/`, `es/`, `ja/`, etc.)
3. Traduce los archivos
4. Abre un Pull Request

Archivos a traducir:
```
MANIFESTO.md    , el texto fundacional
THANKS.md       , agradecimientos
README.md       , descripción general del proyecto
CONTRIBUTING.md , esta guía
ARCHITECTURE.md , referencia técnica
ROADMAP.md      , hoja de ruta del desarrollo
```

### Reglas de traducción
- Traduce el significado, no palabra por palabra
- Mantén el tono original (directo, humano, sin corporativismo)
- Nunca toques lo que está entre `{{ }}`, son valores que la aplicación rellena sola
- Si un concepto no tiene equivalente en tu idioma, conserva el término en inglés
- Los nombres propios (Nodyx, NodyxPoints, Guard Protocol, etc.) nunca se traducen

Quien traduce recibe una estrella y su sitio en [CONTRIBUTORS.md](../../CONTRIBUTORS.md), como cualquier otro contribuidor.

---

## Reportar un bug

Abre un Issue con:
- La versión de Nodyx
- El sistema operativo del servidor
- Los pasos para reproducirlo
- Lo que viste frente a lo que esperabas
- Los logs si están disponibles

---

## Proponer una funcionalidad

Abre un Issue con la etiqueta `[FEATURE]` y explica:
- Qué problema resuelve
- Para quién (qué tipo de usuario)
- Cómo te imaginas que funcionaría
- ¿Debería estar en el núcleo o en un plugin?

La regla: si puede ser un plugin, debe ser un plugin.

---

## Código de conducta

### Estamos aquí para
- Construir algo bueno
- Aprender juntos
- Respetar el trabajo de los demás
- Criticar ideas, no personas

### No estamos aquí para
- Imponer nuestras opiniones técnicas
- Menospreciar las contribuciones de otros
- Promocionar herramientas o servicios propietarios
- Saltarnos las reglas del núcleo

---

## Preguntas

- GitHub Issues para bugs y funcionalidades
- GitHub Discussions para preguntas generales
- El propio foro de Nodyx para todo lo demás

---

## Gracias

Cada contribución, por pequeña que sea, forma parte de algo más grande.
Corregir una errata en la documentación. Una traducción. Un plugin. Un bug reportado.

Todo cuenta. Todo queda registrado en la historia del proyecto.

```
git log --oneline
```

Tu nombre estará ahí.

---

*"La red es la gente."*
*AGPL-3.0 — El código pertenece a su comunidad.*

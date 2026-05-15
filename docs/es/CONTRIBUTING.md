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
nodyx-plugins/    — Crear plugins
nodyx-themes/     — Crear temas visuales
nodyx-docs/       — Mejorar la documentación
i18n/             — Traducir a tu idioma
community/        — Contenido de la comunidad
```

### No puedes modificar sin validación
```
nodyx-core/src/           — Código principal del servidor
nodyx-core/ARCHITECTURE.md
nodyx-core/NODYX_CONTEXT.md
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

Traducir es la contribución más accesible. No se necesita saber programar.

### Cómo hacerlo
1. Ve a `docs/`
2. Copia la carpeta `en/` y renómbrala con el código de tu idioma (`de/`, `es/`, `ja/`, etc.)
3. Traduce los archivos
4. Abre un Pull Request

### Archivos a traducir
```
MANIFESTO.md    — El texto fundacional
THANKS.md       — Agradecimientos
README.md       — Descripción general del proyecto
CONTRIBUTING.md — Esta guía
ARCHITECTURE.md — Referencia técnica
ROADMAP.md      — Hoja de ruta del desarrollo
```

### Reglas de traducción
- Traduce el significado, no palabra por palabra
- Mantén el tono original (directo, humano, sin corporativismo)
- Si un concepto no tiene equivalente en tu idioma, conserva el término en inglés
- Los nombres propios (Nodyx, NodyxPoints, Guard Protocol, etc.) nunca se traducen

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

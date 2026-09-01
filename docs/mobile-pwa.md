# Experiencia móvil e instalación Android

## Referencia analizada

La copia local de `F:\Proyectos\field-hours` implementa una PWA con cuatro piezas que aplican a
BuildTrack Pro:

- `public/manifest.webmanifest` con `display: standalone`, iconos PNG de 192 y 512 px y metadatos
  móviles.
- `public/sw.js` para cachear el shell y mantener un fallback de navegación.
- Registro del service worker desde `src/main.tsx` únicamente en producción.
- `beforeinstallprompt` encapsulado en una acción reutilizable, mostrada dentro de la sesión
  autenticada y con instrucciones de Chrome cuando el prompt no está disponible.

También usa una jerarquía móvil de una sola columna, controles con altura táctil y tarjetas densas;
las listas largas se revelan progresivamente para no ocupar la primera pantalla completa.

## Aplicación en BuildTrack Pro

- El panel de solicitudes pasa a una columna en móvil y a una grilla información/acciones en desktop.
- Se reducen paddings y separaciones del dashboard y de cada solicitud sin ocultar información.
- Admin y builder ven `Instalar app` después del login. Chrome abre la instalación nativa de la PWA
  cuando ofrece el prompt; si no, la interfaz explica cómo instalar desde el menú.
- El manifest abre `/dashboard`, que conserva la sesión Firebase y redirige al workspace correcto.
- Los iconos PWA se generan reutilizando el favicon existente de BuildTrack Pro.

## Alcance y límite

Esto instala la aplicación como PWA en Android. No genera un APK nativo ni una entrada en Google Play;
eso requeriría una capa Android separada, firma de aplicación y un proceso de distribución propio.

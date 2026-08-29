# Baseline de rendimiento

Fecha inicial: 2026-08-27
Actualizacion: 2026-08-28
Alcance: dashboard web, build de produccion y consultas principales de Firestore.

## Entorno de medicion

- Node.js 22.23.2 local del proyecto.
- Vite 5.4.21.
- Build ejecutado con `npm run build:dev`.
- Web Vitals medidos con Chromium y Playwright contra `vite preview` en localhost.
- Cinco muestras frias por perfil, usando percentil 75.

## Presupuesto

- Bundle inicial JavaScript: menor de 500 kB gzip.
- LCP: menor o igual a 2.5 s.
- INP: menor o igual a 200 ms.
- CLS: menor o igual a 0.1.

## Bundle

| Medicion | Baseline inicial | Actual | Resultado |
| --- | ---: | ---: | --- |
| Bundle inicial JS | 1811.33 kB / 497.78 kB gzip | 330.75 kB / 107.41 kB gzip | Cumple |
| Chunk compartido de autenticacion | No separado | 716.01 kB / 177.23 kB gzip | Carga diferida |

La reduccion se obtuvo separando rutas con `React.lazy`; el modulo de autenticacion se descarga
solo cuando la navegacion lo necesita.

## Core Web Vitals de laboratorio - 2026-08-28

| Perfil | LCP p75 | INP p75 | CLS p75 | FCP p75 | TTFB p75 | Resultado |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Desktop 1440x900 | 128 ms | 16 ms | 0 | 68 ms | 2 ms | Cumple |
| Mobile 390x844 | 120 ms | 16 ms | 0 | 56 ms | 1.4 ms | Cumple |

Los umbrales usados son los publicados para Core Web Vitals: LCP 2.5 s, INP 200 ms y CLS 0.1.
Estos resultados son datos de laboratorio local, no sustituyen telemetria de usuarios reales.
Referencia: https://web.dev/articles/vitals?hl=en

Comando reproducible:

```bash
npm run build:dev
npm run perf:web-vitals
```

## Consultas revisadas

- Listados principales usan `limit` y cursores.
- Facturas y ordenes de cambio usan indices compuestos declarados en `firestore.indexes.json`.
- No se observaron lecturas sin limite en los flujos principales revisados.
- La validacion local cubrio 65 pruebas sobre emuladores y 8 escenarios E2E.

## Estado

El presupuesto de bundle y los Web Vitals de laboratorio cumplen. La siguiente medicion relevante
debe hacerse en staging con red y datos representativos antes de autorizar produccion.

# Baseline de rendimiento

Fecha inicial: 2026-08-27
Actualizacion: 2026-08-30
Alcance: dashboard web, build de produccion y consultas principales de Firestore.

## Entorno de medicion

- Node.js 22.23.2 local del proyecto.
- Vite 8.2.2.
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
| Bundle principal JS | 1811.33 kB / 497.78 kB gzip | 274.29 kB / 88.10 kB gzip | Cumple |
| Ruta de autenticacion | No separado | 440.44 kB / 126.02 kB gzip | Carga diferida |
| Chunk compartido de Auth/Firebase | No separado | 582.36 kB / 172.45 kB gzip | Carga diferida; revisar en T-030 |

La reduccion se obtuvo separando rutas con `React.lazy`; el modulo de autenticacion se descarga
solo cuando la navegacion lo necesita.

## Core Web Vitals de laboratorio - 2026-08-30

| Perfil | LCP p75 | INP p75 | CLS p75 | FCP p75 | TTFB p75 | Resultado |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Desktop 1440x900 | 116 ms | 16 ms | 0 | 64 ms | 1.1 ms | Cumple |
| Mobile 390x844 | 104 ms | 16 ms | 0 | 56 ms | 1.3 ms | Cumple |

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
- La validacion local cubrio 81 pruebas sobre emuladores y 11 escenarios E2E.

## Estado

El presupuesto agregado de la ruta y los Web Vitals de laboratorio cumplen. Vite avisa que el chunk
compartido supera 500 kB sin comprimir; T-030 conserva su separación como mejora P2 medida, no como
bloqueante de seguridad. La siguiente medicion relevante
debe hacerse en staging con red y datos representativos antes de autorizar produccion.

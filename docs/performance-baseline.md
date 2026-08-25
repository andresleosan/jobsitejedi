# Baseline de rendimiento

Fecha: 2026-08-25
Entorno: Vite 5.4.19, Node 24.18.0, build de producción local, Firebase Emulator Suite.

## Medición antes/después

| Métrica | Antes | Después | Resultado |
| --- | ---: | ---: | --- |
| Chunk JavaScript inicial | 1.811,33 kB / 497,78 kB gzip | 330,70 kB / 107,38 kB gzip | -81,7% / -78,4% |
| Hoja de estilos inicial | 70,41 kB / 12,21 kB gzip | 70,44 kB / 12,22 kB gzip | Sin cambio material |
| Respuesta HTML de preview | 9,0 ms / 1.256 B | 7,1 ms / 1.256 B | Mejora observada local |
| Build | 20,42 s | 8,43 s | -58,7% en esta ejecución |

La medición se obtuvo con `npm.cmd run build`, leyendo el reporte de tamaños de Vite, y con
`curl.exe` contra `vite preview` en `127.0.0.1:4173`. Los tiempos HTTP son orientativos del
servidor local, no sustituyen una medición de red real.

## Cambio aplicado

`src/App.tsx` pasó las páginas a `React.lazy()` dentro de un `Suspense` común. El shell inicial
ya no carga todos los dashboards y diálogos; cada ruta descarga su propio módulo al navegar.
Esto no cambia consultas, reglas ni lógica de negocio. El build todavía identifica un chunk
compartido de autenticación de 713,23 kB, por lo que queda como candidato de una iteración futura
si el perfil real de `/auth` lo justifica.

## Consultas revisadas

- `ProjectDetails`: 2 lecturas principales (`getProject` y `listJobsForProject`) ejecutadas con
  `Promise.all`.
- `Statements`: 5 lecturas (`projects`, `timeEntries`, `invoices`, `materialUsage`, `jobs`) con
  `Promise.all`; no hay bucle de consulta por fila.
- Dashboards: las listas principales se solicitan una vez por carga; `JobsToDoList` hace una
  consulta por proyecto seleccionado y las suscripciones de diálogos solo se activan al abrirlos.

No se modificaron consultas ni índices porque la medición estática no mostró un N+1 claro. Una
medición de Web Vitals con navegador real queda pendiente: el ejecutable Chromium de Playwright
no está instalado en este entorno.

## Verificación

- `npm.cmd run typecheck` → aprobado.
- `npm.cmd run lint` → 0 errores, 7 warnings preexistentes de Fast Refresh.
- `npm.cmd run test:e2e:firebase:emulator` → 7 E2E aprobadas contra emuladores.
- No hubo despliegue, migración ni acceso a servicios remotos o APIs pagas.

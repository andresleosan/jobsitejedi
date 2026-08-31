# Despliegue gradual de Firebase App Check

Estado local: preparado, sin cambios remotos. El cliente usa reCAPTCHA Enterprise cuando existe
`VITE_FIREBASE_APPCHECK_SITE_KEY`; las callable Functions conservan
`ENFORCE_APP_CHECK=false` por defecto.

## Orden y autorizaciones

1. Con autorización de despliegue, registrar la aplicación Web y configurar la site key pública
   en el entorno de hosting. No guardar la clave en Git.
2. Publicar primero cliente y Functions con `ENFORCE_APP_CHECK=false`. Esto inicia observación sin
   rechazar usuarios legítimos.
3. Durante al menos siete días, revisar métricas de solicitudes verificadas/no verificadas por
   Auth, Firestore, Storage y Functions, además de errores por navegador y flujo QA de los tres
   roles.
4. Solo si el tráfico legítimo está verificado, solicitar una nueva autorización separada para
   cambiar `ENFORCE_APP_CHECK=true` y habilitar enforcement de los productos en Firebase Console.
5. Probar token válido, ausente e inválido y mantener monitoreo reforzado durante 24 horas.

## Criterios de rollback

- Si aumenta el error legítimo, redeplegar Functions con `ENFORCE_APP_CHECK=false` y deshabilitar
  enforcement en Firebase Console. Este rollback no cambia datos ni roles.
- No retirar la inicialización del cliente durante el rollback: permite seguir observando métricas.
- El endpoint público de invitaciones mantiene 30 solicitudes/minuto por IP anonimizada y un techo
  de emergencia de 300/minuto. Nunca se persiste la IP original.

## Storage y cuarentena

Las facturas entran por `invoice-quarantine/{uid}/{invoiceId}/upload`, no son legibles por clientes
y aceptan archivos estrictamente menores de 10 MiB. Una Function valida, decodifica y recodifica el
contenido antes de promoverlo. Configurar lifecycle remoto para eliminar cuarentenas rechazadas con
más de siete días requiere inventario y autorización de despliegue; no debe afectar archivos finales.

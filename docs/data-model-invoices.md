# Contrato de datos — facturas Firebase

Estado: primer slice de T-009/T-011 con OCR local opcional para imagenes.

## Colección `invoices/{invoiceId}`

| Campo | Tipo | Contrato |
|---|---|---|
| `projectId` | string | Proyecto existente y propiedad del builder que envía. |
| `projectName` | string | Snapshot server-side del nombre del proyecto. |
| `invoiceNumber` | string | 1–80 caracteres. |
| `supplierName` | string | 1–120 caracteres; snapshot manual hasta migrar proveedores. |
| `invoiceDate` | string | Fecha civil ISO `YYYY-MM-DD`, validada como fecha real. |
| `totalAmountMinor` | integer | Importe positivo en unidad monetaria menor; máximo 1 billón. |
| `currency` | string | `GBP` en este slice. |
| `notes` | string \| null | Máximo 1.000 caracteres. |
| `filePath` | string | Ruta privada `invoices/{uid}/{invoiceId}/{archivo}`. |
| `fileName` | string | Nombre visible normalizado, máximo 180 caracteres. |
| `contentType` | string | Imagen o PDF verificado desde metadata de Storage. |
| `fileSize` | integer | 1 byte a menos de 10 MB, verificado server-side. |
| `fileGeneration` | string | Generación inmutable observada al registrar el archivo. |
| `fileMd5Hash` | string \| null | Huella reportada por Storage para auditoría. |
| `uploadedBy` | string | UID autenticado; nunca aceptado desde el cliente. |
| `uploadedByName` | string \| null | Nombre tomado del token autenticado. |
| `status` | string | `submitted`, `approved` o `rejected`. |
| `reviewedBy` | string \| null | UID manager al resolver. |
| `reviewedAt` | timestamp \| null | Fecha server-side de resolución. |
| `reviewNotes` | string \| null | Máximo 1.000 caracteres. |
| `createdAt` | timestamp | Fecha server-side de alta. |
| `updatedAt` | timestamp | Último cambio server-side. |

Las escrituras directas del cliente quedan bloqueadas. `submitInvoice` valida proyecto, payload y
metadata del archivo antes de crear el documento; `reviewInvoice` aplica la transición terminal
manager-only. Ambos callables son idempotentes para el mismo identificador y payload.

El builder solo puede leer sus propias facturas. El manager puede leer todas. El archivo puede
subirse mientras el documento aún no existe; después queda bloqueado contra sobrescritura y
borrado. Si el alta falla, el cliente intenta eliminar el upload huérfano.

## Consultas e índices

- Builder: `where("uploadedBy", "==", uid)` y ordenamiento en memoria.
- Manager: colección completa y ordenamiento en memoria.

Este slice no necesita un índice compuesto. Se revisará paginación e índices cuando el volumen
medido lo justifique.

## OCR local opcional

El formulario puede leer una imagen de factura con [Tesseract.js](https://github.com/naptha/tesseract.js),
version `7.0.0`, una biblioteca Apache-2.0 sin API key ni cobro por uso. El reconocimiento corre en un
Web Worker del navegador y solo propone `invoiceNumber`, `supplierName`, `invoiceDate` y `amount`;
el builder debe revisar y puede corregir los valores antes de enviar.

Tesseract.js descarga sus recursos publicos de idioma/core al primer uso y los cachea en el navegador;
la imagen de la factura se procesa localmente y no se envia a una API de OCR. Si esos recursos no estan
disponibles, o el archivo es PDF, el flujo se degrada a captura manual con un mensaje visible. No hay
credenciales, reintentos automaticos ni gasto nuevo asociado a esta integracion.

## Rollback

El cambio es aditivo y no transforma datos existentes. Para revertir:

1. Retirar los accesos de facturas de ambos dashboards y restaurar la versión anterior de
   Functions y reglas.
2. Conservar `invoices` y los objetos `invoices/`; no borrar evidencia financiera durante un
   rollback de aplicación.
3. Si más adelante se decide eliminar estos datos, crear una migración independiente con backup
   verificado, inventario de objetos, prueba de restauración y confirmación explícita del operador.

No se aplica ninguna migración a producción como parte de este slice.

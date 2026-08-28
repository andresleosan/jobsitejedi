# Contrato de proveedores Firebase

Este slice agrega el catalogo de proveedores sin migrar datos remotos. Las facturas actuales
conservan `supplierName` como snapshot hasta que el flujo de seleccion de proveedor se integre.

## Coleccion `suppliers/{supplierId}`

| Campo | Tipo | Contrato |
|---|---|---|
| `name` | string | Nombre visible, 1-120 caracteres. |
| `normalizedName` | string | ID canonico en minusculas y guiones ASCII. |
| `createdBy` | string | UID del manager que creo el proveedor. |
| `createdAt` | timestamp | Alta server-side. |
| `updatedAt` | timestamp | Ultima edicion server-side. |

El ID se deriva de `name` normalizado. Crear el mismo nombre canonico devuelve el documento
existente y evita duplicados sin un indice compuesto. Los managers pueden crear y editar solo la
identidad canonica; builders y managers autenticados pueden leer. No se permiten borrados para no
romper referencias futuras desde facturas o entrenamiento de extraccion.

## Rollback

El cambio es aditivo y no modifica facturas existentes. Para revertirlo, restaurar el repositorio,
las reglas y las pruebas desde Git. No borrar la coleccion en produccion como parte de un rollback;
cualquier limpieza futura requiere inventario, backup verificado, procedimiento de restauracion y
confirmacion explicita del operador.

# Administración de acceso

## Modelo

`accessRequests/{uid}` sigue siendo el estado operativo de la cuenta: solo puede existir una
solicitud pendiente por usuario. Cada aprobación o rechazo escribe además una copia inmutable en
`accessRequestHistory`, conservando el rol solicitado, el rol asignado (si aplica), el motivo y el
administrador que decidió.

La nueva solicitud de una cuenta rechazada reemplaza únicamente el estado operativo; no borra la
copia histórica anterior. Una cuenta aprobada no puede volver a solicitar acceso porque ya tiene
un rol vigente.

## Administración de personas

El panel de administración consulta Firebase Auth mediante Functions y permite cambiar el rol o
revocar el acceso. Revocar elimina el rol de los claims y deja el grant inactivo, sin borrar la
cuenta, para que pueda volver a solicitar acceso. El administrador actual no puede degradarse ni
revocarse a sí mismo.

## Limpieza y reversión

“Limpiar seleccionados” y “Limpiar todo” requieren confirmación. La primera elimina únicamente
los registros elegidos; la segunda elimina documentos terminales de `accessRequestHistory` y sus
estados terminales operativos. Ninguna acción elimina solicitudes pendientes.
No hay migración destructiva automática. Si la funcionalidad nueva se retira, se puede revertir el
código y dejar los datos intactos; una limpieza ya confirmada no es recuperable desde la aplicación.

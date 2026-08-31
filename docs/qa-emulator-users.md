# Usuarios QA locales de Firebase Auth

BuildTrack Pro tiene tres roles de aplicación: `admin`, `manager` y `builder`. `admin` hereda las
operaciones de manager y puede invitar managers/builders; manager solo puede invitar builders. Un
nuevo admin se provisiona por el runbook auditado, nunca por invitación autoservicio.

| Correo | Rol y grant esperados | Uso QA |
|---|---|---|
| `admin@admin.com` | `admin` + grant local activo | Gobierno de roles y recorridos operativos heredados |
| `manager@manager.com` | `manager` + grant local activo | Recorridos del dashboard y operaciones de manager |
| `builder@builder.com` | `builder` + grant local activo | Recorridos del dashboard y operaciones de builder |

Estos usuarios son exclusivamente efimeros y locales. El script se niega a operar si Auth o
Firestore no apuntan a loopback o si el proyecto no es `demo-jobsite-jedi`. Cada ejecución rota el
`authorizationGrantId` y escribe el documento server-only exacto. La contrasena se recibe mediante
`QA_TEST_PASSWORD`; no se versiona ni se imprime.

## Preparacion en PowerShell

1. Iniciar los emuladores en una terminal:

   ```powershell
   npm run firebase:emulators
   ```

2. En otra terminal, capturar la contrasena sin mostrarla y ejecutar el seed idempotente. Este
   bloque funciona tanto en Windows PowerShell 5.1 como en PowerShell 7 y elimina el texto plano
   del entorno incluso si el comando falla:

   ```powershell
   $env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"
   $env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
   $env:GCLOUD_PROJECT = "demo-jobsite-jedi"
   $qaSecurePassword = Read-Host "QA password" -AsSecureString
   $qaPasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($qaSecurePassword)
   try {
     $env:QA_TEST_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($qaPasswordPointer)
     npm run qa:seed:emulator
   } finally {
     Remove-Item Env:QA_TEST_PASSWORD -ErrorAction SilentlyContinue
     [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($qaPasswordPointer)
   }
   ```

3. En una tercera terminal, iniciar la SPA conectada a los emuladores:

   ```powershell
   $env:VITE_FIREBASE_USE_EMULATORS = "true"
   npm run dev -- --host localhost --port 5173
   ```

4. Abrir `http://localhost:5173/auth`. El puerto `8080` pertenece a Firestore Emulator y no sirve
   la aplicacion web. Resultados esperados:

   - `manager@manager.com` llega a `/managers`.
   - `builder@builder.com` llega a `/builders`.
   - `admin@admin.com` llega a `/admins` y puede usar las operaciones heredadas de manager.

El Auth Emulator pierde estas identidades cuando se detiene, salvo que el operador configure
import/export local. Volver a ejecutar el seed las crea o actualiza sin duplicarlas.

## Limite operativo

Este mecanismo no asigna roles en staging ni produccion. Cualquier claim productivo se gestiona
con el runbook autorizado, identidad objetivo verificada, rollback y confirmacion explicita del
operador; nunca con estos fixtures.

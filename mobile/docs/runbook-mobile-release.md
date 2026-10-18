# Runbook: Mobile Release (EAS Build)

Cómo lanzar un build de la app móvil y dónde ver el resultado. Está pensado para que
cualquier integrante del equipo lo siga de principio a fin sin ayuda.

## Qué hace

El workflow **Mobile Release** (`.github/workflows/mobile-release.yml`, fuera de
`mobile/`) se dispara **a mano** desde GitHub Actions y ejecuta `eas build` en los
servidores de Expo (EAS Build). No corre en cada merge a propósito: el plan Free de
Expo incluye 15 builds de Android al mes y dispararlos en cada merge agota la cuota
en pocas semanas.

Un build es reproducible si alguien repite estos pasos desde `main`:

- Node.js está fijado en `22.13.0` en el workflow; las dependencias se instalan con
  `npm ci` contra `mobile/package-lock.json`.
- La versión del CLI de Expo está fijada en `mobile/eas.json` (`cli.version`).
- El origen del número de versión (`cli.appVersionSource`) está fijado en `remote`
  (ver "Versiones de app").

## Requisitos

1. **Acceso de escritura al repo** `CloudCoffee-Project/CloudCoffee` en GitHub
   (permiso para disparar workflows: pestaña Actions → Run workflow).
2. **Secret `EXPO_TOKEN` ya configurado en el repo**: Settings → Secrets and
   variables → Actions → Repository secrets. Es un access token de Expo de la cuenta
   `cloudcoffee-team` (https://expo.dev/accounts/cloudcoffee-team/settings/access-tokens),
   generado por un owner de esa cuenta. Si falta, el workflow falla en el paso
   "Verify Expo auth" con el error `Falta el secret EXPO_TOKEN en el repositorio`:
   pide a un integrante con acceso a la cuenta de Expo que lo agregue.
3. **Variable `EXPO_PUBLIC_API_URL`** (Settings → Secrets and variables →
   Variables): URL pública del API Gateway que la app hornea en el bundle. No es un
   secreto; si se cambia el dominio del gateway hay que actualizarla ahí.

Android no requiere más preparación: el keystore de firma vive en EAS (ver
"Credenciales Android"). iOS sí requiere credenciales de Apple configuradas en EAS
por un owner de la cuenta; si nadie las configuró, el build de iOS fallará en EAS.

## Cómo lanzarlo

1. En GitHub, abrir el repo → pestaña **Actions** → seleccionar **Mobile Release**
   en la lista izquierda → botón **Run workflow** (esquina superior derecha).
2. Elegir los dos inputs:
   - **profile**: `preview` (por defecto) o `production`.
     - `preview`: APK con distribución interna, instalable directo en un dispositivo
       Android desde un link/QR. Es el build de prueba para el equipo.
     - `production`: AAB (`.aab`) para subir a Google Play Console. No se puede
       instalar directo en un celular.
   - **platform**: `android` (por defecto), `ios` o `all`.
3. Pulsar **Run workflow**. El workflow corre `eas build --non-interactive --no-wait`:
   **no espera a termine la compilación**, solo la encola en EAS y termina rápido
   (minutos). El build real continúa en los servidores de Expo.

Nota: cada lanzamiento consume un build de la cuota mensual del plan Free.

## Dónde ver el resultado

1. **GitHub Actions** (la corrida que acabas de disparar): en el log del job "EAS
   build", el paso "Build (Android)" o "Build (iOS)" imprime la URL del build en
   EAS (algo como
   `https://expo.dev/accounts/cloudcoffee-team/projects/mobile/builds/<id>`).
2. **EAS (fuente de verdad del artefacto)**: lista de builds de la cuenta en
   https://expo.dev/accounts/cloudcoffee-team/builds. Ahí se ve el progreso en vivo
   y, al terminar:
   - `preview` / Android: botón **Install** con link/QR para instalar el APK en un
     dispositivo (distribución interna) y descarga directa del `.apk`.
   - `production` / Android: descarga del `.aab` para subirlo a Google Play
     Console → Producción → Crear nueva versión. El repo **no** tiene submission
     automática configurada (`eas.json → submit.production` está vacío), así que la
     subida a la tienda es manual.
   - `ios`: el artefacto aparece igual en la página del build (para TestFlight o
     simulador según credenciales).

Si el workflow de GitHub termina en rojo antes de imprimir la URL, el fallo es del
entorno (token, cuota o inputs), no de la compilación: revisa el log de la corrida.

## Credenciales Android: dónde viven (nunca en el repo)

| Credencial                                              | Dónde vive                                                                                                                  | Quién la gestiona                                                                                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Keystore de firma (`keystore.jks`), alias y contraseñas | **EAS Credential Manager** (remoto; `credentialsSource` no se sobreescribe en `eas.json`, así que rige el default `remote`) | Cuenta Expo `cloudcoffee-team`, desde https://expo.dev/accounts/cloudcoffee-team/credentials o `eas credentials` corriendo en `mobile/`         |
| `google-services.json` (Firebase)                       | **Trackeado** en `mobile/google-services.json`                                                                              | Cualquiera; solo contiene identificadores públicos de Firebase (project number, app id, API key), no secretos. EAS Build exige que esté en git. |
| `EXPO_TOKEN`                                            | Secret de GitHub del repo (Settings → Secrets and variables → Actions)                                                      | Owners de la cuenta Expo `cloudcoffee-team`                                                                                                     |
| `EXPO_PUBLIC_API_URL`                                   | Variable de GitHub (no secreta) + `.env` local de cada desarrollador                                                        | Cualquiera; el `.env` está en `.gitignore`                                                                                                      |

Reglas que el `.gitignore` de `mobile/` ya hace cumplir y que no se deben tocar:
los keystores y certificados (`*.jks`, `*.p12`, `*.p8`, `*.key`,
`*.mobileprovision`) y el `.env` **nunca** se commitean. Si EAS algún día pide
subir un keystore local (migración, cuenta nueva), se hace por `eas credentials` y
la copia de seguridad del `.jks` se guarda fuera del repo (gestor de contraseñas
del equipo), jamás en git.

## Versiones de app

`mobile/eas.json` fija `"cli": { "appVersionSource": "remote" }` (recomendado por
Expo desde EAS CLI 12): el `versionCode` de Android y el `buildNumber` de iOS los
administra **EAS en sus servidores**, no el código del repo. Con eso, un build
lanzado desde CI y uno lanzado desde la laptop de alguien usan la misma secuencia y
no chocan por números repetidos.

- Para inicializar o corregir el número remoto (por ejemplo, si Google Play ya
  tiene un `versionCode` mayor): correr `eas build:version:set` desde `mobile/` con
  la cuenta de Expo y elegir el número inicial.
- La versión visible al usuario (`expo.version` en `mobile/app.json`) sí se cambia
  a mano en el repo cuando se corta un release nuevo.

## Troubleshooting rápido

| Síntoma                                        | Causa y solución                                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `Falta el secret EXPO_TOKEN en el repositorio` | Falta el secret en GitHub → Settings → Secrets and variables → Actions (ver Requisitos).                   |
| El workflow pasa en verde pero no hay APK      | Normal: el build corre en EAS con `--no-wait`. Míralo en https://expo.dev/accounts/cloudcoffee-team/builds |
| Build de iOS falla en EAS por credenciales     | Nadie configuró las credenciales de Apple en EAS → https://expo.dev/accounts/cloudcoffee-team/credentials  |
| EAS rechaza el build por cuota                 | Plan Free agotado el mes: esperar al reinicio de cuota o que un owner gestione la facturación.             |
| El build usa la API URL equivocada             | Está horneada en el bundle: revisar la variable `EXPO_PUBLIC_API_URL` del repo y relanzar.                 |

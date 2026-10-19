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
- La versión mínima del CLI de Expo está fijada en `mobile/eas.json` (`cli.version`).
  El workflow instala `eas-cli@latest`, así que el pin fino de esa versión vive en
  el workflow (fuera de `mobile/`).
- El origen del número de versión (`cli.appVersionSource`) está fijado en `remote`
  (ver "Versiones de app").
- El `environment` de cada perfil (la llave que decide qué variables de EAS aplican
  al build) hoy lo infiere EAS automáticamente a partir del perfil; `mobile/eas.json`
  no lo declara de forma explícita (ver "Observaciones conocidas").

## Requisitos

1. **Acceso de escritura al repo** `CloudCoffee-Project/CloudCoffee` en GitHub
   (permiso para disparar workflows: pestaña Actions → Run workflow).
2. **Secret `EXPO_TOKEN` ya configurado en el repo**: Settings → Secrets and
   variables → Actions → Repository secrets. Es un access token de Expo de la cuenta
   `cloudcoffee-team` (https://expo.dev/accounts/cloudcoffee-team/settings/access-tokens),
   generado por un owner de esa cuenta. Si falta, el workflow falla en el paso
   "Verify Expo auth" con el error `Falta el secret EXPO_TOKEN en el repositorio`:
   pide a un integrante con acceso a la cuenta de Expo que lo agregue.
3. **`EXPO_PUBLIC_API_URL` dada de alta en servidores EAS** (configuración única
   por proyecto). La URL del gateway se hornea en el bundle JavaScript **en los
   servidores de EAS**, y esos servidores no leen ni el `.env` local ni las
   variables de GitHub Actions: solo las variables de entorno de EAS (doc oficial:
   _"Environment variables must be defined on EAS servers to be made available to
   EAS Build builders"_). Desde `mobile/`, con la cuenta de Expo autenticada
   (`npx eas whoami`):
   - **Verificar**: `npx eas env:list` → debe aparecer `EXPO_PUBLIC_API_URL` con
     ambiente `preview` y con ambiente `production`.
   - **Si falta, darla de alta** (el valor es la misma URL que está en la variable
     `EXPO_PUBLIC_API_URL` del repo en GitHub, o la del gateway desplegado):
     `npx eas env:set --name EXPO_PUBLIC_API_URL --value <URL del gateway> --environment preview --visibility plaintext`
     y el mismo comando con `--environment production`.
   - **La variable de GitHub no sustituye esta**: el workflow de release la pasa
     como entorno del step donde corre `eas build`, y ahí termina su efecto; solo
     la consume el export web del CI (`mobile-ci.yml`).
   - Opcional hoy: `EXPO_PUBLIC_WS_URL` con el mismo patrón, cuando el backend
     exponga `/ws`.

Android no requiere más preparación: el keystore de firma vive en EAS (ver
"Credenciales Android"). Para iOS:

- `preview` + iOS es build de **simulador** (`ios.simulator: true` en `eas.json`):
  **no** necesita cuenta de Apple ni credenciales.
- `production` + iOS sí necesita credenciales de Apple configuradas en EAS por un
  owner de la cuenta; sin ellas ese build falla en EAS.

## Cómo lanzarlo

1. En GitHub, abrir el repo → pestaña **Actions** → seleccionar **Mobile Release**
   en la lista izquierda → botón **Run workflow** (esquina superior derecha).
2. Elegir el branch (por defecto el de `main`) y los dos inputs:
   - **profile**: `preview` (por defecto) o `production`.
     - `preview`: APK con distribución interna, instalable directo en un dispositivo
       Android desde un link/QR. Es el build de prueba para el equipo.
     - `production`: AAB (`.aab`) para subir a Google Play Console. No se puede
       instalar directo en un celular.
   - **platform**: `android` (por defecto), `ios` o `all`.
3. Pulsar **Run workflow**. El workflow corre `eas build --non-interactive --no-wait`:
   **no espera a que termine la compilación**, solo la encola en EAS y termina rápido
   (minutos). El build real continúa en los servidores de Expo.

Nota: cada lanzamiento consume un build de la cuota mensual del plan Free.

## Dónde ver el resultado

1. **GitHub Actions** (la corrida que acabas de disparar): en el log del job "EAS
   build", el paso "Build (Android)" o "Build (iOS)" muestra el ID/URL del build en
   EAS. Como el workflow usa `--no-wait`, la corrida termina apenas encola el
   trabajo: si el log no muestra el link, la lista de EAS es la fuente de verdad.
2. **EAS (fuente de verdad del artefacto)**:
   https://expo.dev/accounts/cloudcoffee-team/projects/mobile/builds
   Ahí se ve el progreso en vivo y, al terminar:
   - `preview` / Android: botón **Install** con link/QR para instalar el APK en un
     dispositivo (distribución interna) y descarga directa del `.apk`.
   - `production` / Android: descarga del `.aab` para subirlo a Google Play
     Console → Producción → Crear nueva versión. El repo **no** tiene submission
     automática configurada (`eas.json → submit.production` está vacío), así que la
     subida a la tienda es manual.
   - `preview` / iOS: build de simulador; se descarga igual desde la página del
     build y se instala con `npx eas build:run -p ios`.
   - `production` / iOS: artefacto para TestFlight/subida a la tienda, requiere
     credenciales de Apple en EAS.

Si el workflow de GitHub termina en rojo antes de imprimir la URL, el fallo es del
entorno (token, cuota o inputs), no de la compilación: revisa el log de la corrida.

## Credenciales Android: dónde viven (nunca en el repo)

| Credencial                                              | Dónde vive                                                                                                                  | Quién la gestiona                                                                                                                                 |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keystore de firma (`keystore.jks`), alias y contraseñas | **EAS Credential Manager** (remoto; `credentialsSource` no se sobreescribe en `eas.json`, así que rige el default `remote`) | Cuenta Expo `cloudcoffee-team`, en https://expo.dev/accounts/cloudcoffee-team/projects/mobile/credentials o `npx eas credentials` desde `mobile/` |
| `google-services.json` (Firebase)                       | **Trackeado** en `mobile/google-services.json`                                                                              | Cualquiera; solo contiene identificadores públicos de Firebase (project number, app id, API key), no secretos. EAS Build exige que esté en git.   |
| `EXPO_TOKEN`                                            | Secret de GitHub del repo (Settings → Secrets and variables → Actions)                                                      | Owners de la cuenta Expo `cloudcoffee-team`                                                                                                       |
| `EXPO_PUBLIC_API_URL` (la del bundle del build)         | **Variables de entorno de EAS**, por ambiente (`npx eas env:set` / dashboard de EAS del proyecto)                           | Integrantes con acceso a la cuenta Expo. En local se refleja en `.env` (gitignored), sincronizable con `npx eas env:pull`                         |
| `vars.EXPO_PUBLIC_API_URL` (la de GitHub)               | Configuración del repo GitHub                                                                                               | Cualquiera con acceso al repo. Solo la usa el export web del CI; **no** llega a los builds de EAS                                                 |

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

- El perfil `production` **no** tiene `autoIncrement`: todas las builds de
  producción usan el mismo `versionCode` remoto. La primera subida a Play funciona,
  pero la segunda se rechaza por `versionCode` duplicado. Hasta que el equipo decida
  si agregar `autoIncrement` a `eas.json` (ver "Observaciones conocidas"), sube el
  contador a mano antes de cada subida con `npx eas build:version:set`. Los
  perfiles comparten un único contador remoto por plataforma.
- Para inicializar o corregir el número remoto (por ejemplo, si Google Play ya
  tiene un `versionCode` mayor): correr `npx eas build:version:set` desde `mobile/`
  con la cuenta de Expo y elegir el número inicial.
- La versión visible al usuario (`expo.version` en `mobile/app.json`) sí se cambia
  a mano en el repo cuando se corta un release nuevo.

## Troubleshooting rápido

| Síntoma                                                          | Causa y solución                                                                                                                                                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Falta el secret EXPO_TOKEN en el repositorio`                   | Falta el secret en GitHub → Settings → Secrets and variables → Actions (ver Requisitos).                                                                                                                        |
| El workflow pasa en verde pero no hay APK                        | Normal: el build corre en EAS con `--no-wait`. Míralo en https://expo.dev/accounts/cloudcoffee-team/projects/mobile/builds                                                                                      |
| La app instalada en un celular apunta a `10.0.2.2` o `localhost` | Falta `EXPO_PUBLIC_API_URL` en EAS: sin ella la app usa el default de emulador. Verificar con `npx eas env:list`, darla de alta y **relanzar el build** (la URL va horneada en el bundle).                      |
| La app apunta a la API equivocada                                | La URL vive en **EAS** (no en GitHub): actualizarla con `npx eas env:set` y relanzar el build; si cambia el dominio del gateway, actualizar también `vars.EXPO_PUBLIC_API_URL` (alimenta el export web del CI). |
| Build de `production`/iOS falla en EAS por credenciales          | Nadie configuró las credenciales de Apple en EAS → https://expo.dev/accounts/cloudcoffee-team/projects/mobile/credentials (no aplica a `preview`/iOS, que es de simulador)                                      |
| Play rechaza la subida: `version code ... already used`          | `production` no tiene `autoIncrement`: subir el contador con `npx eas build:version:set` antes de volver a subir (ver "Versiones de app").                                                                      |
| EAS rechaza el build por cuota                                   | Plan Free agotado el mes: esperar al reinicio de cuota o que un owner gestione la facturación.                                                                                                                  |

## Observaciones conocidas (escritas, no accionadas)

Hallazgos de la revisión de INT4-112 que **no se corrigieron a propósito**: son
trabajo de otros integrantes o archivos fuera de `mobile/`, así que solo quedan
documentados aquí para que quien los quiera retomar sepa el contexto.

1. **`production` sin `autoIncrement`** (`mobile/eas.json`, perfil de otros): con
   `appVersionSource: remote` todas las builds de producción usan el mismo
   `versionCode`, y la **segunda** subida a Play se rechaza por duplicado. Mientras
   tanto, el workaround es subir el contador a mano con
   `npx eas build:version:set` antes de cada subida. Si el equipo lo aprueba, el
   fix es una línea: `"autoIncrement": true` en `build.production`.
2. **Perfiles sin `environment` explícito** (`mobile/eas.json`, perfil de otros):
   hoy EAS infiere el ambiente de cada perfil y funciona, pero la recomendación
   oficial es declararlo (`"environment": "development" | "preview" | "production"`
   en cada perfil) para que un cambio futuro de un perfil no cambie en silencio el
   conjunto de variables de EAS que aplica.
3. **`EXPO_PUBLIC_API_URL` vacía no cae al default** (`mobile/src/config/api.ts`,
   código de otros): se lee con `??`, que no reemplaza `""`. Si la variable existe
   pero llega vacía, el bundle queda con `baseURL` vacío. Mitigación hoy: verificar
   que `vars.EXPO_PUBLIC_API_URL` en GitHub tenga valor (ver Requisitos).
4. **Workflow (fuera de `mobile/`, no tocable por esta ticket)**:
   `mobile-release.yml` pasa `EXPO_PUBLIC_API_URL` como entorno de los steps de
   `eas build`, pero eso **no llega** al builder de EAS (la fuente real son las
   variables de EAS, ver Requisitos); además instala `eas-cli@latest` sin pinear.
5. **`expo-doctor` con 2 checks en rojo (preexistentes)**: los paquetes `npm` e
   `install` están instalados por error en `devDependencies`, y ~19 dependencias
   están desalineadas respecto al SDK 57 (incluye `@types/jest` 30 vs. 29
   esperado). Arreglarlo toca `package-lock.json` y puede romper tests: es un
   ticket aparte (`npx expo install --check`).

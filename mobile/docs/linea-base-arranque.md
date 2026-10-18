# Línea base de tiempo de arranque (INT4-113)

Cuánto tarda la app en mostrar su primera pantalla útil. **Es una medición, no una
optimización**: no se cambió código de la app para mejorar nada, solo se instrumentó
la medición desde afuera y se dejó el número registrado con su contexto.

## Resumen (la tabla)

Mediana de la métrica **"ms desde el inicio de la carga hasta que la primera pantalla
útil está renderizada y visible"**, sobre el build **web** (`expo export -p web`):

| Modo                                         |    Mediana |  Media |    Mín |    Máx | Repeticiones (n) | Fallos |
| -------------------------------------------- | ---------: | -----: | -----: | -----: | ---------------: | -----: |
| Arranque en frío (caché HTTP deshabilitada)  | **132 ms** | 153 ms | 108 ms | 330 ms |               10 |      0 |
| Arranque en caliente (caché HTTP habilitada) | **117 ms** | 115 ms |  93 ms | 128 ms |               10 |      0 |

Contexto de esa tabla:

- **Métrica**: `performance.now()` en el instante en que aparecen los textos
  `Crear cuenta` e `Iniciar sesión` de la portada, en elementos con caja visible
  (ancho y alto > 0). `performance.now()` se mide desde el inicio de la navegación.
- **Primera pantalla útil**: la **portada** (`/portada`), la pantalla que ve un
  usuario sin sesión; ver "Qué se midió".
- **Dispositivo**: PC de escritorio (Windows 11, Intel i5-12500H, 15.6 GB RAM) con
  **Microsoft Edge 155.0.4283.62 headless**, servidor HTTP local en `127.0.0.1`.
- **Artefacto medido**: build web del commit `e892648` (rama
  `fbenavides2023/int4-113-medir-la-linea-base-de-tiempo-de-arranque`), bundles
  `entry-379f85f6…js` (1 710 392 B) + `index-67eb6083…js` (45 266 B) = **1 714 kB**.
- **Repetibilidad**: la medición se corrió dos veces sobre **builds distintos** (una
  copia limpia del commit y el árbol de trabajo con cambios locales ajenos a la ruta
  de arranque). Resultado: frío 132 vs 123 ms y caliente 117 vs 122 ms de mediana —
  la métrica es estable (±10 ms) y no depende de esos cambios.
- **Navegador ≠ teléfono**: estos números son de la ruta JS/React en un navegador de
  escritorio. **No** son comparables con el arranque nativo en un teléfono (que
  además incluye el arranque de la app nativa, la carga del bundle Hermes y el
  splash). Ver "Alcance y limitaciones".

## Qué se midió exactamente

Al abrir la app sin sesión guardada, el camino real es:

1. Se carga el documento (`/`).
2. Se hidrata la app: el layout raíz (`src/app/_layout.tsx`) aún no sabe si hay
   sesión, así que muestra el indicador de carga (`bootstrapping`).
3. `AuthProvider` (`src/context/AuthContext.tsx`) lee la sesión guardada
   (`sessionStorage.ts`: `SecureStore` en móvil, `localStorage` en web). Sin sesión,
   termina el bootstrapping sin llamadas de red.
4. El layout navega a `/(auth)/portada`.
5. `portada.tsx` renderiza: marca, ilustración, y los botones **Crear cuenta** e
   **Iniciar sesión**.

La medición termina en el paso 5, cuando esos botones ya están en el DOM y son
visibles. Que la ruta final de las 20 corridas haya sido `/portada` confirma que se
midió ese camino completo (incluida la redirección) y no un texto cualquiera.

Un detalle que hace la medición válida: el export estático **no** prerenderiza la
portada (todos los HTML prerenderizados traen solo el spinner de `bootstrapping`),
así que el marcador no puede dispararse antes de que la app hidrate y navegue.

## Método

- Build: `npx expo export -p web` (exportación estática, `web.output: "static"`).
- Servidor: el propio script levanta un servidor HTTP en `127.0.0.1` sobre el
  directorio exportado (sin red externa, para no medir latencia de internet).
- Medición: Edge en modo headless controlado por **DevTools Protocol** (CDP).
  El script inyecta un observador **antes** de que cargue la página
  (`Page.addScriptToEvaluateOnNewDocument`), con un `MutationObserver` que revisa el
  DOM y guarda el instante del marcador.
- Ningún cambio en el código de la app: el observador vive fuera del bundle.
- Repeticiones: **10 por modo**. En cada repetición se navega a `about:blank` y
  vuelta a la app (documento nuevo, igual que una apertura). Modo frío con la caché
  HTTP deshabilitada; modo caliente con caché habilitada y una corrida de
  calentamiento previa que no se cuenta.
- Estadística: mediana (métrica principal), media, mínimo y máximo.

Comandos (desde `mobile/`):

```bash
npx expo export -p web                 # genera ./dist (ignorado por git)
node scripts/measure-startup-web.mjs --dir dist --runs 10
```

Opciones: `--modes cold,warm`, `--timeout <ms>`, `--browser <ruta>`, `--out <json>`,
`--json` (solo el JSON de resultados).

Qué se versiona y qué no: el arnés (`scripts/measure-startup-web.mjs`) y este
documento **sí** van al repositorio; el build exportado (`dist/`) **no** (está en
`.gitignore`), se regenera con el comando de arriba. Con `--out` se guarda el JSON
crudo de cada corrida (ms, FCP, DOMContentLoaded, bytes, errores de JS) por si se
quiere auditar la medición.

## Valores crudos

Frío (`cold`), 10 repeticiones — ms hasta la pantalla útil / FCP / DOMContentLoaded:

|   # | ms pantalla útil |          ms FCP | ms DOMContentLoaded | Ruta final |
| --: | ---------------: | --------------: | ------------------: | ---------- |
|   1 |              330 | (no registrado) |                 178 | /portada   |
|   2 |              193 |              92 |                 104 | /portada   |
|   3 |              126 |              76 |                  84 | /portada   |
|   4 |              130 |              68 |                  85 | /portada   |
|   5 |              137 |              56 |                  87 | /portada   |
|   6 |              124 |              52 |                  84 | /portada   |
|   7 |              111 |              60 |                  75 | /portada   |
|   8 |              133 |              60 |                  98 | /portada   |
|   9 |              108 |              72 |                  69 | /portada   |
|  10 |              140 |              76 |                  67 | /portada   |

Caliente (`warm`), 10 repeticiones:

|   # | ms pantalla útil | ms DOMContentLoaded | Ruta final |
| --: | ---------------: | ------------------: | ---------- |
|   1 |              109 |                  69 | /portada   |
|   2 |               93 |                  48 | /portada   |
|   3 |              101 |                  65 | /portada   |
|   4 |              117 |                  62 | /portada   |
|   5 |              114 |                  58 | /portada   |
|   6 |              127 |                  67 | /portada   |
|   7 |              120 |                  60 | /portada   |
|   8 |              118 |                  59 | /portada   |
|   9 |              128 |                  68 | /portada   |
|  10 |              128 |                  67 | /portada   |

En caliente el FCP no queda registrado en ninguna corrida (se observó igual en las dos
mediciones; no se investigó la causa porque no afecta a la métrica principal), y en la
primera corrida en frío tampoco. La pantalla útil sí quedó registrada en las **20
corridas**.

## Lectura de los resultados

- **La mediana es lo que vale**: 132 ms en frío y 117 ms en caliente. La media del
  modo frío (153 ms) está inflada por la **primera corrida (330 ms)**, que es un
  valor atípico: es la única que corre sin la caché de código de V8 ni el perfil de
  ejecución calientes. Por eso la línea base se reporta con mediana.
- **Frío y caliente dan casi lo mismo** (132 vs 117 ms): con un servidor local, lo
  que domina el arranque no es la descarga de los 1 714 kB, sino **parsear y ejecutar
  el bundle, hidratar React, leer la sesión y renderizar la portada**. La caché HTTP
  mueve poco la aguja.
- **Consistencia**: dentro de cada modo, la mayoría de las corridas cae en una
  ventana de ~35 ms (frío 108-140 ms sin el atípico de 330 ms; caliente 93-128 ms).
  Sin errores de JS en ninguna corrida; el único aviso de consola es de
  `expo-notifications` ("push token changes is not yet fully supported on web"),
  esperado en web.
- El margen entre `DOMContentLoaded` (≈60-100 ms) y la pantalla útil (≈110-140 ms) es
  el trabajo de React: hidratar, resolver el bootstrapping de sesión, redirigir a
  `/portada` y pintarla.

## Alcance y limitaciones (leer antes de usar el número)

- **Es la ruta web, no el arranque nativo.** Un teléfono real arranca el binario,
  carga el bundle Hermes y muestra el splash nativo antes de que exista la primera
  pantalla útil. Nada de eso está en estos 132/117 ms. La comparación con Android/iOS
  queda pendiente (ver "Siguiente paso").
- **Es una línea base del commit `e892648`**: sirve para comparar contra sí misma
  (mismo método, mismo equipo, mismas condiciones) cuando alguien cambie algo que
  afecte el arranque. No es un valor absoluto de performance de la app.
- El árbol de trabajo tenía archivos modificados sin commitear (trabajo de otros
  integrantes en `auth.ts`/`httpClient.ts` y pantallas), así que **para que la
  medición fuera trazable a un commit se compiló una copia limpia del commit
  `e892648`** (solo archivos versionados) y se midió esa. Ninguno de los archivos
  modificados locales pertenece a la ruta de arranque
  (`_layout.tsx`, `portada.tsx`, `AuthContext.tsx`, `sessionStorage.ts`).
- El servidor es local: se elimina la latencia de red. En producción, un arranque
  web real es peor (descarga del bundle). La medición en frío con caché deshabilitada
  se acerca a ese escenario, pero no lo reproduce del todo.

## Siguiente paso

Para tener el número "de la app en un teléfono" hace falta medir el arranque nativo
en un dispositivo Android real (o emulador), con el mismo criterio de "primera
pantalla útil", por ejemplo:

1. Instalar el APK (`preview` de EAS o `npx expo run:android --variant release`).
2. `adb shell am force-stop cl.cloudcoffee.mobile` entre corridas.
3. Medir el arranque en frío (`adb shell am start -W`) **y** el momento en que la
   portada ya responde, repitiendo 10 veces y usando la mediana.

Eso requiere un JDK 17 y/o credenciales de Expo, que no estaban disponibles en la
máquina donde se hizo esta medición. Mientras tanto, esta tabla es la línea base
disponible y es la que se debe repetir cuando se quiera saber si el arranque mejoró
o empeoró.

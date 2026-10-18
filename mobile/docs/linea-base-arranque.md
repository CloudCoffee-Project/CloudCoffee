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
- **Medición en teléfono**: existe además una estimación informal de ~7,5 s abriendo
  la app en **Expo Go** (modo desarrollo). Está documentada aparte y tampoco es
  comparable con esta tabla: ver "Estimación en teléfono (Expo Go, modo desarrollo)".

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

## Estimación en teléfono (Expo Go, modo desarrollo)

| Escenario                                         | Tiempo | Repeticiones                           | Método                                              | Dispositivo                                         |
| ------------------------------------------------- | -----: | -------------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| Abrir la app en Expo Go escaneando el QR de Metro | ~7,5 s | 1 estimación informal (sin cronómetro) | escaneo del QR y apertura manual, a ojo del usuario | teléfono Android del integrante (modelo por anotar) |

Cómo leerla:

- Es una **estimación informal aportada por un integrante**, no una medición
  instrumentada: se tomó una vez, a ojo, sin cronómetro ni repeticiones. Por eso no
  tiene mediana y no cumple por sí sola el criterio de la tarea; está acá porque es el
  único dato disponible **de un teléfono real**.
- **No es un arranque en modo producción.** En Expo Go el código no viene compilado
  dentro de la app: Expo Go descarga el bundle JS desde el servidor de Metro por la
  red (un bundle de tamaño comparable a los ~1,7 MB que se midieron en web, pero por
  Wi-Fi y sin optimizar), y además arranca la cáscara de Expo Go. Eso explica que esté
  **unas 55-60 veces** por encima de los 132/117 ms web, que se midieron con los
  archivos ya en disco.
- **No es comparable con la tabla web** ni con un APK de release: son tres caminos
  distintos (web local, Expo Go dev por red, app nativa release). Cada uno necesita
  su propia línea base.
- Después de la primera apertura, Expo Go suele reusar el bundle ya descargado, así
  que las aperturas siguientes son bastante más rápidas. Si los ~7,5 s son de la
  primera apertura tras escanear el QR, corresponden al caso "frío en desarrollo".

Para convertirla en una medición en regla (opcional, 5 minutos, sin instalar nada):

1. Cerrar Expo Go desde las apps recientes del teléfono (para que la apertura sea en
   frío).
2. Abrir la app y cronometrar desde que se escanea el QR hasta que aparece la portada
   con los botones _Crear cuenta_ e _Iniciar sesión_ (la misma definición de "primera
   pantalla útil" de esta medición).
3. Repetir **5 veces** (idealmente 10) y anotar cada tiempo; la línea base es la
   **mediana**.
4. Anotar el modelo del teléfono, la versión de Android y la versión de Expo Go, para
   que el número sea reproducible.

Con precisión automática en lugar de cronómetro humano, la alternativa es conectar el
teléfono por USB y usar los _timestamps_ de `adb logcat` para marcar el arranque y la
aparición de la portada.

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
  pantalla útil. Nada de eso está en estos 132/117 ms. La única referencia de teléfono
  que hay es la estimación de ~7,5 s en Expo Go (modo desarrollo), que mide otro
  camino; la comparación nativa real queda pendiente (ver "Siguiente paso").
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

Hay dos caminos, en orden de costo:

1. **Formalizar la estimación de Expo Go** (barato, sin instalar nada): seguir el
   protocolo de 5-10 repeticiones de la sección "Estimación en teléfono", anotar el
   modelo del teléfono y quedarse con la mediana. Da un número de teléfono real, pero
   sigue siendo modo desarrollo.
2. **Medir el arranque nativo de release** (es el número que de verdad interesa):
   instalar el APK (`preview` de EAS o `npx expo run:android --variant release`) en un
   teléfono o emulador y medir el arranque en frío, con el mismo criterio de "primera
   pantalla útil":

   - `adb shell am force-stop cl.cloudcoffee.mobile` entre corridas.
   - `adb shell am start -W` para el arranque nativo **y** el momento en que la portada
     ya responde.
   - 10 repeticiones y mediana.

Ese segundo camino requiere un JDK 17 y/o credenciales de Expo, que no estaban
disponibles en la máquina donde se hizo esta medición. Mientras tanto, la tabla web de
arriba es la línea base formal y es la que se debe repetir cuando se quiera saber si el
arranque mejoró o empeoró.

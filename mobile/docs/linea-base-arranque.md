# Línea base de tiempo de arranque (INT4-113)

Cuánto tarda la app en mostrar su primera pantalla útil. **Es una medición, no una
optimización**: no se cambió código de la app para mejorar nada. La medición web se
instrumentó desde afuera (sin tocar la app) y la del teléfono con una marca temporal de
log que **se revirtió** al terminar; en el repositorio no queda ningún cambio de código
por esta tarea.

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
- **Medición en teléfono**: hay además una medición instrumentada en un **teléfono
  real** abriendo la app en **Expo Go** (modo desarrollo), con mediana **5 795 ms**.
  Tampoco es comparable con esta tabla web (son caminos distintos); ver "Medición en
  teléfono (Expo Go, modo desarrollo)".

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

## Medición en teléfono (Expo Go, modo desarrollo)

Mediana de la métrica **"ms desde que el teléfono pide el bundle de JS al servidor de
Metro hasta que la portada está pintada y usable en pantalla"**, abriendo la app en
**Expo Go** sobre Wi-Fi:

| Modo                                                                             |      Mediana |    Media |      Mín |      Máx | Repeticiones (n) | Fallos |
| -------------------------------------------------------------------------------- | -----------: | -------: | -------: | -------: | ---------------: | -----: |
| Apertura en frío de Expo Go (modo desarrollo; bundle de JS de 8,97 MB por Wi-Fi) | **5 795 ms** | 5 956 ms | 5 555 ms | 6 519 ms |                3 |      0 |

Contexto de esa tabla:

- **Métrica**: instante en que la portada (`/portada`) queda pintada y usable en el
  teléfono, con **el mismo criterio de "primera pantalla útil"** que la tabla web
  (botones _Crear cuenta_ e _Iniciar sesión_ en pantalla). El cronómetro arranca cuando
  el teléfono **pide el bundle de JS** al servidor de Metro (ver "Método").
- **Dispositivo**: **Samsung Galaxy S20 FE** (2020). El integrante indicó "la última
  versión de Android" de su teléfono; para ese modelo la última es **Android 13
  (One UI 5.1)**. Cliente **Expo Go 57.0.9** (la última publicada para SDK 57 según
  `api.expo.dev/v2/versions/latest`, consultada el 2026-10-18).
- **Modo**: **desarrollo**, no producción. La app corre dentro de Expo Go: el código no
  viene compilado dentro del APK, sino que Expo Go **descarga el bundle de JS desde
  Metro por Wi-Fi** (**8 971 390 B ≈ 8,97 MB**) y lo interpreta con Hermes en el teléfono.
- **Servidor**: Metro en la PC del integrante (Ethernet), con el teléfono en la misma red
  local. Metro estaba **caliente**: el bundle ya estaba construido, así que los 5 795 ms
  incluyen servirlo, descargarlo e interpretarlo, pero **no** el empaquetado inicial (que
  la primera vez tardó ~22,5 s y se hizo antes de medir, a propósito).
- **Repetibilidad**: **3 aperturas en frío** (se cerró Expo Go desde las apps recientes
  antes de cada una). Es el mínimo acordado para reportar mediana; con 5-10 datos el
  número quedaría más firme.
- **Fecha**: 2026-10-18, entre las 19:46 y las 19:48 (hora local del equipo de medición).

### Valores crudos

Cada fila es una apertura. "Pedido del bundle" y "App ejecutándose" salen del log de
Metro; "Portada usable" es la marca que envió el propio teléfono:

|   # | Pedido del bundle | App ejecutándose | Portada usable |  **Δ total** | Δ hasta app viva | Último tramo (app viva → portada) |
| --: | ----------------: | ---------------: | -------------: | -----------: | ---------------: | --------------------------------: |
|   1 |       19:46:29,78 |      19:46:35,23 |    19:46:36,30 | **6 519 ms** |         5 449 ms |                          1 070 ms |
|   2 |       19:46:57,57 |      19:47:02,14 |    19:47:03,12 | **5 555 ms** |         4 572 ms |                            983 ms |
|   3 |       19:48:15,26 |      19:48:20,04 |    19:48:21,05 | **5 795 ms** |         4 780 ms |                          1 015 ms |

Cómo leerla:

- **La mediana es 5 795 ms** (5,8 s). La media (5 956 ms) está algo por encima porque la
  corrida 1 fue la más lenta.
- **Los 3 intentos se parecen**: 5 555 a 6 519 ms (ventana de ~1 s). Un mismo camino, un
  mismo dispositivo y una misma red: el número es estable dentro de lo esperable.
- **Qué domina el tiempo**: casi todo es **descargar e interpretar el bundle de
  desarrollo**. En los tres intentos, desde que el propio código de la app empieza a
  ejecutarse hasta que la portada está pintada pasaron **1 070 / 983 / 1 015 ms** — es
  decir **≈1,0 s constante**. El resto (4,6-5,4 s) es bajar los 8,97 MB por Wi-Fi y que
  Hermes los parsee y ejecute.
- **Contra la estimación informal previa (~7,5 s)**: los dos números son compatibles. A
  estos 5,8 s hay que sumarles lo que pasa **antes** de pedir el bundle: abrir el proyecto
  en Expo Go (por QR escaneado o desde la lista de recientes) y el pedido del _manifest_.
  Ese tramo no está en la tabla porque no deja marca en el log; según el caso va desde
  unas décimas hasta un par de segundos, que es justo lo que explica la diferencia entre
  los 5,8 s medidos y los ~7,5 s percibidos a ojo. No se contradicen: miden extremos
  distintos del mismo arranque.
- **No es comparable con la tabla web** (132/117 ms) ni con un APK de release: son tres
  caminos distintos (web local con archivos ya en disco, Expo Go dev por red, app nativa
  release). Los 5,8 s miden, sobre todo, **el costo del modo desarrollo**, no un problema
  de la app.

### Método

- **De dónde sale el inicio**: del propio log de Metro (`Android Bundled <ms> …`). La
  hora de esa línea **menos** su duración da el instante en que el teléfono pidió el
  bundle.
- **De dónde sale el fin**: de una **instrumentación temporal** (una sola línea) en
  `src/app/(auth)/portada.tsx`: un `console.warn('[INT4-113] PORTADA_USABLE')` dentro de
  un `requestAnimationFrame` en un `useEffect` de montaje, o sea **después del primer
  pintado** de la portada. El log del dispositivo llega al servidor de Metro, que lo
  imprime con la hora de la PC.
- **La instrumentación se revirtió**: terminada la medición, `portada.tsx` volvió a su
  versión del repositorio (`git checkout`) y se verificó que no quedara ningún rastro del
  marcador. **No se commiteó ningún cambio en el código de la app**: es una medición, no
  una optimización.
- **Cierre de la app**: el integrante cerró Expo Go desde las apps recientes antes de
  cada apertura, para que cada una fuera en frío.
- **Discriminación de eventos**: el log también registra recargas de _Fast Refresh_
  (HMR), que repintan la portada sin que haya apertura. Solo se contaron las marcas
  `PORTADA_USABLE` **posteriores a un pedido de bundle nuevo**. Se descartó, además, un
  pedido de bundle a las 19:39:14 seguido por un intento de apertura que **no llegó a
  ejecutar la app** (sin logs): no es una apertura válida.
- **Precisión**: la hora del pedido del bundle es exacta (log del servidor). La marca de
  fin arrastra el retardo de transporte del log del dispositivo al servidor (decenas de
  ms) y el desfase entre el primer pintado y el `requestAnimationFrame` (un cuadro). En
  una métrica de ~5,8 s, ese error (<~50 ms) es despreciable.

## Lectura de los resultados (tabla web)

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
  pantalla útil. Nada de eso está en estos 132/117 ms. La referencia de teléfono que hay
  es la medición en **Expo Go** (modo desarrollo, mediana 5 795 ms), que mide otro
  camino; la comparación nativa real (APK de release) queda pendiente (ver "Siguiente
  paso").
- **Es una línea base del commit `e892648`**: sirve para comparar contra sí misma
  (mismo método, mismo equipo, mismas condiciones) cuando alguien cambie algo que
  afecte el arranque. No es un valor absoluto de performance de la app.
- El árbol de trabajo tenía archivos modificados sin commitear (trabajo de otros
  integrantes en `auth.ts`/`httpClient.ts` y pantallas), así que **para que la
  medición fuera trazable a un commit se compiló una copia limpia del commit
  `e892648`** (solo archivos versionados) y se midió esa. Ninguno de los archivos
  modificados locales pertenece a la ruta de arranque
  (`_layout.tsx`, `portada.tsx`, `AuthContext.tsx`, `sessionStorage.ts`).
- La medición en teléfono (Expo Go) se hizo sobre el **árbol de trabajo** de ese momento
  (commit `e892648` más los cambios locales de otros integrantes), no sobre una copia
  limpia. Los archivos de la ruta de arranque sí eran los del commit (la instrumentación
  temporal en `portada.tsx` se revirtió), y en modo desarrollo el tiempo está dominado por
  la descarga e interpretación del bundle, no por detalles de la app.
- El servidor es local: se elimina la latencia de red. En producción, un arranque
  web real es peor (descarga del bundle). La medición en frío con caché deshabilitada
  se acerca a ese escenario, pero no lo reproduce del todo.

## Siguiente paso

La medición en teléfono (Expo Go) ya está hecha: mediana **5 795 ms**, n=3. Queda, en
orden de costo:

1. **Ampliar la muestra en Expo Go** (barato, sin instalar nada): repetir el mismo
   protocolo hasta 5-10 aperturas para afianzar la mediana. El número seguiría siendo de
   modo desarrollo.
2. **Medir el arranque nativo de release** (es el número que de verdad interesa):
   instalar el APK (`preview` de EAS o `npx expo run:android --variant release`) en un
   teléfono o emulador y medir el arranque en frío, con el mismo criterio de "primera
   pantalla útil":

   - `adb shell am force-stop cl.cloudcoffee.mobile` entre corridas.
   - `adb shell am start -W` para el arranque nativo **y** el momento en que la portada
     ya responde.
   - 10 repeticiones y mediana.

Ese segundo camino requiere un JDK 17 y/o credenciales de Expo, que no estaban
disponibles en la máquina donde se hizo esta medición. Mientras tanto quedan **dos líneas
base medidas y trazables**: la web (132 / 117 ms) y la de Expo Go (5 795 ms). Cada una
sirve para comparar **contra sí misma** (mismo método, mismo equipo) cuando alguien cambie
algo que afecte el arranque; no son intercambiables entre sí.

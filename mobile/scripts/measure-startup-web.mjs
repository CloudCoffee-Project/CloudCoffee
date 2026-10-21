#!/usr/bin/env node
// Medición de la línea base de tiempo de arranque (INT4-113).
//
// Mide cuánto tarda la app en mostrar su PRIMERA PANTALLA ÚTIL sobre el build
// web exportado (expo export -p web), repitiendo N arranques en frío y en
// caliente, y reportando la mediana. Es una MEDICIÓN: no optimiza ni cambia
// código de la app.
//
// Cómo funciona:
//   1. Sirve el directorio exportado por HTTP en 127.0.0.1 (solo localhost).
//   2. Lanza Edge/Chrome headless y se conecta por DevTools Protocol (CDP).
//   3. Inyecta un observador ANTES de que cargue la página: cada vez que el DOM
//      cambia comprueba si ya están los textos de la portada ("Crear cuenta" e
//      "Iniciar sesión") y elementos visibles (caja con ancho/alto > 0). Cuando
//      aparecen, guarda `performance.now()`, que es justo "ms desde el inicio de
//      la navegación" → esa es la métrica.
//   4. Repite el arranque N veces (frío: caché HTTP deshabilitada; caliente:
//      caché habilitada) y calcula mediana, mínimo, máximo y media.
//
// No usa dependencias: solo Node >= 22 (fetch y WebSocket globales) y un
// navegador Chromium instalado en el sistema (Edge viene con Windows).
//
// Uso:
//   npx expo export -p web          # genera ./dist (está en .gitignore)
//   node scripts/measure-startup-web.mjs --dir dist --runs 10
//
// Opciones:
//   --dir <ruta>      Directorio exportado a servir (default: dist)
//   --runs <n>        Repeticiones por modo (default: 10)
//   --modes <lista>   cold,warm (default: cold,warm)
//   --timeout <ms>    Espera máxima por arranque (default: 60000)
//   --browser <ruta>  Ruta a msedge.exe/chrome.exe (si no se detecta)
//   --out <archivo>   Guarda los resultados crudos en JSON
//   --json            Imprime solo el JSON de resultados
//   --keep-open       No cierra el navegador al terminar (depuración)

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ─────────────────────────── argumentos ───────────────────────────

function parseArgs(argv) {
  const opts = {
    dir: 'dist',
    runs: 10,
    modes: ['cold', 'warm'],
    timeout: 60000,
    browser: null,
    out: null,
    json: false,
    keepOpen: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`Falta el valor de ${arg}`);
      i += 1;
      return v;
    };
    if (arg === '--dir') opts.dir = value();
    else if (arg === '--runs') opts.runs = Number(value());
    else if (arg === '--modes')
      opts.modes = value()
        .split(',')
        .map((m) => m.trim());
    else if (arg === '--timeout') opts.timeout = Number(value());
    else if (arg === '--browser') opts.browser = value();
    else if (arg === '--out') opts.out = value();
    else if (arg === '--json') opts.json = true;
    else if (arg === '--keep-open') opts.keepOpen = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Ver el comentario de cabecera de este script para el uso.');
      process.exit(0);
    } else {
      throw new Error(`Opción desconocida: ${arg}`);
    }
  }
  return opts;
}

// ─────────────────────── servidor estático ───────────────────────

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function servirEstatico(raiz) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const decodificado = decodeURIComponent(url.pathname);
      // Sin escapes de directorio: resolved siempre dentro de la raíz.
      const candidatos = [
        decodificado,
        `${decodificado}.html`,
        path.join(decodificado, 'index.html'),
        'index.html', // fallback tipo SPA (última palabra la tiene el router)
      ];

      for (const candidato of candidatos) {
        const relativo = candidato.replace(/^[/\\]+/, '');
        const absoluto = path.resolve(raiz, relativo);
        if (!absoluto.startsWith(path.resolve(raiz))) continue;
        try {
          const info = await stat(absoluto);
          if (!info.isFile()) continue;
          const cuerpo = await readFile(absoluto);
          res.writeHead(200, {
            'Content-Type':
              TIPOS[path.extname(absoluto).toLowerCase()] ?? 'application/octet-stream',
            'Content-Length': cuerpo.length,
            'Cache-Control': 'public, max-age=31536000, immutable',
          });
          res.end(cuerpo);
          return;
        } catch {
          // Probar el siguiente candidato.
        }
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`No encontrado: ${decodificado}`);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(String(error));
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ───────────────────────── navegador ─────────────────────────

function rutasNavegador() {
  const candidatos = [
    process.env.EDGE_PATH,
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  return candidatos.filter((c) => existsSync(c));
}

function lanzarNavegador(ejecutable, userDataDir) {
  const args = [
    '--headless',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-component-update',
    '--hide-scrollbars',
    '--mute-audio',
    '--window-size=1080,2400',
    '--force-device-scale-factor=1',
    'about:blank',
  ];

  const proceso = spawn(ejecutable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let buffer = '';

  const endpoint = new Promise((resolve, reject) => {
    const revisar = (trozo) => {
      buffer += trozo.toString();
      const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) resolve(match[1]);
    };
    proceso.stdout.on('data', revisar);
    proceso.stderr.on('data', revisar);
    proceso.on('exit', (code) =>
      reject(new Error(`El navegador terminó con código ${code} antes de exponer CDP`))
    );
    setTimeout(() => reject(new Error('Timeout esperando el endpoint CDP del navegador')), 30000);
  });

  return { proceso, endpoint };
}

// ───────────────────── cliente CDP mínimo ─────────────────────

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pendientes = new Map();
    this.oyentes = new Map();
    this.eventos = new Map();
    this.listos = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', () =>
        reject(new Error('Error de WebSocket con el navegador'))
      );
    });
    this.ws.addEventListener('message', (evento) => {
      const mensaje = JSON.parse(evento.data);
      if (mensaje.id && this.pendientes.has(mensaje.id)) {
        const { resolve, reject } = this.pendientes.get(mensaje.id);
        this.pendientes.delete(mensaje.id);
        if (mensaje.error) reject(new Error(`${mensaje.error.code}: ${mensaje.error.message}`));
        else resolve(mensaje.result);
      } else if (mensaje.method) {
        for (const oyente of this.oyentes.get(mensaje.method) ?? []) oyente(mensaje.params);
        const contador = this.eventos.get(mensaje.method) ?? [];
        contador.push(mensaje.params);
        this.eventos.set(mensaje.method, contador);
      }
    });
  }

  async connect() {
    await this.listos;
  }

  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve, reject) => {
      this.pendientes.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, cb) {
    const lista = this.oyentes.get(method) ?? [];
    lista.push(cb);
    this.oyentes.set(method, lista);
  }

  limpiarEventos() {
    this.eventos = new Map();
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // El navegador ya se fue.
    }
  }
}

async function abrirTarget(cdpPuerto, timeoutMs) {
  const limite = Date.now() + timeoutMs;
  let ultimoError = null;
  while (Date.now() < limite) {
    try {
      const respuesta = await fetch(`http://127.0.0.1:${cdpPuerto}/json/list`);
      const targets = await respuesta.json();
      const pagina = targets.find((t) => t.type === 'page');
      if (pagina?.webSocketDebuggerUrl) return pagina.webSocketDebuggerUrl;
    } catch (error) {
      ultimoError = error;
    }
    await sleep(200);
  }
  throw new Error(`No se pudo obtener un target de página: ${ultimoError}`);
}

// ───────────────────── observador de la pantalla ─────────────────────
//
// Se inyecta ANTES de cargar la página (Page.addScriptToEvaluateOnNewDocument),
// así que corre antes que el bundle de la app. Registra en `window.__arranque`
// el instante (performance.now() = ms desde el inicio de la navegación) en que
// la primera pantalla útil está en el DOM y es visible.

const SCRIPT_OBSERVADOR = `(() => {
  const TEXTOS = ['Crear cuenta', 'Iniciar sesión'];
  const estado = {
    listoEn: null,
    ruta: null,
    domContentLoaded: null,
    loadEventEnd: null,
    firstContentfulPaint: null,
    mutaciones: 0,
  };
  Object.defineProperty(window, '__arranque', { value: estado, configurable: true });

  const visible = (el) => {
    const caja = el.getBoundingClientRect();
    return caja.width > 0 && caja.height > 0;
  };

  const revisar = () => {
    if (estado.listoEn !== null) return;
    estado.mutaciones += 1;
    const nodos = document.querySelectorAll('div, span, p, button, a, [role="button"]');
    for (const texto of TEXTOS) {
      const encontrado = Array.from(nodos).some(
        (el) => (el.textContent || '').trim() === texto && visible(el)
      );
      if (!encontrado) return;
    }
    estado.listoEn = performance.now();
    estado.ruta = location.pathname + location.search;
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) {
      estado.domContentLoaded = nav.domContentLoadedEventEnd;
      estado.loadEventEnd = nav.loadEventEnd;
    }
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    estado.firstContentfulPaint = fcp ? fcp.startTime : null;
  };

  new MutationObserver(revisar).observe(document, { subtree: true, childList: true, characterData: true });
  document.addEventListener('DOMContentLoaded', revisar);
  window.addEventListener('load', revisar);
  setInterval(revisar, 25);
})();`;

// ───────────────────────── una corrida ─────────────────────────

async function medirArranque(cdp, url, timeoutMs) {
  cdp.limpiarEventos();
  await cdp.send('Page.navigate', { url: 'about:blank' });

  const idNavegacion = await cdp.send('Page.navigate', { url });
  const limite = Date.now() + timeoutMs;

  while (Date.now() < limite) {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: 'window.__arranque ? JSON.stringify(window.__arranque) : null',
      returnByValue: true,
    });
    if (result?.value) {
      const estado = JSON.parse(result.value);
      if (estado.listoEn !== null) {
        const peticiones = (cdp.eventos.get('Network.responseReceived') ?? []).filter(
          (r) => r.type !== 'Preflight'
        );
        const bytes = (cdp.eventos.get('Network.loadingFinished') ?? []).reduce(
          (total, evento) => total + (evento.encodedDataLength ?? 0),
          0
        );
        const errores = (cdp.eventos.get('Runtime.exceptionThrown') ?? []).map(
          (e) =>
            e.exceptionDetails?.exception?.description ??
            e.exceptionDetails?.text ??
            'excepción sin detalle'
        );
        const consola = (cdp.eventos.get('Runtime.consoleAPICalled') ?? [])
          .filter((e) => e.type === 'error' || e.type === 'warning')
          .map((e) => e.args?.map((a) => a.value ?? a.description ?? '').join(' '));

        return {
          ok: true,
          msHastaPantallaUtil: estado.listoEn,
          ruta: estado.ruta,
          msDomContentLoaded: estado.domContentLoaded,
          msLoadEventEnd: estado.loadEventEnd,
          msFirstContentfulPaint: estado.firstContentfulPaint,
          mutaciones: estado.mutaciones,
          peticiones: peticiones.length,
          bytesTransferidos: bytes,
          erroresJs: errores,
          avisosConsola: consola,
          loaderId: idNavegacion?.loaderId ?? null,
        };
      }
    }
    await sleep(10);
  }

  const consola = (cdp.eventos.get('Runtime.consoleAPICalled') ?? []).map((e) =>
    e.args?.map((a) => a.value ?? a.description ?? '').join(' ')
  );
  const errores = (cdp.eventos.get('Runtime.exceptionThrown') ?? []).map(
    (e) =>
      e.exceptionDetails?.exception?.description ??
      e.exceptionDetails?.text ??
      'excepción sin detalle'
  );
  return {
    ok: false,
    motivo: 'La primera pantalla útil no apareció dentro del timeout',
    erroresJs: errores,
    avisosConsola: consola,
  };
}

// ───────────────────────── utilidades ─────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function estadisticas(valores) {
  const orden = [...valores].sort((a, b) => a - b);
  const mediana =
    orden.length % 2 === 1
      ? orden[(orden.length - 1) / 2]
      : (orden[orden.length / 2 - 1] + orden[orden.length / 2]) / 2;
  const suma = orden.reduce((total, v) => total + v, 0);
  return {
    n: orden.length,
    mediana: Math.round(mediana),
    media: Math.round(suma / orden.length),
    minimo: Math.round(orden[0]),
    maximo: Math.round(orden[orden.length - 1]),
  };
}

async function tamanoDelBundle(dir) {
  const candidatos = [
    path.join(dir, '_expo', 'static', 'js', 'web'),
    path.join(dir, '_expo', 'static', 'js'),
  ];
  for (const candidato of candidatos) {
    if (!existsSync(candidato)) continue;
    const entradas = await readdir(candidato);
    const js = [];
    for (const entrada of entradas) {
      if (!entrada.endsWith('.js')) continue;
      const info = await stat(path.join(candidato, entrada));
      js.push({ archivo: entrada, bytes: info.size });
    }
    if (js.length > 0) {
      return {
        directorio: candidato,
        archivos: js,
        totalBytes: js.reduce((total, a) => total + a.bytes, 0),
      };
    }
  }
  return null;
}

// ───────────────────────── principal ─────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dir = path.resolve(process.cwd(), opts.dir);

  if (!existsSync(dir)) {
    throw new Error(`No existe el directorio ${dir}. Corre primero: npx expo export -p web`);
  }

  const navegadores = opts.browser ? [opts.browser] : rutasNavegador();
  if (navegadores.length === 0) {
    throw new Error('No se encontró Edge/Chrome. Pásalo con --browser <ruta>');
  }

  const { server, port } = await servirEstatico(dir);
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'startup-baseline-'));
  const ejecutable = navegadores[0];
  const { proceso, endpoint } = lanzarNavegador(ejecutable, userDataDir);

  const wsBrowser = await endpoint;

  const puertoCdp = new URL(wsBrowser).port;
  const wsPagina = await abrirTarget(puertoCdp, 20000);
  const cdp = new CDP(wsPagina);
  await cdp.connect();

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: SCRIPT_OBSERVADOR });

  const base = `http://127.0.0.1:${port}/`;
  const resultados = {};

  for (const modo of opts.modes) {
    const enFrio = modo === 'cold';
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: enFrio });
    if (!enFrio) {
      // Arranque de calentamiento: llena la caché HTTP para que las corridas
      // medidas representen "abrir la app con los assets ya en el dispositivo".
      await medirArranque(cdp, base, opts.timeout);
    }
    const corridas = [];
    for (let i = 0; i < opts.runs; i += 1) {
      const corrida = await medirArranque(cdp, base, opts.timeout);
      corridas.push(corrida);
      if (!opts.json) {
        const detalle = corrida.ok
          ? `${String(corrida.msHastaPantallaUtil).padStart(6)} ms`
          : `FALLO (${corrida.motivo})`;
        console.log(`  ${modo} #${String(i + 1).padStart(2)}: ${detalle}`);
      }
    }
    const exitosas = corridas.filter((c) => c.ok).map((c) => c.msHastaPantallaUtil);
    resultados[modo] = {
      corridas,
      resumen: exitosas.length > 0 ? estadisticas(exitosas) : null,
      fallos: corridas.length - exitosas.length,
    };
  }

  const bundle = await tamanoDelBundle(dir);
  const salida = {
    ticket: 'INT4-113',
    fecha: new Date().toISOString(),
    metodo:
      'Arranque en frío/caliente del build web (expo export -p web) servido en 127.0.0.1 y medido con DevTools Protocol',
    url: base,
    navegador: ejecutable,
    dir,
    repeticionesPorModo: opts.runs,
    modos: opts.modes,
    bundle,
    resultados,
  };

  cdp.close();
  if (!opts.keepOpen) {
    proceso.kill();
  }
  server.close();
  if (!opts.keepOpen) {
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }

  if (opts.out) {
    await writeFile(opts.out, `${JSON.stringify(salida, null, 2)}\n`, 'utf8');
  }

  if (opts.json) {
    console.log(JSON.stringify(salida, null, 2));
  } else {
    console.log('\nResumen (ms hasta la primera pantalla útil):');
    for (const [modo, datos] of Object.entries(resultados)) {
      if (!datos.resumen) {
        console.log(`  ${modo}: sin corridas exitosas (${datos.fallos} fallos)`);
        continue;
      }
      const r = datos.resumen;
      const rutas = [...new Set(datos.corridas.filter((c) => c.ok).map((c) => c.ruta))];
      console.log(
        `  ${modo}: mediana ${r.mediana} ms · media ${r.media} ms · min ${r.minimo} ms · max ${r.maximo} ms (n=${r.n}, fallos=${datos.fallos}, ruta final ${rutas.join(', ')})`
      );
    }
    if (bundle) {
      console.log(`  bundle JS: ${(bundle.totalBytes / 1024).toFixed(1)} KiB`);
    }
    if (opts.out) {
      console.log(`  crudo: ${path.resolve(process.cwd(), opts.out)}`);
    }
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});

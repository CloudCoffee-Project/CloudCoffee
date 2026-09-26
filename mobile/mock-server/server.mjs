// mock-server/server.mjs
//
// API de ejemplo para demos y QA mientras el backend no tenga los controllers.
//
//   npm run mock:api
//
// Responde por HTTP las rutas de /v1/catalog/** con los datos de ./datos.mjs y un
// login falso, para que se pueda llegar al catálogo. No reenvía nada al gateway
// real: es un servidor cerrado, y por lo que responde es exactamente lo que
// dice el README de esta carpeta.
//
// Cómo se usa: se apunta la app a este servidor con EXPO_PUBLIC_API_URL y se
// levanta Expo en otra terminal. Nada de src/ cambia — la app sigue hablando
// con httpClient y con el contrato real, solo que contra este host en vez del
// gateway. Los datos viven acá, no en un array de la pantalla.
//
// CUANDO EXISTA LA BASE DE DATOS: se borra la carpeta mock-server/, se saca el
// script "mock:api" del package.json y no queda nada que cambiar en la app.
//
// Config por variables de entorno:
//   PORT   puerto del mock (default 18099)

import http from 'node:http';

import { CATEGORIAS, CAMPUS, productosDelCampus } from './datos.mjs';

const PORT = Number(process.env.PORT ?? 18099);

// Rutas que este mock responde. Se listan en el 404 de todo lo demás para que
// quede claro qué falta, en vez de que la app muestre un error sin explicación.
const RUTAS = [
  'POST /v1/auth/login',
  'POST /v1/auth/refresh',
  'GET  /v1/auth/me',
  'GET  /v1/catalog/campus',
  'GET  /v1/catalog/categorias',
  'GET  /v1/catalog/productos',
  'GET  /v1/catalog/productos/{id}',
];

// --- Sesión falsa -----------------------------------------------------------
// El auth-service todavía no expone POST /v1/auth/login (solo /register y
// /verificacion), así que sin esto no hay forma de obtener sesión y por lo tanto
// de llegar a las pantallas de (cliente).
//
// El token no está firmado y no es una sesión real: el gateway no lo aceptaría.
// Alcanza porque decodeJwtPayload solo base64-decodea el payload y no valida la
// firma, y porque este mock no mira el Authorization. Los claims son los que lee
// decodificarSesion en services/auth.ts: { sub, userId, rol, cafeteriaId, exp }.

const USUARIO_MOCK = {
  id: 'cliente-demo',
  email: 'cliente@demo.cl',
  nombre: 'Estudiante',
  apellido: 'Demo',
  telefono: '+56 9 0000 0000',
  rol: 'cliente',
  verificado: true,
};

function b64url(objeto) {
  return Buffer.from(JSON.stringify(objeto)).toString('base64url');
}

function tokenFalso() {
  const header = b64url({ alg: 'none', typ: 'JWT' });
  const payload = b64url({
    sub: USUARIO_MOCK.id,
    userId: USUARIO_MOCK.id,
    rol: USUARIO_MOCK.rol,
    cafeteriaId: null,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
  });

  return `${header}.${payload}.mock`;
}

// --- Respuestas -------------------------------------------------------------

function responderJson(res, status, cuerpo) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(cuerpo));
}

// Los errores usan problem+json (RFC 9457), que es lo que espera
// toApiError en services/httpClient.ts para poder mostrar el detalle.
function responderProblema(res, status, titulo, detalle) {
  res.writeHead(status, {
    'Content-Type': 'application/problem+json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({ type: 'about:blank', title: titulo, status, detail: detalle }));
}

function leerCuerpo(req) {
  return new Promise((resolve) => {
    let crudo = '';
    req.on('data', (trozo) => {
      crudo += trozo;
    });
    req.on('end', () => {
      try {
        resolve(crudo ? JSON.parse(crudo) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// --- Rutas ------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  // La app web (expo start --web) y Metro hacen peticiones OPTIONS: sin esto el
  // navegador las corta antes de llegar a la ruta.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const ruta = url.pathname.replace(/\/+$/, '') || '/';
  console.log(`[mock] ${req.method} ${req.url}`);

  if (ruta === '/v1/auth/login' && req.method === 'POST') {
    const body = await leerCuerpo(req);
    // Cualquier correo sirve: el mock no valida contra ninguna base de datos.
    if (!String(body.email ?? '').trim() || !body.password) {
      return responderProblema(
        res,
        400,
        'Credenciales incompletas',
        'El login del mock espera { email, password } con ambos campos.'
      );
    }

    return responderJson(res, 200, {
      accessToken: tokenFalso(),
      refreshToken: `${tokenFalso()}.refresh`,
    });
  }

  if (ruta === '/v1/auth/refresh' && req.method === 'POST') {
    return responderJson(res, 200, {
      accessToken: tokenFalso(),
      refreshToken: `${tokenFalso()}.refresh`,
    });
  }

  if (ruta === '/v1/auth/me' && req.method === 'GET') {
    return responderJson(res, 200, USUARIO_MOCK);
  }

  if (ruta === '/v1/catalog/campus' && req.method === 'GET') {
    return responderJson(res, 200, CAMPUS);
  }

  if (ruta === '/v1/catalog/categorias' && req.method === 'GET') {
    return responderJson(res, 200, CATEGORIAS);
  }

  if (ruta === '/v1/catalog/productos' && req.method === 'GET') {
    // El catálogo es relativo a la sede: sin campusId no hay nada que listar.
    const campusId = url.searchParams.get('campusId');
    if (!campusId) {
      return responderProblema(
        res,
        400,
        'Falta campusId',
        'El catálogo es relativo al campus: campusId es obligatorio.'
      );
    }

    return responderJson(
      res,
      200,
      productosDelCampus(campusId, url.searchParams.get('categoriaId'))
    );
  }

  // Detalle de un producto: mismo shape que el listado, con las ofertas acotadas
  // al campus (ver datos.mjs).
  const detalle = ruta.match(/^\/v1\/catalog\/productos\/([^/]+)$/);
  if (detalle && req.method === 'GET') {
    const campusId = url.searchParams.get('campusId');
    if (!campusId) {
      return responderProblema(
        res,
        400,
        'Falta campusId',
        'El detalle es relativo al campus: campusId es obligatorio.'
      );
    }

    const id = decodeURIComponent(detalle[1]);
    const producto = productosDelCampus(campusId, null).find((p) => p.id === id);
    if (!producto) {
      return responderProblema(
        res,
        404,
        'Producto no encontrado',
        `No hay un producto con id ${id} en el campus ${campusId}. Revisa mock-server/datos.mjs.`
      );
    }

    return responderJson(res, 200, producto);
  }

  // Todo lo demás: 404 con la lista de lo que el mock sí responde. El objetivo
  // es que un 404 en la demo signifique "esto no está implementado todavía", que
  // es la verdad, y no "el mock se cayó".
  return responderProblema(
    res,
    404,
    'Ruta no implementada en el mock',
    `El mock de la app no responde ${req.method} ${ruta}. Responde: ${RUTAS.join(', ')}.`
  );
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[mock] catálogo de ejemplo en http://localhost:${PORT}`);
  console.log(`[mock] apunta la app con EXPO_PUBLIC_API_URL=http://localhost:${PORT}`);
  console.log('[mock] Ctrl+C para cortar');
});

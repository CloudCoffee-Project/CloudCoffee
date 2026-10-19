// src/utils/sesionCajero.ts
//
// Comportamiento de la sesión del cajero SIN cafetería asignada (INT4-96).
//
// El backend emite el claim `cafeteriaId` solo al personal (CAJERO /
// ADMIN_CAFETERIA) que tiene una fila en `asignaciones_cafeteria`
// (INT2-65: `JwtTokenService` + `CafeteriaAccess.CLAIM`). Un cajero sin
// asignación —la cuenta de desarrollo `cajero.sinasignar@cloudcoffee.dev`,
// cuya fila el seed borra a propósito— recibe un JWT válido pero sin
// `cafeteriaId`. Sin ese id el cajero no puede operar: no hay cafetería a la
// que pedir pedidos ni stock.
//
// En vez de dejar cada pantalla del cajero con un listado vacío o un error
// crudo de la API, la app detecta ese caso con esta función pura y muestra una
// pantalla clara con acciones posibles (cerrar sesión / avisar al
// administrador). La decisión vive acá, separada de la pantalla, para poder
// testearla sin montar la navegación.

import type { SesionDecodificada } from '../types/domain';

/**
 * Indica si la sesión es de un cajero que NO tiene cafetería asignada.
 *
 * Solo aplica al rol `cajero`: es el único rol operativo que depende de
 * `cafeteriaId`. Un cliente nunca trae el claim (usa la cafetería del campus
 * seleccionado, ver `useCafeteriaActual`) y los roles administrativos no
 * operan el POS, así que en esos casos el estado bloqueado no corresponde.
 */
export function cajeroSinCafeteria(sesion: SesionDecodificada | null | undefined): boolean {
  return sesion?.rol === 'cajero' && !sesion.cafeteriaId;
}

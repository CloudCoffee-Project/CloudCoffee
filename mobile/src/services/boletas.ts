// src/services/boletas.ts
//
// Boleta simplificada en PDF de una orden (INT4-48): el cliente descarga la
// boleta de una orden pagada desde el detalle de la orden. Según el doc del
// equipo se emite una boleta por orden (cada cafetería es un comercio distinto),
// con folio correlativo interno, detalle de ítems, montos y fecha.
//
// Contrato (doc del equipo, app móvil, JWT de cliente):
//   - GET /orders/{id}/boleta → descarga el PDF de la boleta simplificada de
//     una orden pagada.
//
// En mobile la ruta vive bajo el prefijo de órdenes del gateway:
//   - GET /v1/orders/{id}/boleta  (responseType arraybuffer → PDF binario)
//
// El gateway todavía no rutea /orders (mismo TODO que ordenes.ts): consumimos
// el contrato real y, si el gateway responde con problem+json, la pantalla
// muestra el error normalizado (ApiError).
//
// Flujo en tres pasos para mantener cada capa testeable:
//   1. descargarBoleta()         → trae los bytes del PDF (httpClient inyecta
//                                  el JWT del cliente via interceptor).
//   2. guardarBoletaPdf()        → escribe el archivo en el dispositivo con
//                                  expo-file-system (API nueva de SDK 57:
//                                  File/Paths, reemplaza a writeAsStringAsync).
//   3. compartirBoleta()         → abre el share sheet con expo-sharing para
//                                  guardar o abrir el PDF en otra app.

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { AxiosError } from 'axios';

import { ApiError, httpClient, toApiError } from './httpClient';
import type { ApiProblem } from './httpClient';
import { ORDENES_ENDPOINT } from './ordenes';

const BOLETA_MIME = 'application/pdf';

/** Trae los bytes del PDF de la boleta de una orden pagada. */
export async function descargarBoleta(ordenId: string): Promise<Uint8Array> {
  try {
    const response = await httpClient.get<ArrayBuffer>(`${ORDENES_ENDPOINT}/${ordenId}/boleta`, {
      responseType: 'arraybuffer',
    });

    return new Uint8Array(response.data);
  } catch (error) {
    throw normalizarErrorDescarga(error as AxiosError<ApiProblem>);
  }
}

// Con responseType arraybuffer el problem+json de un error también llega como
// bytes; decodificarlo aquí evita mostrar el mensaje genérico de axios y
// conserva el detail del RFC 9457 como en el resto de los servicios.
function normalizarErrorDescarga(error: AxiosError<ApiProblem>): ApiError {
  const datos = error.response?.data;
  if (datos instanceof ArrayBuffer) {
    const texto = new TextDecoder().decode(new Uint8Array(datos));
    try {
      const problem = JSON.parse(texto) as ApiProblem;
      return new ApiError(problem.detail ?? error.message, error.response?.status ?? 0, problem);
    } catch {
      return new ApiError(texto || error.message, error.response?.status ?? 0);
    }
  }

  return toApiError(error);
}

/**
 * Guarda los bytes del PDF en el almacenamiento del dispositivo y devuelve la
 * uri del archivo creado (boleta-<ordenId>.pdf). Si ya existe una boleta para
 * la misma orden, la reemplaza para no acumular copias.
 */
export function guardarBoletaPdf(ordenId: string, bytes: Uint8Array): string {
  const archivo = new File(Paths.document, `boleta-${ordenId}.pdf`);
  if (archivo.exists) {
    archivo.delete();
  }
  archivo.create();
  archivo.write(bytes);
  return archivo.uri;
}

/**
 * Abre el share sheet del sistema para guardar/abrir el PDF. Devuelve false si
 * el dispositivo no soporta compartir archivos (p. ej. web), para que la
 * pantalla avise que el archivo quedó guardado en la app de todos modos.
 */
export async function compartirBoleta(uri: string): Promise<boolean> {
  const disponible = await Sharing.isAvailableAsync();
  if (!disponible) {
    return false;
  }

  await Sharing.shareAsync(uri, {
    mimeType: BOLETA_MIME,
    dialogTitle: 'Boleta de tu orden',
    UTI: 'com.adobe.pdf',
  });
  return true;
}

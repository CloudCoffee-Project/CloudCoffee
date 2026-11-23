// src/components/ErrorBackend.tsx
//
// INT4-132 — tarjeta única para fallos del backend en el recorrido del cliente.
//
// Antes cada pantalla dibujaba su propio estado de error (o no ofrecía salida):
// resultado-pago mostraba el detail crudo y qr-retiro se quedaba sin reintento.
// Acá el título, el mensaje normalizado y la acción viajan juntos, así que una
// falla de red, un 500 o un problem+json se leen igual en todo el flujo.
//
// El mensaje NO se arma acá: `mensajeErrorBackend` delega en `toApiError`, que
// es el único normalizador del contrato problem+json. Si el backend cambia el
// formato de error, se ajusta una sola vez.

import { EstadoLista } from './EstadoLista';

import { mensajeErrorBackend } from '../services/httpClient';

export const TITULO_ERROR_BACKEND = 'No pudimos cargar esta información';
export const ETIQUETA_REINTENTO_BACKEND = 'Reintentar';

type ErrorBackendProps = {
  /** Error lanzado por el servicio; puede ser AxiosError, ApiError o desconocido. */
  error?: unknown;
  /** Texto alternativo para estados sin backend (por ejemplo, falta un id). */
  mensaje?: string;
  /** Vuelve a ejecutar la consulta que falló. */
  onReintentar: () => void;
  /** Identifica la tarjeta en la pantalla. */
  testID: string;
  /** TestIDs estables que ya expone la pantalla (si los tenía). */
  tituloTestID?: string;
  mensajeTestID?: string;
  reintentarTestID?: string;
};

export function ErrorBackend({
  error,
  mensaje,
  onReintentar,
  testID,
  tituloTestID,
  mensajeTestID,
  reintentarTestID,
}: ErrorBackendProps) {
  return (
    <EstadoLista
      variante="error"
      icono="⚠️"
      titulo={TITULO_ERROR_BACKEND}
      mensaje={mensaje ?? mensajeErrorBackend(error)}
      accion={{
        etiqueta: ETIQUETA_REINTENTO_BACKEND,
        onPress: onReintentar,
        testID: reintentarTestID ?? `${testID}-reintentar`,
      }}
      testID={testID}
      tituloTestID={tituloTestID}
      mensajeTestID={mensajeTestID}
    />
  );
}

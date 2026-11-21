// src/components/ErrorBackend.test.tsx
// INT4-132: la tarjeta compartida debe dar la misma jerarquía visual (ícono,
// título, detail normalizado y reintento) sin importar la pantalla que la use.
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';

import { ETIQUETA_REINTENTO_BACKEND, ErrorBackend, TITULO_ERROR_BACKEND } from './ErrorBackend';
import { ApiError, MENSAJE_ERROR_BACKEND } from '../services/httpClient';
import { pulsar, texto } from '../test-utils';

describe('ErrorBackend (INT4-132)', () => {
  it('muestra el detalle normalizado y ejecuta el reintento', async () => {
    const onReintentar = jest.fn();
    let tree!: ReactTestRenderer;

    await act(async () => {
      tree = create(
        <ErrorBackend
          error={new ApiError('Order no responde.', 503)}
          onReintentar={onReintentar}
          testID="error-backend"
          tituloTestID="error-backend-titulo"
          mensajeTestID="error-backend-mensaje"
          reintentarTestID="error-backend-reintentar"
        />
      );
    });

    expect(texto(tree, 'error-backend-titulo')).toBe(TITULO_ERROR_BACKEND);
    expect(texto(tree, 'error-backend-mensaje')).toBe('Order no responde.');
    expect(texto(tree, 'error-backend-reintentar')).toBe(ETIQUETA_REINTENTO_BACKEND);

    await pulsar(tree, 'error-backend-reintentar');
    expect(onReintentar).toHaveBeenCalledTimes(1);
  });

  it('usa el mensaje de respaldo si el error no trae detalle', async () => {
    let tree!: ReactTestRenderer;

    await act(async () => {
      tree = create(
        <ErrorBackend
          error={new ApiError('', 500)}
          testID="error-backend"
          onReintentar={jest.fn()}
        />
      );
    });

    expect(texto(tree, 'error-backend')).toContain(MENSAJE_ERROR_BACKEND);
  });
});

// src/test-utils/render.tsx
//
// Montaje de componentes con react-test-renderer. `renderizar` envuelve el
// `create` en `act` para que los efectos de montaje (incluidas las promesas ya
// resueltas) se apliquen antes de devolver el árbol; `renderizarAsentado` da un
// segundo turno al event loop para las pantallas que cargan datos al montar.
import { act, create } from 'react-test-renderer';
import type { ReactElement } from 'react';
import type { ReactTestRenderer } from 'react-test-renderer';

/** Monta `elemento` dentro de `act` y devuelve el árbol renderizado. */
export async function renderizar(elemento: ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(elemento);
  });

  return tree;
}

/**
 * Igual que `renderizar`, pero deja correr un turno extra de microtareas. Es lo
 * que necesitan las pantallas que disparan una carga al montar y actualizan su
 * estado al resolverla.
 */
export async function renderizarAsentado(elemento: ReactElement): Promise<ReactTestRenderer> {
  const tree = await renderizar(elemento);
  await act(async () => {});

  return tree;
}

/** Desmonta el árbol dentro de `act` (libera suscripciones y timers). */
export function desmontar(tree: ReactTestRenderer): void {
  act(() => tree.unmount());
}

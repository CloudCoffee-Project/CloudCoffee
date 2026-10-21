// src/test-utils/texto.ts
//
// Lectura del texto que renderiza un árbol de react-test-renderer. Antes cada
// suite reimplementaba `textoDe`; ahora vive acá para que todas lean el árbol
// igual (recursivo, uniendo strings y bajando por los nodos).
import type { ElementType } from 'react';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

/** Texto completo que renderiza un nodo, incluyendo el de sus descendientes. */
export function textoDe(nodo: ReactTestInstance): string {
  return nodo.children
    .map((hijo) => {
      if (typeof hijo === 'string' || typeof hijo === 'number') {
        return String(hijo);
      }
      return textoDe(hijo as ReactTestInstance);
    })
    .join('');
}

/** Texto del nodo que tiene el `testID` dado, o error si no existe. */
export function texto(tree: ReactTestRenderer, testID: string): string {
  return textoDe(tree.root.findByProps({ testID }));
}

/**
 * Texto de todos los nodos del tipo indicado, unidos por `separador`. Sirve
 * para componentes sin `testID` (por ejemplo, un banner) donde interesa el
 * conjunto de etiquetas que renderiza.
 */
export function textosDeTipo(tree: ReactTestRenderer, tipo: ElementType, separador = '|'): string {
  return tree.root
    .findAllByType(tipo)
    .map((nodo) => textoDe(nodo))
    .join(separador);
}

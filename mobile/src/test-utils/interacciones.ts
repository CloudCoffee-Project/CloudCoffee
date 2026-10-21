// src/test-utils/interacciones.ts
//
// Gestos y escritura sobre el árbol de react-test-renderer. Son las acciones
// que las suites repetían con pequeñas variantes (buscar por testID, buscar por
// texto, escribir en un campo); acá quedan en una sola versión, siempre dentro
// de `act` para que la actualización de estado se aplique de inmediato.
import { act } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { TextInput } from 'react-native';

import { textoDe } from './texto';

/** Primer nodo con ese `testID`. */
export function buscar(tree: ReactTestRenderer, testID: string): ReactTestInstance {
  return tree.root.findByProps({ testID });
}

/** Dispara el `onPress` del nodo con ese `testID`, esperando su resultado. */
export async function pulsar(tree: ReactTestRenderer, testID: string): Promise<void> {
  await act(async () => {
    await buscar(tree, testID).props.onPress();
  });
}

/** Escribe `valor` en el campo con ese `testID` (vía `onChangeText`). */
export async function escribir(
  tree: ReactTestRenderer,
  testID: string,
  valor: string
): Promise<void> {
  await act(async () => {
    buscar(tree, testID).props.onChangeText(valor);
  });
}

/**
 * Escribe en el n-ésimo `TextInput` del árbol. Para las pantallas de auth, que
 * no les ponen `testID` a sus campos y solo se pueden ubicar por orden.
 */
export async function escribirPorIndice(
  tree: ReactTestRenderer,
  indice: number,
  valor: string
): Promise<void> {
  const campos = tree.root.findAllByType(TextInput);
  await act(async () => {
    campos[indice].props.onChangeText(valor);
  });
}

/**
 * Busca el nodo más profundo que renderiza exactamente `texto` y sube por sus
 * padres hasta el primero con `onPress`. Es para botones sin `testID`. En
 * RN 0.86 `Pressable` es un memo, así que comparar por tipo no sirve y el
 * recorrido por los padres sí.
 */
export async function pulsarPorTexto(tree: ReactTestRenderer, texto: string): Promise<void> {
  const candidatos = tree.root.findAll((nodo) => textoDe(nodo).trim() === texto);
  let nodo: ReactTestInstance | null = candidatos[candidatos.length - 1] ?? null;

  while (nodo && typeof nodo.props?.onPress !== 'function') {
    nodo = nodo.parent;
  }

  if (!nodo) {
    throw new Error(`No se encontró un botón con el texto "${texto}"`);
  }

  await act(async () => {
    await nodo!.props.onPress();
  });
}

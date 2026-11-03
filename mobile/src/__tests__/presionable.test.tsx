// src/__tests__/presionable.test.tsx
//
// INT4-111 — Feedback uniforme al pulsar acciones.
//
// `Presionable` es el único punto donde vive la respuesta visual al toque.
// Estos tests vigilan que todos los controles reciban la misma opacidad y
// escala (definidas en theme/tokens.ts) sin perder el resto de las props de
// `Pressable` (estilo propio, `disabled`, accesibilidad y `testID`).

import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { Presionable, combinarEstilo, estiloPresionado } from '../components/Presionable';
import { tokens } from '../theme/tokens';

const estadoPresionado = { pressed: true, hovered: false };
const estadoLibre = { pressed: false, hovered: false };

test('el feedback usa los tokens compartidos de la app', () => {
  expect(estiloPresionado.opacity).toBe(tokens.estados.presionado);
  expect(estiloPresionado.transform).toEqual([{ scale: tokens.estados.escalaPresionado }]);
});

test('mientras se mantiene presionado aplica opacidad y escala', () => {
  expect(combinarEstilo({ backgroundColor: '#FFFFFF' }, estadoPresionado)).toEqual([
    { backgroundColor: '#FFFFFF' },
    estiloPresionado,
  ]);
});

test('al soltar vuelve al estilo propio del control', () => {
  expect(combinarEstilo({ backgroundColor: '#FFFFFF' }, estadoLibre)).toEqual([
    { backgroundColor: '#FFFFFF' },
    null,
  ]);
});

test('respeta el estilo dinámico que ya usa la pantalla', () => {
  const style = ({ pressed }: { pressed: boolean; hovered: boolean }) => ({
    backgroundColor: pressed ? '#000000' : '#FFFFFF',
  });

  expect(combinarEstilo(style, estadoPresionado)).toEqual([
    { backgroundColor: '#000000' },
    estiloPresionado,
  ]);
  expect(combinarEstilo(style, estadoLibre)).toEqual([{ backgroundColor: '#FFFFFF' }, null]);
});

test('no agrega feedback a un control deshabilitado', () => {
  expect(combinarEstilo({ backgroundColor: '#FFFFFF' }, estadoPresionado, true)).toEqual([
    { backgroundColor: '#FFFFFF' },
    null,
  ]);
});

test('conserva onPress, testID, hitSlop y accesibilidad', () => {
  const onPress = jest.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <Presionable
        onPress={onPress}
        testID="control"
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Confirmar"
      >
        <Text>Acción</Text>
      </Presionable>
    );
  });

  const nodos = tree.root.findAllByProps({ testID: 'control' });
  const nodo = nodos.find((instancia) => instancia.props.hitSlop === 8);
  expect(nodo).toBeDefined();
  expect(nodo?.props.accessibilityRole).toBe('button');
  expect(nodo?.props.accessibilityLabel).toBe('Confirmar');

  act(() => nodo?.props.onPress());
  expect(onPress).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});

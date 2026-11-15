// src/components/Presionable.tsx
//
// INT4-111 — Feedback uniforme al pulsar acciones.
//
// Todos los botones, enlaces, chips y tarjetas pulsables de la app deben usar
// este componente en lugar de `Pressable` o `TouchableOpacity` directos. Al
// mantener presionado aplica la misma opacidad y la misma escala, definidas en
// theme/tokens.ts, sin importar la pantalla ni el rol del usuario. Así el toque
// se siente igual en la portada, el login, el catálogo, el carrito, el checkout
// y la bandeja del cajero.
//
// El feedback se suma al estilo propio de cada control: el color, el borde y el
// tamaño siguen viviendo en la pantalla; acá solo se centraliza la respuesta al
// toque. `style` acepta tanto un estilo estático como la función de Pressable.

import {
  Pressable,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { tokens } from '../theme/tokens';

/**
 * Estilo único de feedback mientras un control está presionado. Vive acá y no
 * en cada pantalla para que un cambio de intensidad se aplique a toda la app.
 */
export const estiloPresionado = {
  opacity: tokens.estados.presionado,
  transform: [{ scale: tokens.estados.escalaPresionado }],
} as const;

/** Estilo que acepta `Pressable`: objeto, arreglo o función del estado. */
export type EstiloPresionable = PressableProps['style'];

/**
 * Combina el estilo propio del control con el feedback compartido. Es una
 * función pura para que la regla (opacidad + escala, nunca en `disabled`) se
 * pueda probar sin montar la interfaz.
 */
export function combinarEstilo(
  style: EstiloPresionable,
  estado: PressableStateCallbackType,
  deshabilitado = false
): StyleProp<ViewStyle> {
  const propio: StyleProp<ViewStyle> = typeof style === 'function' ? style(estado) : style;
  return [propio, estado.pressed && !deshabilitado ? estiloPresionado : null];
}

/** Props de `Presionable`: las mismas que acepta `Pressable`. */
export type PresionableProps = PressableProps;

/**
 * Envuelve `Pressable` y agrega el feedback compartido de la app. No altera el
 * resto del comportamiento (accesibilidad, `disabled`, `hitSlop`, eventos ni
 * `testID`), por lo que las pantallas y sus pruebas siguen funcionando igual.
 */
export function Presionable({ style, ...props }: PresionableProps) {
  return (
    <Pressable
      {...props}
      style={(estado) => combinarEstilo(style, estado, props.disabled ?? false)}
    />
  );
}

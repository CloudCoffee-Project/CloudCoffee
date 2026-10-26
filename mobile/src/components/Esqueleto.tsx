// src/components/Esqueleto.tsx
//
// INT4-108 — estados de carga del catálogo.
//
// `Esqueleto` dibuja un bloque con la forma del contenido que está por llegar y
// `EsqueletoPulso` envuelve una composición de bloques y la hace latir. Cada
// pantalla arma su propia silueta (tarjetas de campus, chips + tarjetas de
// producto, detalle + cafeterías) para que el esqueleto se parezca a la lista
// real en vez de ser un spinner suelto: cuando llegan los datos, el contenido
// ocupa el mismo lugar.
//
// Los colores, radios y la opacidad del pulso salen de theme/tokens.ts. En web
// la animación corre por JS (useNativeDriver no está soportado); en nativo solo
// cambia la opacidad, así que corre en el hilo de UI.

import { useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { tokens } from '../theme/tokens';

/** Duración de cada mitad del pulso. Es movimiento, no diseño: vive acá. */
const PULSO_MS = 700;

type EsqueletoProps = {
  /** Ancho del bloque. Por defecto ocupa todo el contenedor. */
  ancho?: DimensionValue;
  /** Alto del bloque, en px. */
  alto: number;
  /** Radio de las esquinas. Por defecto, el chico del sistema. */
  radio?: number;
  /** Variante de mayor énfasis para íconos y cifras. */
  fuerte?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Bloque gris que ocupa el lugar de un texto, un ícono o una tarjeta. */
export function Esqueleto({ ancho = '100%', alto, radio, fuerte = false, style }: EsqueletoProps) {
  return (
    <View
      style={[
        {
          width: ancho,
          height: alto,
          borderRadius: radio ?? tokens.radios.sm,
          backgroundColor: fuerte ? tokens.colores.esqueletoFuerte : tokens.colores.esqueleto,
        },
        style,
      ]}
    />
  );
}

type EsqueletoPulsoProps = {
  children: ReactNode;
  /** Identifica la lista cuyo estado de carga representa esta silueta. */
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Envuelve los bloques de una lista y los hace latir juntos. Se oculta a los
 * lectores de pantalla: es decorativo y no debe leerse como contenido.
 */
export function EsqueletoPulso({ children, testID, style }: EsqueletoPulsoProps) {
  const [opacidad] = useState(() => new Animated.Value(1));

  useEffect(() => {
    let montado = true;
    const animacion = Animated.loop(
      Animated.sequence([
        Animated.timing(opacidad, {
          toValue: tokens.estados.esqueleto,
          duration: PULSO_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(opacidad, {
          toValue: 1,
          duration: PULSO_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ])
    );

    // Con "reducir movimiento" activo el esqueleto queda quieto: el pulso es
    // decorativo. Si la consulta no existe o falla en alguna plataforma, se
    // anima igual (es la única señal de que hay contenido en camino).
    void Promise.resolve(AccessibilityInfo.isReduceMotionEnabled?.())
      .then((reducir) => {
        if (montado && !reducir) animacion.start();
      })
      .catch(() => {
        if (montado) animacion.start();
      });

    return () => {
      montado = false;
      animacion.stop();
    };
  }, [opacidad]);

  return (
    <Animated.View
      style={[{ opacity: opacidad }, style]}
      testID={testID}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      {children}
    </Animated.View>
  );
}

// src/components/EstadoLista.tsx
//
// INT4-110 — estados vacíos y de error de las listas del cliente.
//
// `EstadoLista` es la tarjeta única que usan el catálogo, Mis Compras y la
// bandeja de notificaciones cuando una lista no tiene datos o no pudo cargarse.
// Antes cada pantalla dibujaba su propia tarjeta (y algunas no ofrecían salida),
// así que una lista vacía podía quedar como un callejón sin acción. Acá el
// mensaje y la acción viajan juntos y comparten la misma jerarquía visual:
// ícono, título, explicación y un botón primario.
//
// La variante `vacio` usa el borde cálido punteado de las tarjetas vacías; la
// variante `error` cambia el borde y el fondo del ícono al rojo de error. El
// resto (tipografía, radios, espaciado y botón) es idéntico para que las tres
// listas se lean como parte del mismo sistema.
//
// Todos los valores de diseño salen de theme/tokens.ts.

import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { tokens } from '../theme/tokens';

/** Acción que acompaña al estado. Siempre hay una: ninguna lista queda sin salida. */
export type AccionEstadoLista = {
  /** Texto del botón. */
  etiqueta: string;
  /** Qué hace el botón (reintentar, limpiar un filtro, ir al catálogo…). */
  onPress: () => void;
  /** Identificador estable para las pruebas. */
  testID: string;
};

type EstadoListaProps = {
  /** `vacio` cuando no hay datos; `error` cuando la carga falló. */
  variante?: 'vacio' | 'error';
  /** Emoji que representa el estado. */
  icono: string;
  titulo: string;
  mensaje: string;
  accion: AccionEstadoLista;
  /** Identifica la lista cuyo estado representa esta tarjeta. */
  testID: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Tarjeta de estado para una lista sin contenido. Se anuncia como contenido
 * normal (el título y el mensaje sí se leen), pero el emoji queda fuera del
 * árbol de accesibilidad porque es decorativo.
 */
export function EstadoLista({
  variante = 'vacio',
  icono,
  titulo,
  mensaje,
  accion,
  testID,
  style,
}: EstadoListaProps) {
  const esError = variante === 'error';

  return (
    <View
      style={[styles.tarjeta, esError ? styles.tarjetaError : styles.tarjetaVacia, style]}
      testID={testID}
    >
      <View
        style={[styles.icono, esError ? styles.iconoError : styles.iconoVacio]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      >
        <Text style={styles.iconoTexto}>{icono}</Text>
      </View>

      <Text style={[styles.titulo, esError ? styles.tituloError : null]} accessibilityRole="header">
        {titulo}
      </Text>
      <Text style={styles.mensaje}>{mensaje}</Text>

      <Pressable
        style={({ pressed }) => [styles.boton, pressed && styles.botonPresionado]}
        onPress={accion.onPress}
        testID={accion.testID}
        accessibilityRole="button"
        accessibilityLabel={accion.etiqueta}
      >
        <Text style={styles.botonTexto}>{accion.etiqueta}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  tarjeta: {
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.medio,
    borderRadius: tokens.radios.xxl,
    paddingVertical: tokens.espaciado['5xl'],
    paddingHorizontal: tokens.espaciado['3xl'],
    alignItems: 'center',
    gap: tokens.espaciado.md,
  },
  tarjetaVacia: {
    borderStyle: 'dashed',
    borderColor: tokens.colores.bordeCalido,
  },
  tarjetaError: {
    borderColor: tokens.colores.errorBorde,
  },
  icono: {
    width: tokens.tamanos.iconoTarjeta,
    height: tokens.tamanos.iconoTarjeta,
    borderRadius: tokens.radios.pildora,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: tokens.espaciado.xs,
  },
  iconoVacio: {
    backgroundColor: tokens.colores.amarilloFondo,
  },
  iconoError: {
    backgroundColor: tokens.colores.errorFondo,
  },
  iconoTexto: {
    fontSize: tokens.tipografia.tamano.iconoMedio,
    lineHeight: tokens.tamanos.iconoTarjeta,
  },
  titulo: {
    fontSize: tokens.tipografia.tamano.boton,
    fontWeight: tokens.tipografia.peso.extranegrita,
    color: tokens.colores.tintaCliente,
    textAlign: 'center',
  },
  tituloError: {
    color: tokens.colores.errorTexto,
  },
  mensaje: {
    fontSize: tokens.tipografia.tamano.cuerpo,
    lineHeight: tokens.tipografia.interlineado.holgado,
    color: tokens.colores.textoNeutro,
    textAlign: 'center',
  },
  boton: {
    marginTop: tokens.espaciado.md,
    backgroundColor: tokens.colores.azul,
    borderRadius: tokens.radios.lg,
    paddingVertical: tokens.espaciado.xl,
    paddingHorizontal: tokens.espaciado['3xl'],
    alignItems: 'center',
  },
  botonPresionado: {
    opacity: tokens.estados.presionado,
  },
  botonTexto: {
    color: tokens.colores.superficie,
    fontSize: tokens.tipografia.tamano.cuerpoMedio,
    fontWeight: tokens.tipografia.peso.negrita,
  },
});

// src/theme/tokens.ts
//
// INT4-104 — Sistema de tokens de diseño.
//
// ÚNICA fuente de verdad de la identidad visual de CloudCoffee móvil. Define,
// en un solo archivo, los colores, la tipografía, los espaciados, los radios
// y las sombras de la app. Toda pantalla —las nuevas y las migradas— lee los
// valores de diseño de acá en lugar de escribirlos a mano en los StyleSheet.
//
// Los valores se extrajeron de la identidad real del proyecto: el mockup
// (cloudcoffee-react) y las pantallas ya construidas. Conviven dos familias
// bajo el mismo sistema:
//   - Acceso (portada, login, registro, verificación…): fondo crema, marca
//     turquesa y botones en marrón tinta.
//   - Cliente/POS: fondo suave, azul #0052CC como color de acción y acentos
//     amarillos sobre bordes cálidos (la "paleta oscura" del mockup web).
//
// Uso:
//   import { tokens } from '../../theme/tokens';
//
//   const styles = StyleSheet.create({
//     fondo: { backgroundColor: tokens.colores.fondoAuth },
//     tarjeta: { borderRadius: tokens.radios.lg, ...tokens.sombras.sutil },
//   });
//
// Reglas del sistema:
//   1. Antes de escribir un color o medida a mano, buscarlo acá; si no existe,
//      agregarlo con su comentario antes de usarlo en una pantalla.
//   2. Un cambio de valor en un token es GLOBAL: revisar sus usos antes de
//      modificarlo.
//   3. No todo número es token: tamaños de imágenes, anchos de layout y
//      medidas puntuales de una sola pantalla (p. ej. un alto de ilustración)
//      se quedan donde están.
//   4. Las migraciones de pantallas (tareas 3 y 4 del sprint 2) van reemplazando
//      los valores a mano por tokens y revisando el resultado en dispositivo.

// ---------------------------------------------------------------------------
// Colores
// ---------------------------------------------------------------------------

/** Paleta de la identidad visual. Cada token documenta dónde se usa. */
export const colores = {
  // --- Marca y navegación ---
  /** Turquesa del logotipo y títulos de las pantallas de acceso. */
  marca: '#0284C7',
  /** Azul principal: acciones, enlaces, badges e íconos del rol cliente. */
  azul: '#0052CC',
  /** Azul de texto fuerte sobre fondos azules claros. */
  azulFuerte: '#1E40AF',
  /** Azul marino de estados y textos de seguimiento. */
  marino: '#0B2545',

  // --- Superficies ---
  /** Fondo crema de las pantallas de acceso. */
  fondoAuth: '#F5EFE6',
  /** Fondo suave de las pantallas del cliente y del POS. */
  fondo: '#FAF7F2',
  /** Superficie blanca de tarjetas, inputs y hojas. */
  superficie: '#FFFFFF',
  /** Crema: botones secundarios y textos sobre la tinta. */
  crema: '#FAF6F0',
  /** Crema presionado: estado activo del botón secundario. */
  cremaPresionada: '#EDE5D8',

  // --- Textos ---
  /** Marrón oscuro: textos fuertes y botones primarios de acceso. */
  tinta: '#2D1B14',
  /** Marrón presionado: estado activo del botón primario. */
  tintaPresionada: '#1E120D',
  /** Casi negro: textos principales del rol cliente. */
  tintaCliente: '#1D2433',
  /** Gris cálido: textos de apoyo de las pantallas de acceso. */
  textoSecundario: '#7A7067',
  /** Gris neutro: textos secundarios y placeholders del cliente. */
  textoNeutro: '#6B7280',
  /** Gris medio: metadatos y textos terciarios del cliente. */
  textoGris: '#4B5563',
  /** Gris claro: textos terciarios y deshabilitados. */
  textoClaro: '#9CA3AF',
  /** Gris del placeholder de los inputs. */
  placeholder: '#A89F95',
  /** Texto oscuro sobre superficies crema (botón secundario). */
  tintaSuave: '#26211D',

  // --- Bordes ---
  /** Borde cálido de tarjetas y separadores del cliente/POS. */
  bordeCalido: '#EFE9DE',
  /** Borde de inputs y botones de las pantallas de acceso. */
  bordeAuth: '#E5DDD3',

  // --- Acentos amarillos (identidad cliente, del mockup web) ---
  /** Fondo amarillo claro de avisos y chips destacados. */
  amarilloFondo: '#FFF8DF',
  /** Fondo amarillo más intenso de avisos alternativos. */
  amarilloSuave: '#FEF3C7',
  /** Borde de los avisos amarillos. */
  amarilloBorde: '#F3DC87',
  /** Texto ámbar sobre fondos amarillos. */
  amarilloTexto: '#B28300',
  /** Texto ámbar oscuro: variante de mayor contraste. */
  amarilloTextoOscuro: '#92400E',

  // --- Estados: error ---
  /** Fondo de cajas de error. */
  errorFondo: '#FEE2E2',
  /** Borde de cajas de error. */
  errorBorde: '#FCA5A5',
  /** Texto de mensajes de error. */
  errorTexto: '#991B1B',

  // --- Estados: éxito ---
  /** Fondo de cajas de éxito. */
  exitoFondo: '#DCFCE7',
  /** Borde de cajas de éxito. */
  exitoBorde: '#86EFAC',
  /** Texto de mensajes de éxito. */
  exitoTexto: '#166534',

  // --- Estados: información ---
  /** Fondo de badges e informativos (variante clara). */
  infoFondo: '#E0EDFF',
  /** Fondo de avisos informativos (variante más suave). */
  infoSuave: '#EFF6FF',
  /** Fondo de chips informativos azules. */
  infoChip: '#DBEAFE',
} as const;

// ---------------------------------------------------------------------------
// Tipografía
// ---------------------------------------------------------------------------

/**
 * Sistema tipográfico. La app NO carga familias propias: usa la tipografía
 * del sistema de cada plataforma (la de Expo/RN por defecto), por eso no hay
 * token de familia. Si algún día se carga una con expo-font, su nombre se
 * agrega acá antes de usarla en pantallas.
 */
export const tipografia = {
  /** Pasos de tamaño de texto (px), del más chico al más grande. */
  tamano: {
    /** 10 — notas al pie y textos diminutos. */
    pie: 10,
    /** 11 — badges, captions y etiquetas compactas. */
    etiqueta: 11,
    /** 12 — labels, metadatos y textos secundarios chicos. */
    detalle: 12,
    /** 13 — texto corrido: el tamaño más usado de la app. */
    cuerpo: 13,
    /** 14 — texto corrido ligeramente grande (párrafos centrados). */
    cuerpoMedio: 14,
    /** 15 — texto de botón. */
    boton: 15,
    /** 16 — texto destacado chico. */
    destacado: 16,
    /** 18 — subtítulos. */
    subtitulo: 18,
    /** 20 — encabezados de sección chicos. */
    encabezado: 20,
    /** 22 — títulos de sección. */
    titulo: 22,
    /** 27 — títulos de pantalla. */
    tituloPantalla: 27,
    /** 34 — logotipo de la portada. */
    marca: 34,
    /** 44 — íconos emoji grandes de estados (✔️ ✉️). */
    iconoGrande: 44,
  },

  /** Pesos de texto. RN acepta '400'…'900'; la app usa 500 en adelante. */
  peso: {
    /** Texto corrido con peso normal. */
    normal: '400',
    /** Peso de párrafos y textos de apoyo (el de la app). */
    medio: '500',
    /** Botones secundarios y textos firmes. */
    semibold: '600',
    /** Botones y encabezados. */
    negrita: '700',
    /** Títulos de pantalla y logotipo. */
    extranegrita: '800',
    /** Máximo énfasis (encabezados de tabla, cifras). */
    negro: '900',
  },

  /**
   * Estilos de texto combinados (tamaño + peso + interlineado + tracking),
   * tomados de las pantallas reales. Evita que cada pantalla declare a mano
   * su mezcla de propiedades tipográficas.
   */
  texto: {
    /** Logotipo grande de la portada. */
    marca: { fontSize: 34, lineHeight: 42, letterSpacing: -0.7, fontWeight: '800' },
    /** Título de pantalla de las pantallas de acceso. */
    tituloPantalla: { fontSize: 27, lineHeight: 34, letterSpacing: -0.4, fontWeight: '800' },
    /** Párrafo centrado de apoyo (subtítulos, instrucciones). */
    cuerpo: { fontSize: 14, lineHeight: 21, fontWeight: '500' },
    /** Texto corrido chico con interlineado holgado. */
    cuerpoChico: { fontSize: 13, lineHeight: 19, fontWeight: '500' },
    /** Texto de botón primario. */
    boton: { fontSize: 15, fontWeight: '700' },
    /** Texto de botón secundario. */
    botonSecundario: { fontSize: 15, fontWeight: '600' },
  },
} as const;

// ---------------------------------------------------------------------------
// Espaciados
// ---------------------------------------------------------------------------

/**
 * Escala de espaciado (px). Los pasos de 2 a 16 crecen de a 2; los impares
 * 15 y 18 son valores reales de la identidad (padding de botones y de
 * tarjetas) que la app ya usa. Los pasos '2xl' en adelante son márgenes de
 * pantalla y bloques.
 */
export const espaciado = {
  /** 2 px — el más chico: entre ícono y texto pegados. */
  xxs: 2,
  /** 4 px — separación fina entre elementos hermanos. */
  xs: 4,
  /** 6 px — hueco chico de filas y grupos. */
  sm: 6,
  /** 8 px — hueco por defecto de la app (el más repetido). */
  md: 8,
  /** 10 px — hueco suelto entre bloques chicos. */
  lg: 10,
  /** 12 px — padding estándar de tarjetas e inputs. */
  xl: 12,
  /** 14 px — padding de botones y grupos de controles. */
  xxl: 14,
  /** 15 px — padding vertical de los botones (paso real de la app). */
  '15': 15,
  /** 16 px — aire interno generoso. */
  xxxl: 16,
  /** 18 px — padding y separaciones medianas de tarjetas (cliente/POS). */
  '18': 18,
  /** 20 px — margen horizontal de listas. */
  '2xl': 20,
  /** 24 px — separación y padding de secciones. */
  '3xl': 24,
  /** 28 px — margen lateral de las pantallas de acceso. */
  '4xl': 28,
  /** 32 px — bloque superior de encabezados. */
  '5xl': 32,
  /** 40 px — respiración grande (cabecera de la portada). */
  '6xl': 40,
} as const;

// ---------------------------------------------------------------------------
// Radios de esquina
// ---------------------------------------------------------------------------

/** Escala de border radius (px). */
export const radios = {
  /** 6 px — esquinas apenas redondeadas (chips chicos). */
  xs: 6,
  /** 8 px — controles compactos. */
  sm: 8,
  /** 10 px — tarjetas compactas y cajones de error. */
  md: 10,
  /** 12 px — el más usado: inputs y tarjetas. */
  lg: 12,
  /** 14 px — botones. */
  xl: 14,
  /** 16 px — tarjetas medianas. */
  xxl: 16,
  /** 18 px — tarjetas grandes y banners. */
  xxxl: 18,
  /** 20 px — hojas y fichas destacadas. */
  grande: 20,
  /** 32 px — paneles con borde superior redondeado (hoja de la portada). */
  panel: 32,
  /** 999 px — píldora: badges y botones totalmente redondos. */
  pildora: 999,
} as const;

// ---------------------------------------------------------------------------
// Sombras
// ---------------------------------------------------------------------------

/**
 * Elevationes de la app (iOS/Android/web). `shadowColor` tinta mantiene la
 * calidez de la identidad; `elevation` es la sombra nativa de Android. Las
 * migraciones de pantallas normalizan las opacidades sueltas que hoy existen
 * (0.04, 0.08, 0.12, 0.18, 0.2) a estos tres niveles, con revisión visual.
 */
export const sombras = {
  /** Reposa: tarjetas y superficies en reposo (la más usada). */
  sutil: {
    shadowColor: '#2D1B14',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  /** Elevada: botones y elementos con cierta profundidad. */
  media: {
    shadowColor: '#2D1B14',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  /** Flotante: modales, FABs y elementos que se separan del fondo. */
  alta: {
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const;

// ---------------------------------------------------------------------------
// Punto de entrada único
// ---------------------------------------------------------------------------

/**
 * Tokens completos de diseño. Importar desde acá en las pantallas:
 *
 *   import { tokens } from '../../theme/tokens';
 */
export const tokens = {
  colores,
  tipografia,
  espaciado,
  radios,
  sombras,
} as const;

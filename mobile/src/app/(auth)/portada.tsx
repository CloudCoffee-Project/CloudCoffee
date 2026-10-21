// src/app/(auth)/portada.tsx
//
// Pantalla inicial de CloudCoffee (INT4-20). Diseño basado en el mockup
// (cloudcoffee-react/App → vista "inicio"): marca turquesa, ilustración,
// subtítulo y dos acciones: Crear cuenta / Iniciar sesión.

import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tokens } from '../../theme/tokens';

export default function PortadaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      contentContainerStyle={[styles.screen, { paddingTop: insets.top + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.brandHeader}>
        <Text style={styles.brand}>CloudCoffee</Text>
      </View>

      <View style={styles.imageWrapper}>
        <Image source={require('../../../assets/images/portada.png')} style={styles.image} />
      </View>

      <View style={styles.content}>
        <Text style={styles.subtitle}>
          Pide tu café y snacks con anticipación para retirar sin esperas en el campus.
        </Text>

        <View style={styles.actions}>
          <Pressable
            onPress={() => router.push('/(auth)/registro')}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryPressed]}
          >
            <Text style={styles.primaryText}>Crear cuenta</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push('/(auth)/login')}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryPressed]}
          >
            <Text style={styles.secondaryText}>Iniciar sesión</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

// Los valores de layout que se mantienen a mano (medidas de la ilustración,
// anchos máximos y paddings puntuales de esta pantalla) no son tokens de
// diseño: ver regla 3 en src/theme/tokens.ts.
const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    backgroundColor: tokens.colores.fondoAuth,
    paddingBottom: 44,
  },
  brandHeader: {
    alignItems: 'center',
    paddingHorizontal: tokens.espaciado['3xl'],
  },
  brand: {
    color: tokens.colores.marca,
    ...tokens.tipografia.texto.marca,
  },
  imageWrapper: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.espaciado['3xl'],
    paddingVertical: tokens.espaciado.xxxl,
  },
  image: {
    width: 240,
    maxWidth: '90%',
    height: 320,
    resizeMode: 'contain',
  },
  content: {
    backgroundColor: tokens.colores.superficie,
    borderTopWidth: 1,
    borderTopColor: tokens.colores.bordeAuth,
    borderTopLeftRadius: tokens.radios.panel,
    borderTopRightRadius: tokens.radios.panel,
    alignItems: 'center',
    paddingHorizontal: tokens.espaciado['4xl'],
    paddingTop: tokens.espaciado['3xl'],
  },
  subtitle: {
    ...tokens.tipografia.texto.cuerpo,
    color: tokens.colores.textoSecundario,
    textAlign: 'center',
    maxWidth: 300,
    marginBottom: tokens.espaciado['18'],
  },
  actions: {
    width: '100%',
    gap: tokens.espaciado.xl,
    paddingBottom: tokens.espaciado.md,
  },
  primaryButton: {
    backgroundColor: tokens.colores.tinta,
    borderRadius: tokens.radios.xl,
    paddingVertical: tokens.espaciado['15'],
    alignItems: 'center',
  },
  primaryPressed: {
    backgroundColor: tokens.colores.tintaPresionada,
  },
  primaryText: {
    ...tokens.tipografia.texto.boton,
    color: tokens.colores.crema,
  },
  secondaryButton: {
    backgroundColor: tokens.colores.crema,
    borderWidth: 1,
    borderColor: tokens.colores.bordeAuth,
    borderRadius: tokens.radios.xl,
    paddingVertical: tokens.espaciado['15'],
    alignItems: 'center',
  },
  secondaryPressed: {
    backgroundColor: tokens.colores.cremaPresionada,
  },
  secondaryText: {
    ...tokens.tipografia.texto.botonSecundario,
    color: tokens.colores.tintaSuave,
  },
});

// src/app/(auth)/portada.tsx
//
// Pantalla inicial de CloudCoffee (INT4-20). Diseño basado en el mockup
// (cloudcoffee-react/App → vista "inicio"): marca turquesa, ilustración,
// subtítulo y dos acciones: Crear cuenta / Iniciar sesión.

import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    backgroundColor: '#F5EFE6',
    paddingBottom: 44,
  },
  brandHeader: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  brand: {
    color: '#0284C7',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.7,
    lineHeight: 42,
  },
  imageWrapper: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  image: {
    width: 240,
    maxWidth: '90%',
    height: 320,
    resizeMode: 'contain',
  },
  content: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5DDD3',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 24,
  },
  subtitle: {
    color: '#7A7067',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 300,
    marginBottom: 18,
  },
  actions: {
    width: '100%',
    gap: 12,
    paddingBottom: 8,
  },
  primaryButton: {
    backgroundColor: '#2D1B14',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryPressed: {
    backgroundColor: '#1E120D',
  },
  primaryText: {
    color: '#FAF6F0',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#FAF6F0',
    borderWidth: 1,
    borderColor: '#E5DDD3',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  secondaryPressed: {
    backgroundColor: '#EDE5D8',
  },
  secondaryText: {
    color: '#26211D',
    fontSize: 15,
    fontWeight: '600',
  },
});

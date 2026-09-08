// src/app/(cliente)/campus.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';

interface Campus {
  id: string;
  nombre: string;
  direccion: string;
}

const CAMPUS_LISTA: Campus[] = [
  { id: 'san-juan-pablo-ii', nombre: 'Campus San Juan Pablo II', direccion: 'Peligde, Temuco' },
  { id: 'san-francisco', nombre: 'Campus San Francisco', direccion: 'Manuel Montt 056, Temuco' },
  { id: 'norte', nombre: 'Campus Norte', direccion: 'Av. Rudecindo Ortega 02950, Temuco' },
  { id: 'menchaca-lira', nombre: 'Campus Menchaca Lira', direccion: 'Av. Alemania 0422, Temuco' },
];

export const CAMPUS_STORAGE_KEY = '@app_campus_seleccionado';

export default function CampusScreen() {
  const router = useRouter();
  const [campusSeleccionado, setCampusSeleccionado] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<boolean>(false);

  const handleConfirmar = async () => {
    if (!campusSeleccionado) {
      Alert.alert('Acción requerida', 'Debes seleccionar un campus para poder continuar.');
      return;
    }

    try {
      setGuardando(true);
      const campusObj = CAMPUS_LISTA.find((c) => c.id === campusSeleccionado);
      
      await AsyncStorage.setItem(CAMPUS_STORAGE_KEY, JSON.stringify(campusObj));
      router.replace('/(cliente)');
    } catch (error) {
      console.error('Error al guardar el campus:', error);
      Alert.alert('Error', 'No se pudo guardar la selección. Intenta nuevamente.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.badge}>Paso obligatorio</Text>
          <Text style={styles.title}>Selecciona tu Campus</Text>
          <Text style={styles.subtitle}>
            Para ofrecerte el catálogo y servicios adecuados, selecciona la sede en la que te encuentras.
          </Text>
        </View>

        <View style={styles.cardsContainer}>
          {CAMPUS_LISTA.map((campus) => {
            const isSelected = campusSeleccionado === campus.id;

            return (
              <TouchableOpacity
                key={campus.id}
                activeOpacity={0.8}
                style={[styles.card, isSelected && styles.cardSelected]}
                onPress={() => setCampusSeleccionado(campus.id)}
              >
                <View style={styles.cardContent}>
                  <Text style={[styles.cardTitle, isSelected && styles.cardTitleSelected]}>
                    {campus.nombre}
                  </Text>
                  <Text style={[styles.cardSubtitle, isSelected && styles.cardSubtitleSelected]}>
                    {campus.direccion}
                  </Text>
                </View>

                <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}>
                  {isSelected && <View style={styles.radioDot} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.button, !campusSeleccionado && styles.buttonDisabled]}
          disabled={!campusSeleccionado || guardando}
          onPress={handleConfirmar}
          activeOpacity={0.85}
        >
          {guardando ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>Confirmar y Continuar</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 25,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  header: {
    marginBottom: 24,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#E0E7FF',
    color: '#4338CA',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748B',
    lineHeight: 20,
  },
  cardsContainer: {
    gap: 12,
    marginVertical: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  cardSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  cardContent: {
    flex: 1,
    marginRight: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 3,
  },
  cardTitleSelected: {
    color: '#1D4ED8',
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#64748B',
  },
  cardSubtitleSelected: {
    color: '#3B82F6',
  },
  radioCircle: {
    height: 22,
    width: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleSelected: {
    borderColor: '#2563EB',
  },
  radioDot: {
    height: 12,
    width: 12,
    borderRadius: 6,
    backgroundColor: '#2563EB',
  },
  footer: {
    paddingTop: 12,
  },
  button: {
    backgroundColor: '#2563EB',
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#94A3B8',
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useFocusEffect } from 'expo-router';
import axios from 'axios';

const API_URL = Platform.select({
  android: 'http://10.0.2.2:8080',
  ios: 'http://localhost:8080',
  default: 'http://localhost:8080',
});

// Clave compartida con campus.tsx
export const CAMPUS_STORAGE_KEY = '@app_campus_seleccionado';

export interface CategoriaBackend {
  id: string;
  nombre: string;
}

export interface Producto {
  id: string;
  nombre: string;
  descripcion: string;
  categoriaId: string;
  icono: string;
  campusDisponibles: string[];
  localNombre: string;
  localUbicacion: string;
  precio: number;
}

// MOCK de productos adaptado a los IDs reales de tu lista de campus
const PRODUCTOS_MOCK: Producto[] = [
  {
    id: 'p-1',
    nombre: 'Café Americano 12oz',
    descripcion: 'Espresso doble con agua caliente, tostado medio local.',
    categoriaId: 'cat-bebidas',
    icono: '☕',
    campusDisponibles: ['san-juan-pablo-ii', 'san-francisco'],
    localNombre: 'Cafetería Central',
    localUbicacion: 'Pabellón Central - Piso 1',
    precio: 1800,
  },
  {
    id: 'p-2',
    nombre: 'Croissant Jamón y Queso',
    descripcion: 'Hojaldre mantequilla horneado a diario con queso gouda.',
    categoriaId: 'cat-pasteleria',
    icono: '🥐',
    campusDisponibles: ['san-francisco', 'norte'],
    localNombre: 'Cafetería Central',
    localUbicacion: 'Pabellón Central - Piso 1',
    precio: 2500,
  },
  {
    id: 'p-3',
    nombre: 'Jugo Natural de Naranja',
    descripcion: 'Jugo 100% natural recién exprimido 300ml.',
    categoriaId: 'cat-bebidas',
    icono: '🥤',
    campusDisponibles: ['norte', 'menchaca-lira'],
    localNombre: 'Casino Principal',
    localUbicacion: 'Piso 1',
    precio: 2000,
  },
  {
    id: 'p-4',
    nombre: 'Mix de Frutos Secos',
    descripcion: 'Almendras, nueces, maní sin sal y pasas 100g.',
    categoriaId: 'cat-snacks',
    icono: '🥜',
    campusDisponibles: ['san-juan-pablo-ii', 'san-francisco', 'norte', 'menchaca-lira'],
    localNombre: 'Kiosko Central',
    localUbicacion: 'Patio Central',
    precio: 1500,
  },
];

export default function CatalogoProductosScreen() {
  const router = useRouter();
  const [campusId, setCampusId] = useState<string>('san-juan-pablo-ii');
  const [campusNombre, setCampusNombre] = useState<string>('Campus San Juan Pablo II');
  const [busqueda, setBusqueda] = useState('');
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState<string>('todos');
  const [categorias, setCategorias] = useState<CategoriaBackend[]>([]);
  const [cargando, setCargando] = useState(true);

  // Se vuelve a ejecutar automáticamente cada vez que el usuario regresa a la pantalla
  useFocusEffect(
    useCallback(() => {
      cargarDatos();
    }, [])
  );

  const cargarDatos = async () => {
    try {
      setCargando(true);
      // Leemos el JSON guardado desde campus.tsx
      const campusGuardadoStr = await AsyncStorage.getItem(CAMPUS_STORAGE_KEY);
      if (campusGuardadoStr) {
        const campusObj = JSON.parse(campusGuardadoStr);
        if (campusObj?.id && campusObj?.nombre) {
          setCampusId(campusObj.id);
          setCampusNombre(campusObj.nombre);
        }
      }
      await cargarCategorias();
    } catch (e) {
      setCategoriasDefault();
    } finally {
      setCargando(false);
    }
  };

  const cargarCategorias = async () => {
    try {
      const response = await axios.get<CategoriaBackend[]>(
        `${API_URL}/v1/catalog/categorias`,
        { timeout: 3000 }
      );

      if (Array.isArray(response.data) && response.data.length > 0) {
        setCategorias(response.data);
      } else {
        setCategoriasDefault();
      }
    } catch (e) {
      setCategoriasDefault();
    }
  };

  const setCategoriasDefault = () => {
    setCategorias([
      { id: 'cat-snacks', nombre: 'Snacks' },
      { id: 'cat-bebidas', nombre: 'Bebidas' },
      { id: 'cat-pasteleria', nombre: 'Pastelería' },
    ]);
  };

  const productosFiltrados = PRODUCTOS_MOCK.filter((prod) => {
    const cumpleCampus = !campusId || prod.campusDisponibles.includes(campusId);

    const cumpleBusqueda =
      prod.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      prod.descripcion.toLowerCase().includes(busqueda.toLowerCase());

    const cumpleCategoria =
      categoriaSeleccionada === 'todos' || prod.categoriaId === categoriaSeleccionada;

    return cumpleCampus && cumpleBusqueda && cumpleCategoria;
  });

  return (
    <View style={styles.container}>
      {/* 1. Header con Selector de Campus */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.pinContainer}>
            <Text style={{ fontSize: 16 }}>📍</Text>
          </View>
          <View style={styles.campusInfoContainer}>
            <Text style={styles.campusLabel}>CAMPUS ACTUAL</Text>
            <Text style={styles.campusName} numberOfLines={1}>
              {campusNombre}
            </Text>
            <TouchableOpacity 
              onPress={() => router.push('/(cliente)/campus')}
              style={styles.changeBtnContainer}
            >
              <Text style={styles.changeLink}>Cambiar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* 2. Buscador */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar café, sándwich, snacks..."
          placeholderTextColor="#9CA3AF"
          value={busqueda}
          onChangeText={setBusqueda}
        />
      </View>

      {/* 3. Filtro de Categorías */}
      <View style={styles.categoriesContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <TouchableOpacity
            style={[
              styles.pill,
              categoriaSeleccionada === 'todos' && styles.pillActive,
            ]}
            onPress={() => setCategoriaSeleccionada('todos')}
          >
            <Text
              style={[
                styles.pillText,
                categoriaSeleccionada === 'todos' && styles.pillTextActive,
              ]}
            >
              TODOS
            </Text>
          </TouchableOpacity>

          {categorias.map((cat) => (
            <TouchableOpacity
              key={cat.id}
              style={[
                styles.pill,
                categoriaSeleccionada === cat.id && styles.pillActive,
              ]}
              onPress={() => setCategoriaSeleccionada(cat.id)}
            >
              <Text
                style={[
                  styles.pillText,
                  categoriaSeleccionada === cat.id && styles.pillTextActive,
                ]}
              >
                {cat.nombre}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* 4. Listado de Productos */}
      {cargando ? (
        <ActivityIndicator size="large" color="#0052CC" style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={productosFiltrados}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={styles.vacioText}>
              No hay productos disponibles para este campus en esta categoría.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.productCard}>
              <View style={styles.productHeader}>
                <View style={styles.productIconContainer}>
                  <Text style={{ fontSize: 20 }}>{item.icono}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.productTitle}>{item.nombre}</Text>
                  <Text style={styles.productDescription}>{item.descripcion}</Text>
                </View>
              </View>

              <View style={styles.puntoVentaRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.localTitle}>{item.localNombre}</Text>
                  <Text style={styles.localUbicacion}>{item.localUbicacion}</Text>
                  <Text style={styles.localPrecio}>
                    ${item.precio.toLocaleString('es-CL')}
                  </Text>
                </View>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9F6F0',
    paddingHorizontal: 14,
  },
  header: {
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 12 : 44,
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EFECE6',
    alignSelf: 'flex-start',
  },
  pinContainer: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  campusInfoContainer: {
    justifyContent: 'center',
  },
  campusLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#9CA3AF',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  campusName: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#0052CC',
    marginBottom: 6,
  },
  changeBtnContainer: {
    alignSelf: 'flex-start',
  },
  changeLink: {
    fontSize: 11,
    color: '#0052CC',
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  searchContainer: {
    marginBottom: 10,
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    color: '#1F2937',
  },
  categoriesContainer: {
    marginBottom: 12,
  },
  pill: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  pillActive: {
    backgroundColor: '#0052CC',
    borderColor: '#0052CC',
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4B5563',
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
  listContent: {
    paddingBottom: 20,
  },
  productCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  productHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  productIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  productTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0052CC',
  },
  productDescription: {
    fontSize: 10,
    color: '#6B7280',
    marginTop: 1,
  },
  puntoVentaRow: {
    backgroundColor: '#FAF8F5',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#F3F0E9',
  },
  localTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  localUbicacion: {
    fontSize: 10,
    color: '#9CA3AF',
  },
  localPrecio: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#0052CC',
    marginTop: 2,
  },
  vacioText: {
    textAlign: 'center',
    color: '#9CA3AF',
    marginTop: 20,
    fontSize: 12,
  },
});
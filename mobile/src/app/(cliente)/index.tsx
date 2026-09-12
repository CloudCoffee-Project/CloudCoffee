import React, { useState, useEffect } from 'react';
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
import axios from 'axios';

const API_URL = Platform.select({
  android: 'http://10.0.2.2:8080',
  ios: 'http://localhost:8080',
  default: 'http://localhost:8080',
});

export interface CategoriaBackend {
  id: string;
  nombre: string;
}

export interface Producto {
  id: string;
  nombre: string;
  descripcion: string;
  categoriaId: string;
  precioReferencial: number;
  icono: string;
}

const PRODUCTOS_MOCK: Producto[] = [
  {
    id: 'p-1',
    nombre: 'Café Americano 12oz',
    descripcion: 'Espresso doble con agua caliente, tostado medio local.',
    categoriaId: 'cat-bebidas',
    precioReferencial: 1750,
    icono: '☕',
  },
  {
    id: 'p-2',
    nombre: 'Croissant Jamón y Queso',
    descripcion: 'Hojaldre mantequilla horneado a diario con queso gouda.',
    categoriaId: 'cat-pasteleria',
    precioReferencial: 2500,
    icono: '🥐',
  },
  {
    id: 'p-3',
    nombre: 'Jugo Natural de Naranja',
    descripcion: 'Jugo 100% natural recién exprimido 300ml.',
    categoriaId: 'cat-bebidas',
    precioReferencial: 2000,
    icono: '🥤',
  },
  {
    id: 'p-4',
    nombre: 'Mix de Frutos Secos',
    descripcion: 'Almendras, nueces, maní sin sal y pasas 100g.',
    categoriaId: 'cat-snacks',
    precioReferencial: 1500,
    icono: '🥜',
  },
];

export default function CatalogoProductosScreen() {
  const [busqueda, setBusqueda] = useState('');
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState<string>('todos');
  const [categorias, setCategorias] = useState<CategoriaBackend[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    cargarCategorias();
  }, []);

  const cargarCategorias = async () => {
    try {
      setCargando(true);
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
    } finally {
      setCargando(false);
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
    const cumpleBusqueda =
      prod.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      prod.descripcion.toLowerCase().includes(busqueda.toLowerCase());

    const cumpleCategoria =
      categoriaSeleccionada === 'todos' || prod.categoriaId === categoriaSeleccionada;

    return cumpleBusqueda && cumpleCategoria;
  });

  return (
    <View style={styles.container}>
      {/* 1. Título con margen superior dinámico para liberar la hora/notificaciones */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Catálogo de Productos</Text>
        <Text style={styles.headerSubtitle}>Explora los productos disponibles</Text>
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
            <Text style={styles.vacioText}>No hay productos en esta categoría.</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.productCard}>
              <View style={styles.productIconContainer}>
                <Text style={{ fontSize: 24 }}>{item.icono}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.productTitle}>{item.nombre}</Text>
                <Text style={styles.productDescription}>{item.descripcion}</Text>
                <Text style={styles.productPrice}>
                  Desde ${item.precioReferencial.toLocaleString('es-CL')}
                </Text>
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
    backgroundColor: '#F7F4EE',
    paddingHorizontal: 16,
  },
  header: {
    // Calcula el margen superior considerando la barra de estado en iOS y Android
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 16 : 48,
    marginBottom: 14,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#6B7280',
  },
  searchContainer: {
    marginBottom: 12,
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    color: '#1F2937',
  },
  categoriesContainer: {
    marginBottom: 14,
  },
  pill: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
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
    fontSize: 12,
    fontWeight: '600',
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
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  productIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  productTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#0052CC',
  },
  productDescription: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  productPrice: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#1F2937',
    marginTop: 6,
  },
  vacioText: {
    textAlign: 'center',
    color: '#9CA3AF',
    marginTop: 20,
    fontSize: 13,
  },
});
// src/context/CarritoContext.tsx
//
// Estado global del carrito (INT4-32). Vive solo en memoria: es un Context de
// React y no un store externo porque la app no tiene —ni va a instalar— Zustand
// ni otra librería de estado, y no se agregan dependencias. Se monta en el root
// layout, por dentro de AuthProvider, para que toda la app comparta la misma
// instancia del carrito.
//
// El carrito es una lista de líneas (ItemCarrito de types/domain.ts) y la
// identidad de una línea es la oferta: agregar dos veces el mismo producto en la
// misma cafetería suma cantidad a la misma línea en vez de abrir otra. Son
// líneas distintas un producto distinto, o el mismo producto en otra cafetería,
// porque se retiran en puntos distintos. Es el criterio del mockup y el que
// espera POST /v1/compras, que manda un item por ofertaId.
//
// No se persiste a disco: la tarea lo define "en memoria" y la orden se confirma
// contra el backend. Se pierde al recargar o al cerrar la app, y se vacía al
// cambiar de sesión para que el carrito de uno no le aparezca a otro en un
// equipo compartido.

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { useAuth } from './AuthContext';
import type { ItemCarrito, NuevoItemCarrito } from '../types/domain';

// Un punto de retiro con todo lo que se compró ahí. El carrito se agrupa por
// cafetería y no por producto porque la línea ya es una Oferta: el mismo café
// comprado en dos cafeterías son dos líneas que se retiran en dos puntos
// distintos. El orden de los grupos es el de la primera vez que se agregó cada
// cafetería, que es el orden en que el usuario las fue viendo.
export interface GrupoCafeteria {
  cafeteriaId: string;
  cafeteriaNombre: string;
  items: ItemCarrito[];
  subtotal: number;
  unidades: number;
}

interface CarritoContextValue {
  items: ItemCarrito[];
  // Suma de precioUnitario * cantidad. Los precios son pesos enteros, así que
  // no hay redondeo que hacer acá: el total es el mismo que ve el usuario.
  total: number;
  // Unidades, no líneas: dos líneas de 1 dan 2. Es el número que va en cualquier
  // contador de "productos en tu carrito".
  unidades: number;
  // Las mismas líneas de items, agrupadas por punto de retiro. Vive acá y no en
  // cada pantalla porque el carrito (INT4-33) y el checkout (INT4-35) muestran
  // el mismo desglose y duplicar el cálculo era pedir que se desincronizaran.
  grupos: GrupoCafeteria[];
  agregar: (item: NuevoItemCarrito, cantidad: number) => void;
  cambiarCantidad: (ofertaId: string, cantidad: number) => void;
  quitar: (ofertaId: string) => void;
  vaciar: () => void;
}

const CarritoContext = createContext<CarritoContextValue | null>(null);

interface Props {
  children: ReactNode;
}

export function CarritoProvider({ children }: Props) {
  const { sesion } = useAuth();
  const [items, setItems] = useState<ItemCarrito[]>([]);
  const [duenoSesion, setDuenoSesion] = useState<string | null>(null);

  // El carrito es de quien tiene la sesión abierta, así que al cerrarla o
  // cambiarla se vacía. Se hace en el render y no en un efecto: es el patrón de
  // React para derivar estado de una entrada, gasta un render menos y no
  // necesita desactivar la regla de set-state-in-effect.
  const usuarioActual = sesion?.userId ?? null;
  if (duenoSesion !== usuarioActual) {
    setDuenoSesion(usuarioActual);
    setItems([]);
  }

  const agregar = useCallback((item: NuevoItemCarrito, cantidad: number) => {
    const pedidas = Math.floor(cantidad);
    // Una oferta sin stock no entra, y una cantidad no positiva tampoco. El
    // stepper del detalle ya viene acotado, pero el estado no depende de que ese
    // botón siga siendo el único que lo llama.
    if (pedidas < 1 || item.stock < 1) return;

    setItems((previas) => {
      const indice = previas.findIndex((linea) => linea.ofertaId === item.ofertaId);

      if (indice < 0) {
        return [...previas, { ...item, cantidad: Math.min(pedidas, item.stock) }];
      }

      // Misma oferta: se acumula en la línea que ya existe y nunca pasa el
      // stock conocido ahora. Los datos del item se refrescan porque el
      // catálogo es la fuente de la verdad, no lo que quedó guardado la primera
      // vez: si el precio cambió, la línea muestra el nuevo.
      const acumulada = Math.min(previas[indice].cantidad + pedidas, item.stock);
      return previas.map((linea, i) =>
        i === indice ? { ...linea, ...item, cantidad: acumulada } : linea
      );
    });
  }, []);

  const cambiarCantidad = useCallback((ofertaId: string, cantidad: number) => {
    const pedida = Math.floor(cantidad);

    setItems((previas) =>
      previas.flatMap((linea) => {
        if (linea.ofertaId !== ofertaId) return [linea];
        // Bajar de 1 quita la línea en vez de dejarla en 0, que es como lo
        // hace el mockup y como lo va a pedir la pantalla del carrito.
        if (pedida < 1) return [];
        return [{ ...linea, cantidad: Math.min(pedida, linea.stock) }];
      })
    );
  }, []);

  const quitar = useCallback((ofertaId: string) => {
    setItems((previas) => previas.filter((linea) => linea.ofertaId !== ofertaId));
  }, []);

  const vaciar = useCallback(() => setItems([]), []);

  const total = useMemo(
    () => items.reduce((suma, linea) => suma + linea.precioUnitario * linea.cantidad, 0),
    [items]
  );
  const unidades = useMemo(() => items.reduce((suma, linea) => suma + linea.cantidad, 0), [items]);

  // El subtotal y las unidades de cada grupo se acumulan línea por línea para no
  // volver a recorrer items al pintar. El Map conserva el orden de inserción, así
  // que no hace falta un sort aparte.
  const grupos = useMemo<GrupoCafeteria[]>(() => {
    const porCafeteria = new Map<string, GrupoCafeteria>();

    for (const linea of items) {
      const existente = porCafeteria.get(linea.cafeteriaId);

      if (existente) {
        existente.items.push(linea);
        existente.subtotal += linea.precioUnitario * linea.cantidad;
        existente.unidades += linea.cantidad;
        continue;
      }

      porCafeteria.set(linea.cafeteriaId, {
        cafeteriaId: linea.cafeteriaId,
        cafeteriaNombre: linea.cafeteriaNombre,
        items: [linea],
        subtotal: linea.precioUnitario * linea.cantidad,
        unidades: linea.cantidad,
      });
    }

    return [...porCafeteria.values()];
  }, [items]);

  const value = useMemo<CarritoContextValue>(
    () => ({ items, total, unidades, grupos, agregar, cambiarCantidad, quitar, vaciar }),
    [items, total, unidades, grupos, agregar, cambiarCantidad, quitar, vaciar]
  );

  return <CarritoContext.Provider value={value}>{children}</CarritoContext.Provider>;
}

export function useCarrito(): CarritoContextValue {
  const context = useContext(CarritoContext);
  if (!context) {
    throw new Error('useCarrito debe usarse dentro de un <CarritoProvider>');
  }
  return context;
}

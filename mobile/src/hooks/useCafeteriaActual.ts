// src/hooks/useCafeteriaActual.ts
//
// Devuelve el id de la cafetería a la que suscribirse para eventos de stock
// (INT4-46, INT4-98), según el rol de la sesión:
//   - cajero → sesion.cafeteriaId (viene en el JWT).
//   - cliente → primera cafetería del campus guardado en AsyncStorage (IDs reales
//     que devuelve GET /v1/catalog/campus). Se relee al montar, al cambiar de
//     usuario y cada vez que la app vuelve a primer plano para seguir el campus
//     seleccionado.
//   - otros roles → null (sin suscripción a stock).

import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { leerCampusSeleccionado } from '../services/catalog';
import type { Rol } from '../types/domain';

export function useCafeteriaActual(
  rol: Rol | undefined,
  cafeteriaIdSesion: string | null,
  claveSesion?: string
): string | null {
  // Cafetería cargada del campus guardado; solo se usa para el rol cliente.
  const [cafeteriaIdCliente, setCafeteriaIdCliente] = useState<string | null>(null);

  // Lee el campus guardado y toma la primera cafetería real del catálogo.
  const leerCafeteriaCliente = useCallback(async (): Promise<string | null> => {
    try {
      const campus = await leerCampusSeleccionado();
      const cafeterias = campus?.cafeterias;
      if (Array.isArray(cafeterias) && cafeterias.length > 0) {
        const primera = cafeterias[0];
        return primera?.id ?? null;
      }
      return null;
    } catch {
      // Campus corrupto o almacenamiento no disponible: sin cafetería.
      return null;
    }
  }, []);

  useEffect(() => {
    if (rol !== 'cliente') {
      return;
    }

    void leerCafeteriaCliente().then((id) => setCafeteriaIdCliente(id));

    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') {
        void leerCafeteriaCliente().then((id) => setCafeteriaIdCliente(id));
      }
    });

    return () => sub.remove();
  }, [rol, claveSesion, leerCafeteriaCliente]);

  if (rol === 'cajero') {
    return cafeteriaIdSesion;
  }
  return rol === 'cliente' ? cafeteriaIdCliente : null;
}

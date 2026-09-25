// src/hooks/useCafeteriaActual.ts
//
// Devuelve el id de la cafetería a la que suscribirse para eventos de stock
// (INT4-46), según el rol de la sesión:
//   - cajero → sesion.cafeteriaId (viene en el JWT).
//   - cliente → cafetería principal del campus seleccionado (AsyncStorage).
//     El campus se relee al montar, al cambiar de usuario y cada vez que la
//     app vuelve a primer plano: si el cliente cambió de campus la suscripción
//     sigue a la nueva cafetería.
//   - otros roles → null (sin suscripción a stock).

import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { CAMPUS_STORAGE_KEY, cafeteriaIdDeCampus } from '../services/campus';
import type { Rol } from '../types/domain';

export function useCafeteriaActual(
  rol: Rol | undefined,
  cafeteriaIdSesion: string | null,
  claveSesion?: string
): string | null {
  // Campus cargado del almacén local; solo se usa para el rol cliente.
  const [campusId, setCampusId] = useState<string | null>(null);

  // Solo lee el campus; el setState lo hacen los callbacks (promesa/evento).
  const leerCampus = useCallback(async (): Promise<string | null> => {
    try {
      const crudo = await AsyncStorage.getItem(CAMPUS_STORAGE_KEY);
      const campus = crudo ? (JSON.parse(crudo) as { id?: string }) : null;
      return campus?.id ?? null;
    } catch {
      // Campus corrupto o almacenamiento no disponible: sin cafetería.
      return null;
    }
  }, []);

  useEffect(() => {
    if (rol !== 'cliente') {
      return;
    }

    void leerCampus().then((id) => setCampusId(id));

    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') {
        void leerCampus().then((id) => setCampusId(id));
      }
    });

    return () => sub.remove();
  }, [rol, claveSesion, leerCampus]);

  if (rol === 'cajero') {
    return cafeteriaIdSesion;
  }
  return rol === 'cliente' ? cafeteriaIdDeCampus(campusId) : null;
}

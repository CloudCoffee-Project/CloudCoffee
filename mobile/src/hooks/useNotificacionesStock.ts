// src/hooks/useNotificacionesStock.ts
//
// Notificaciones de stock en tiempo real (INT4-46): se suscribe al topic
// /topic/cafeteria/{cafeteriaId}/stock y, cuando un producto pasa a agotado
// o vuelve a estar disponible, persiste la notificación en la bandeja local
// (historialNotificaciones) y la expone para el banner in-app.
//
// Solo notifican cambios de estado reales: eventos con el mismo estado y el
// primer evento con stock disponible se ignoran (ver transicionDeStock).

import { useEffect, useRef, useState } from 'react';

import { agregarNotificacion } from '../services/historialNotificaciones';
import { notificacionDeEventoStock, transicionDeStock } from '../services/notificacionesStock';
import { parsearEventoStock } from '../services/parsearEventoStock';
import { subscribeToTopic, topicCafeteriaStock } from '../services/websocket';
import type { NotificacionRecibida } from './useNotificacionesPush';

export function useNotificacionesStock(
  cafeteriaId: string | null | undefined,
  activo: boolean = true
): { ultimaNotificacion: NotificacionRecibida | null } {
  const [ultimaNotificacion, setUltimaNotificacion] = useState<NotificacionRecibida | null>(null);
  // Último stock conocido por oferta, para detectar transiciones agotado/disponible.
  const previosRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!cafeteriaId || !activo) {
      return;
    }

    const unsubscribe = subscribeToTopic(topicCafeteriaStock(cafeteriaId), (message) => {
      const evento = parsearEventoStock(message.body);
      if (!evento) {
        // Mensaje malformado: se ignora y se espera el siguiente evento.
        return;
      }

      const anterior = previosRef.current[evento.ofertaId] ?? null;
      const tipo = transicionDeStock(anterior, evento.stockActual);
      previosRef.current[evento.ofertaId] = evento.stockActual;
      if (!tipo) {
        return;
      }
      const entrada = notificacionDeEventoStock(evento, tipo);
      void agregarNotificacion(entrada);
      setUltimaNotificacion({ titulo: entrada.titulo, cuerpo: entrada.cuerpo, url: entrada.url });
    });

    return unsubscribe;
  }, [cafeteriaId, activo]);

  return { ultimaNotificacion };
}

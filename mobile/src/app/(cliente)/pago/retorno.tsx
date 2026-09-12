// src/app/(cliente)/payment/retorno.tsx
//
// Esta pantalla existe para el "Camino B" del deep link cloudcoffee://payment/retorno:
// cuando el usuario backgroundeó o cerró la app durante el pago y el sistema
// operativo termina abriendo la app directamente vía el scheme, en vez de que
// el redirect sea interceptado por WebBrowser.openAuthSessionAsync (Camino A,
// manejado en carrito.tsx).
//
// Expo Router ignora las carpetas entre paréntesis al armar la ruta, así que
// aunque este archivo vive dentro de (cliente), responde exactamente a la
// ruta /payment/retorno.

import { useEffect, useRef } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { EstadoPagoVisual } from '../../../services/pagos';

function normalizarEstado(valor: string | string[] | undefined): EstadoPagoVisual {
  const v = Array.isArray(valor) ? valor[0] : valor;
  switch (v) {
    case 'approved':
      return 'exitoso';
    case 'rejected':
      return 'rechazado';
    case 'pending':
    case 'in_process':
      return 'pendiente';
    default:
      return 'desconocido';
  }
}

export default function RetornoPagoScreen() {
  const params = useLocalSearchParams();
  const yaNavego = useRef(false);

  useEffect(() => {
    if (yaNavego.current) return;
    yaNavego.current = true;

    const estadoCrudo = (params.status ?? params.collection_status) as
      string | string[] | undefined;

    const compraId = (
      Array.isArray(params.external_reference)
        ? params.external_reference[0]
        : params.external_reference
    ) as string | undefined;

    const paymentId = (
      Array.isArray(params.payment_id) ? params.payment_id[0] : params.payment_id
    ) as string | undefined;

    router.replace({
      pathname: '/resultado-pago',
      params: {
        estado: normalizarEstado(estadoCrudo),
        compraId: compraId ?? '',
        paymentId: paymentId ?? '',
      },
    });
  }, [params]);

  // Mientras se procesa la redirección, mostramos un loader breve.
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" />
    </View>
  );
}

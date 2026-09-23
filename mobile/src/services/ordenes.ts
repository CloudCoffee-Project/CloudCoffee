// src/services/ordenes.ts
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:18080';

export interface Orden {
  id: string;
  codigoOrden: string;
  estado: string;
}

export async function fetchPedidosEntrantes(accessToken: string): Promise<Orden[]> {
  const response = await fetch(`${API_URL}/orders?estado=activas`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Error al obtener pedidos: ${response.status}`);
  }

  return response.json();
}

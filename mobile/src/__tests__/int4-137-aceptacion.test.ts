/// <reference types="node" />
// src/__tests__/int4-137-aceptacion.test.ts
// Checklist de aceptación de INT4-137: endpoint, JWT, reconexión, limpieza
// y envelope payload. Se ejecuta con `npm test` (no necesita backend).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Client } from '@stomp/stompjs';
import type { IFrame } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

import { WS_BASE_URL } from '../config/api';
import {
  connectWebSocket,
  disconnectWebSocket,
  subscribeToTopic,
  topicCafeteriaStock,
} from '../services/websocket';

interface ConfigMock {
  connectHeaders?: Record<string, string>;
  beforeConnect?: (client: StompClientMock) => void;
  webSocketFactory?: () => void;
  reconnectDelay?: number;
}

interface StompClientMock {
  config: ConfigMock;
  connectHeaders: Record<string, string>;
  connected: boolean;
  subscribe: jest.Mock;
  activate: jest.Mock;
  deactivate: jest.Mock;
  onConnect?: (() => void) | undefined;
  onStompError?: ((frame: IFrame) => void) | undefined;
  onWebSocketClose?: (() => void) | undefined;
}

jest.mock('@stomp/stompjs', () => ({
  Client: jest.fn().mockImplementation(function MockClient(
    this: StompClientMock,
    config: ConfigMock
  ) {
    this.config = config;
    this.connectHeaders = config?.connectHeaders ?? {};
    this.connected = false;
    this.subscribe = jest.fn();
    this.activate = jest.fn(() => {
      this.connected = true;
      this.onConnect?.();
    });
    this.deactivate = jest.fn(() => {
      this.connected = false;
    });
  }),
}));

jest.mock('sockjs-client', () => jest.fn());

const ClientMock = Client as unknown as jest.Mock;
const SockJSMock = SockJS as unknown as jest.Mock;

const MOBILE_ROOT = resolve(__dirname, '../..');

function leer(relativo: string): string {
  return readFileSync(resolve(MOBILE_ROOT, relativo), 'utf8');
}

function ultimaConfig(): ConfigMock {
  return ClientMock.mock.calls[ClientMock.mock.calls.length - 1]?.[0];
}

function ultimaInstancia(): StompClientMock {
  return ClientMock.mock.instances[ClientMock.mock.instances.length - 1];
}

beforeEach(() => {
  jest.clearAllMocks();
  disconnectWebSocket();
});

describe('INT4-137 · aceptación (configuración y fuentes)', () => {
  it('apunta al gateway público y ya no usa la IP LAN', () => {
    const archivos = [leer('.env'), leer('.env.example')];

    for (const contenido of archivos) {
      expect(contenido).toContain('EXPO_PUBLIC_API_URL=https://api-cloudcoffee.inf.uct.cl');
      expect(contenido).not.toContain('192.168.100.59');
    }
  });

  it('deriva el endpoint STOMP de /v1/notifications/ws', () => {
    const api = leer('src/config/api.ts');

    expect(api).toContain("const WS_PATH = '/v1/notifications/ws';");
    expect(api).toMatch(
      /WS_BASE_URL\s*=\s*process\.env\.EXPO_PUBLIC_WS_URL\s*\?\?\s*conPath\(API_BASE_URL,\s*WS_PATH\)/
    );
    expect(api).not.toContain('192.168.100.59');
  });

  it('el layout conecta con el JWT de la sesión y limpia al salir', () => {
    const layout = leer('src/app/_layout.tsx');

    expect(layout).toMatch(/connectWebSocket\(\s*\(\)\s*=>\s*getAccessToken\(\)/);
    expect(layout).toMatch(/return\s*\(\)\s*=>\s*\{\s*disconnectWebSocket\(\);/);
    expect(layout).not.toContain('token_de_prueba');
  });

  it('los hooks consumen el envelope payload, no campos planos', () => {
    const orden = leer('src/hooks/useOrdenEstado.ts');
    const stock = leer('src/hooks/useCafeteriaStock.ts');
    const notificaciones = leer('src/hooks/useNotificacionesStock.ts');

    expect(orden).toContain('evento?.payload?.estado');
    expect(stock).toContain('const payload = evento?.payload;');
    expect(notificaciones).toContain('const payload = evento?.payload;');

    for (const fuente of [orden, stock, notificaciones]) {
      expect(fuente).not.toMatch(/evento\??\.(estado|ofertaId|stockActual)\b/);
    }

    const dominio = leer('src/types/domain.ts');
    expect(dominio).toContain('export interface CloudCoffeeEvent<TPayload>');
    expect(dominio).toContain(
      'export type OrdenEstadoEvento = CloudCoffeeEvent<OrdenEstadoPayload>;'
    );
    expect(dominio).toContain(
      'export type StockCafeteriaEvento = CloudCoffeeEvent<StockCafeteriaPayload>;'
    );
  });
});

describe('INT4-137 · aceptación (comportamiento del cliente)', () => {
  it('SockJS usa el endpoint configurado', () => {
    connectWebSocket('jwt-de-prueba');
    ultimaConfig().webSocketFactory?.();

    expect(WS_BASE_URL).toContain('/v1/notifications/ws');
    expect(SockJSMock).toHaveBeenCalledWith(WS_BASE_URL);
  });

  it('envía el JWT en CONNECT y lo renueva antes de cada intento', () => {
    let token = 'jwt-inicial';
    connectWebSocket(() => token);

    const config = ultimaConfig();
    const instancia = ultimaInstancia();
    expect(config.connectHeaders?.Authorization).toBe('Bearer jwt-inicial');

    token = 'jwt-renovado';
    config.beforeConnect?.(instancia);

    expect(instancia.connectHeaders.Authorization).toBe('Bearer jwt-renovado');
  });

  it('reconecta automáticamente y reaplica las suscripciones vigentes', () => {
    const callback = jest.fn();
    subscribeToTopic(topicCafeteriaStock('cafe-1'), callback);
    expect(ClientMock).not.toHaveBeenCalled();

    connectWebSocket('jwt-de-prueba');
    const instancia = ultimaInstancia();

    expect(ultimaConfig().reconnectDelay).toBe(5000);
    expect(instancia.subscribe).toHaveBeenCalledWith('/topic/cafeteria/cafe-1/stock', callback);

    // @stomp/stompjs vuelve a disparar onConnect después de cada caída.
    instancia.onConnect?.();
    expect(instancia.subscribe).toHaveBeenCalledTimes(2);
  });

  it('al cerrar sesión o desmontar desactiva y limpia todo', () => {
    connectWebSocket('jwt-de-prueba');
    const instancia = ultimaInstancia();
    const onConnectOriginal = instancia.onConnect;
    const unsubscribe = subscribeToTopic(topicCafeteriaStock('cafe-1'), jest.fn());
    expect(instancia.subscribe).toHaveBeenCalledTimes(1);

    disconnectWebSocket();

    expect(instancia.deactivate).toHaveBeenCalled();
    expect(instancia.onConnect).not.toBe(onConnectOriginal);

    unsubscribe();
    instancia.onConnect?.();
    expect(instancia.subscribe).toHaveBeenCalledTimes(1);
  });

  it('no abre conexión sin JWT', () => {
    const onEstado = jest.fn();
    connectWebSocket(() => null, onEstado);

    expect(ClientMock).not.toHaveBeenCalled();
    expect(onEstado).toHaveBeenCalledWith(expect.objectContaining({ conectado: false }));
  });
});

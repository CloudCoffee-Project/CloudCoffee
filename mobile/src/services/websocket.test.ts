// src/services/websocket.test.ts
import { Client } from '@stomp/stompjs';
import type { IFrame } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

import { WS_BASE_URL } from '../config/api';
import {
  connectWebSocket,
  disconnectWebSocket,
  subscribeToTopic,
  topicCafeteriaStock,
  topicOrdenEstado,
} from './websocket';

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

function ultimaConfig(): ConfigMock {
  return ClientMock.mock.calls[ClientMock.mock.calls.length - 1]?.[0];
}

function ultimaInstancia(): StompClientMock {
  return ClientMock.mock.instances[ClientMock.mock.instances.length - 1];
}

describe('websocket service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    disconnectWebSocket();
  });

  it('configura reconnectDelay en 5000ms para reconexión automática', () => {
    connectWebSocket('token-de-prueba');

    expect(Client).toHaveBeenCalledWith(expect.objectContaining({ reconnectDelay: 5000 }));
  });

  it('envía el accessToken como header de autorización', () => {
    connectWebSocket('mi-token-123');

    expect(ultimaConfig().connectHeaders?.Authorization).toBe('Bearer mi-token-123');
  });

  it('usa el endpoint /v1/notifications/ws centralizado en config/api', () => {
    expect(WS_BASE_URL).toContain('/v1/notifications/ws');

    connectWebSocket('token-de-prueba');
    ultimaConfig().webSocketFactory?.();

    expect(SockJSMock).toHaveBeenCalledWith(WS_BASE_URL);
  });

  it('notifica el estado conectado vía callback', () => {
    const onEstado = jest.fn();
    connectWebSocket('token-de-prueba', onEstado);

    expect(onEstado).toHaveBeenCalledWith({ conectado: true });
  });

  it('no crea el cliente si no hay token', () => {
    const onEstado = jest.fn();
    connectWebSocket(() => null, onEstado);

    expect(Client).not.toHaveBeenCalled();
    expect(onEstado).toHaveBeenCalledWith(expect.objectContaining({ conectado: false }));
  });

  it('centraliza los topics STOMP del dominio', () => {
    expect(topicOrdenEstado('orden-1')).toBe('/topic/orden/orden-1/estado');
    expect(topicCafeteriaStock('cafe-1')).toBe('/topic/cafeteria/cafe-1/stock');
  });

  it('aplica una suscripción pendiente al conectar y la reaplica al reconectar', () => {
    const callback = jest.fn();
    const unsubscribe = subscribeToTopic(topicCafeteriaStock('cafe-1'), callback);

    connectWebSocket('token-de-prueba');
    const instancia = ultimaInstancia();
    expect(instancia.subscribe).toHaveBeenCalledWith('/topic/cafeteria/cafe-1/stock', callback);

    // Simula el onConnect que @stomp/stompjs dispara después de una caída.
    instancia.onConnect?.();
    expect(instancia.subscribe).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it('la limpieza de una suscripción evita que se reaplique al reconectar', () => {
    connectWebSocket('token-de-prueba');
    const instancia = ultimaInstancia();

    const unsubscribe = subscribeToTopic(topicCafeteriaStock('cafe-1'), jest.fn());
    expect(instancia.subscribe).toHaveBeenCalledTimes(1);

    unsubscribe();
    instancia.onConnect?.();

    expect(instancia.subscribe).toHaveBeenCalledTimes(1);
  });

  it('renueva el JWT antes de cada intento de conexión', () => {
    let token = 'token-inicial';
    connectWebSocket(() => token);

    const config = ultimaConfig();
    const instancia = ultimaInstancia();
    expect(instancia.connectHeaders.Authorization).toBe('Bearer token-inicial');

    token = 'token-renovado';
    config.beforeConnect?.(instancia);

    expect(instancia.connectHeaders.Authorization).toBe('Bearer token-renovado');
  });

  it('disconnectWebSocket desactiva el cliente y limpia las suscripciones', () => {
    connectWebSocket('token-de-prueba');
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
});

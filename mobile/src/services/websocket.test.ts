// src/services/websocket.test.ts
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

import { WS_BASE_URL } from '../config/api';
import {
  connectWebSocket,
  disconnectWebSocket,
  subscribeToTopic,
  topicCafeteriaStock,
  topicOrdenEstado,
} from './websocket';

interface StompClientMock {
  config: unknown;
  connected: boolean;
  subscribe: jest.Mock;
  activate: jest.Mock;
  deactivate: jest.Mock;
  onConnect?: () => void;
}

jest.mock('@stomp/stompjs', () => ({
  Client: jest.fn().mockImplementation(function MockClient(this: StompClientMock, config: unknown) {
    this.config = config;
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

function ultimaConfig(): { connectHeaders: { Authorization: string } } {
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

  it('configura reconnectDelay en 5000ms para reconexion automatica', () => {
    connectWebSocket('token-de-prueba');

    expect(Client).toHaveBeenCalledWith(expect.objectContaining({ reconnectDelay: 5000 }));
  });

  it('envia el accessToken como header de autorizacion', () => {
    connectWebSocket('mi-token-123');

    expect(ultimaConfig().connectHeaders.Authorization).toBe('Bearer mi-token-123');
  });

  it('usa la URL base de WebSocket centralizada en config/api', () => {
    connectWebSocket('token-de-prueba');

    const config = ultimaConfig() as unknown as { webSocketFactory: () => void };
    config.webSocketFactory();

    expect(SockJSMock).toHaveBeenCalledWith(WS_BASE_URL);
  });

  it('notifica el estado conectado via callback', () => {
    const onEstado = jest.fn();
    connectWebSocket('token-de-prueba', onEstado);

    expect(onEstado).toHaveBeenCalledWith({ conectado: true });
  });

  it('centraliza los topics STOMP del dominio', () => {
    expect(topicOrdenEstado('orden-1')).toBe('/topic/orden/orden-1/estado');
    expect(topicCafeteriaStock('cafe-1')).toBe('/topic/cafeteria/cafe-1/stock');
  });

  it('guarda una suscripcion pendiente si se llama antes de conectar, y la aplica al conectar', () => {
    const callback = jest.fn();

    const unsubscribe = subscribeToTopic(topicCafeteriaStock('cafe-1'), callback);
    expect(typeof unsubscribe).toBe('function');

    connectWebSocket('token-de-prueba');

    expect(ultimaInstancia().subscribe).toHaveBeenCalledWith(
      '/topic/cafeteria/cafe-1/stock',
      callback
    );
  });

  it('disconnectWebSocket limpia el cliente y las suscripciones pendientes', () => {
    connectWebSocket('token-de-prueba');
    disconnectWebSocket();

    subscribeToTopic(topicCafeteriaStock('cafe-1'), jest.fn());

    const instancia = ultimaInstancia();
    if (instancia) {
      expect(instancia.subscribe).not.toHaveBeenCalled();
    }
  });
});

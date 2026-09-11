// src/services/websocket.test.ts
import { connectWebSocket, disconnectWebSocket, subscribeToTopic } from './websocket';

jest.mock('@stomp/stompjs', () => {
  return {
    Client: jest.fn().mockImplementation(function (this: any, config: any) {
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
  };
});

jest.mock('sockjs-client', () => jest.fn());

describe('websocket service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    disconnectWebSocket();
  });

  it('configura reconnectDelay en 5000ms para reconexion automatica', () => {
    const { Client } = require('@stomp/stompjs');
    connectWebSocket('token-de-prueba');

    expect(Client).toHaveBeenCalledWith(
      expect.objectContaining({ reconnectDelay: 5000 })
    );
  });

  it('envia el accessToken como header de autorizacion', () => {
    const { Client } = require('@stomp/stompjs');
    connectWebSocket('mi-token-123');

    const config = Client.mock.calls[Client.mock.calls.length - 1][0];
    expect(config.connectHeaders.Authorization).toBe('Bearer mi-token-123');
  });

  it('llama onConnected cuando el cliente conecta exitosamente', () => {
    const onConnected = jest.fn();
    connectWebSocket('token-de-prueba', onConnected);

    expect(onConnected).toHaveBeenCalled();
  });

  it('guarda una suscripcion pendiente si se llama antes de conectar, y la aplica al conectar', () => {
    const { Client } = require('@stomp/stompjs');
    const callback = jest.fn();

    const unsubscribe = subscribeToTopic('/topic/cafeteria/1/stock', callback);
    expect(typeof unsubscribe).toBe('function');

    connectWebSocket('token-de-prueba');

    const ultimaInstancia = Client.mock.instances[Client.mock.instances.length - 1];
    expect(ultimaInstancia.subscribe).toHaveBeenCalledWith(
      '/topic/cafeteria/1/stock',
      callback
    );
  });

  it('disconnectWebSocket limpia el cliente y las suscripciones pendientes', () => {
    connectWebSocket('token-de-prueba');
    disconnectWebSocket();

    const callback = jest.fn();
    subscribeToTopic('/topic/cafeteria/1/stock', callback);

    const { Client } = require('@stomp/stompjs');
    const ultimaInstancia = Client.mock.instances[Client.mock.instances.length - 1];
    if (ultimaInstancia) {
      expect(ultimaInstancia.subscribe).not.toHaveBeenCalled();
    }
  });
});
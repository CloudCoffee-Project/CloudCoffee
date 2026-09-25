// src/__tests__/banner-notificacion-push.test.tsx
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import BannerNotificacionPush from '../components/BannerNotificacionPush';
import type { NotificacionRecibida } from '../hooks/useNotificacionesPush';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

const notificacion: NotificacionRecibida = {
  titulo: 'Pedido listo',
  cuerpo: 'Tu café está listo para retirar.',
  url: null,
};

// Texto conjunto que renderiza el banner (vacío cuando el banner está oculto).
function textosDe(tree: ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .map((nodo) => nodo.props.children)
    .join('|');
}

test('no muestra nada cuando no hay notificación', () => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<BannerNotificacionPush notificacion={null} onAbrir={jest.fn()} />);
  });

  expect(textosDe(tree)).toBe('');
  act(() => tree.unmount());
});

test('muestra la notificación recibida en primer plano', () => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<BannerNotificacionPush notificacion={notificacion} onAbrir={jest.fn()} />);
  });

  const textos = textosDe(tree);
  expect(textos).toContain('Pedido listo');
  expect(textos).toContain('Tu café está listo para retirar.');
  act(() => tree.unmount());
});

test('se oculta sola después de la duración', () => {
  jest.useFakeTimers();
  try {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<BannerNotificacionPush notificacion={notificacion} onAbrir={jest.fn()} />);
    });
    expect(textosDe(tree)).toContain('Pedido listo');

    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(textosDe(tree)).toBe('');
    act(() => tree.unmount());
  } finally {
    jest.useRealTimers();
  }
});

test('al tocarla navega a la url interna y se cierra', () => {
  const onAbrir = jest.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <BannerNotificacionPush
        notificacion={{ ...notificacion, url: '/(cliente)/mis-compras' }}
        onAbrir={onAbrir}
      />
    );
  });

  const banner = tree.root.findAll((nodo) => nodo.props.testID === 'banner-notificacion')[0];
  act(() => {
    banner.props.onPress();
  });

  expect(onAbrir).toHaveBeenCalledWith('/(cliente)/mis-compras');
  expect(textosDe(tree)).toBe('');
  act(() => tree.unmount());
});

test('sin url al tocarla solo se cierra y no navega', () => {
  const onAbrir = jest.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<BannerNotificacionPush notificacion={notificacion} onAbrir={onAbrir} />);
  });

  const banner = tree.root.findAll((nodo) => nodo.props.testID === 'banner-notificacion')[0];
  act(() => {
    banner.props.onPress();
  });

  expect(onAbrir).not.toHaveBeenCalled();
  expect(textosDe(tree)).toBe('');
  act(() => tree.unmount());
});

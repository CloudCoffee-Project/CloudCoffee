// src/__tests__/auth-token-desde-url.test.tsx
//
// INT4-105: el enlace que llega por correo trae el token en la URL y ambas
// pantallas deben abrirlo ya cargado, dejando la entrada manual como
// alternativa. Criterio de listo: "ambos enlaces abren la pantalla con el
// token cargado".
//
// El correo llega como cloudcoffee://verificar-correo?token=... o
// cloudcoffee://restaurar-contrasena?token=..., así que el parámetro se lee
// con useLocalSearchParams (expo-router v57: params de tipo
// string | string[]). El mock de expo-router devuelve el objeto de params de
// cada prueba y se verifica que el valor llegue al TextInput y que el campo
// siga siendo editable para quien prefiera pegarlo a mano.

import { act, create } from 'react-test-renderer';
import type { ComponentType } from 'react';
import type { ReactTestRenderer } from 'react-test-renderer';

import VerificarCorreoScreen from '../app/(auth)/verificar-correo';
import RestaurarContrasenaScreen from '../app/(auth)/restaurar-contrasena';

const mockParams: Record<string, string | string[]> = {};

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ replace: jest.fn(), push: jest.fn() })),
  useLocalSearchParams: jest.fn(() => mockParams),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

// Las pantallas solo importan estas funciones del servicio; el flujo de red
// real no es parte de estas pruebas (ya lo cubre auth-flujo-completo).
jest.mock('../services/auth', () => ({
  verificarCorreo: jest.fn(),
  reenviarVerificacion: jest.fn(),
  restablecerPassword: jest.fn(),
}));

async function renderizarPantalla(Pantalla: ComponentType): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Pantalla />);
  });
  return tree;
}

function limpiarParams(): void {
  for (const clave of Object.keys(mockParams)) {
    delete mockParams[clave];
  }
}

describe('Verificar correo — token precargado desde la URL (INT4-105)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    limpiarParams();
  });

  it('abre la pantalla con el token del enlace ya cargado', async () => {
    mockParams.token = 'token-del-correo-123';

    const tree = await renderizarPantalla(VerificarCorreoScreen);

    expect(tree.root.findByProps({ testID: 'token-verificacion' }).props.value).toBe(
      'token-del-correo-123'
    );
  });

  it('recorta los espacios que el enlace traiga alrededor del token', async () => {
    mockParams.token = '  token-con-espacios  ';

    const tree = await renderizarPantalla(VerificarCorreoScreen);

    expect(tree.root.findByProps({ testID: 'token-verificacion' }).props.value).toBe(
      'token-con-espacios'
    );
  });

  it('usa el primer valor si el enlace repite el parámetro', async () => {
    mockParams.token = ['token-uno', 'token-dos'];

    const tree = await renderizarPantalla(VerificarCorreoScreen);

    expect(tree.root.findByProps({ testID: 'token-verificacion' }).props.value).toBe('token-uno');
  });

  it('deja el campo vacío y editable cuando el enlace no trae token', async () => {
    const tree = await renderizarPantalla(VerificarCorreoScreen);
    const campo = tree.root.findByProps({ testID: 'token-verificacion' });

    expect(campo.props.value).toBe('');
    expect(campo.props.editable).toBe(true);
  });

  it('permite seguir escribiendo a mano sobre el token precargado', async () => {
    mockParams.token = 'token-original';

    const tree = await renderizarPantalla(VerificarCorreoScreen);
    await act(async () => {
      tree.root.findByProps({ testID: 'token-verificacion' }).props.onChangeText('token-a-mano');
    });

    expect(tree.root.findByProps({ testID: 'token-verificacion' }).props.value).toBe(
      'token-a-mano'
    );
  });
});

describe('Restaurar contraseña — token precargado desde la URL (INT4-105)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    limpiarParams();
  });

  it('abre la pantalla con el token del enlace ya cargado', async () => {
    mockParams.token = 'token-de-recuperacion-456';

    const tree = await renderizarPantalla(RestaurarContrasenaScreen);

    expect(tree.root.findByProps({ testID: 'token-recuperacion' }).props.value).toBe(
      'token-de-recuperacion-456'
    );
  });

  it('recorta los espacios que el enlace traiga alrededor del token', async () => {
    mockParams.token = '  token-con-espacios  ';

    const tree = await renderizarPantalla(RestaurarContrasenaScreen);

    expect(tree.root.findByProps({ testID: 'token-recuperacion' }).props.value).toBe(
      'token-con-espacios'
    );
  });

  it('usa el primer valor si el enlace repite el parámetro', async () => {
    mockParams.token = ['token-uno', 'token-dos'];

    const tree = await renderizarPantalla(RestaurarContrasenaScreen);

    expect(tree.root.findByProps({ testID: 'token-recuperacion' }).props.value).toBe('token-uno');
  });

  it('deja el campo vacío y editable cuando el enlace no trae token', async () => {
    const tree = await renderizarPantalla(RestaurarContrasenaScreen);
    const campo = tree.root.findByProps({ testID: 'token-recuperacion' });

    expect(campo.props.value).toBe('');
    expect(campo.props.editable).toBe(true);
  });

  it('permite seguir escribiendo a mano sobre el token precargado', async () => {
    mockParams.token = 'token-original';

    const tree = await renderizarPantalla(RestaurarContrasenaScreen);
    await act(async () => {
      tree.root.findByProps({ testID: 'token-recuperacion' }).props.onChangeText('token-a-mano');
    });

    expect(tree.root.findByProps({ testID: 'token-recuperacion' }).props.value).toBe(
      'token-a-mano'
    );
  });
});

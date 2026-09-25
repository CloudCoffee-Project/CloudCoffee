// src/__tests__/cliente-cambiar-contrasena.test.tsx
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import CambiarContrasenaScreen, {
  PASSWORD_MIN,
  validarCambioContrasena,
} from '../app/(cliente)/cambiar-contrasena';
import { cambiarContrasena } from '../services/auth';
import { useRouter } from 'expo-router';
import { ApiError } from '../services/httpClient';

jest.mock('../services/auth', () => ({
  cambiarContrasena: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ back: jest.fn(), push: jest.fn() })),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

const mockCambiarContrasena = cambiarContrasena as unknown as jest.Mock;
const mockUseRouter = useRouter as unknown as jest.Mock;

function textoDe(nodo: ReactTestInstance): string {
  return nodo.children
    .map((hijo) => (typeof hijo === 'string' ? hijo : textoDe(hijo as ReactTestInstance)))
    .join('');
}

async function renderizarPantalla(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<CambiarContrasenaScreen />);
  });
  return tree;
}

async function enviarFormulario(valores: {
  actual?: string;
  nueva?: string;
  confirmar?: string;
}): Promise<ReactTestRenderer> {
  const tree = await renderizarPantalla();

  await act(async () => {
    if (valores.actual) {
      tree.root.findByProps({ testID: 'contrasena-actual' }).props.onChangeText(valores.actual);
    }
    if (valores.nueva) {
      tree.root.findByProps({ testID: 'nueva-contrasena' }).props.onChangeText(valores.nueva);
    }
    if (valores.confirmar) {
      tree.root
        .findByProps({ testID: 'confirmar-contrasena' })
        .props.onChangeText(valores.confirmar);
    }
  });

  await act(async () => {
    tree.root.findByProps({ testID: 'guardar-cambio' }).props.onPress();
  });

  return tree;
}

describe('validarCambioContrasena (INT4-24)', () => {
  it('rechaza sin contraseña actual', () => {
    expect(
      validarCambioContrasena({
        passwordActual: '',
        nuevaPassword: 'nueva-12345',
        confirmarPassword: 'nueva-12345',
      })
    ).toBe('actual');
  });

  it(`rechaza la nueva contraseña menor a ${PASSWORD_MIN} caracteres`, () => {
    expect(
      validarCambioContrasena({
        passwordActual: 'vieja-123',
        nuevaPassword: 'corta',
        confirmarPassword: 'corta',
      })
    ).toBe('nueva-longitud');
  });

  it('rechaza cuando la confirmación no coincide', () => {
    expect(
      validarCambioContrasena({
        passwordActual: 'vieja-123',
        nuevaPassword: 'nueva-12345',
        confirmarPassword: 'otra-12345',
      })
    ).toBe('coinciden');
  });

  it('acepta el formulario válido', () => {
    expect(
      validarCambioContrasena({
        passwordActual: 'vieja-123',
        nuevaPassword: 'nueva-12345',
        confirmarPassword: 'nueva-12345',
      })
    ).toBeNull();
  });
});

describe('CambiarContrasenaScreen (INT4-24)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCambiarContrasena.mockResolvedValue(undefined);
    mockUseRouter.mockReturnValue({ back: jest.fn(), push: jest.fn() });
  });

  it('muestra el header y el formulario', async () => {
    const tree = await renderizarPantalla();

    expect(textoDe(tree.root)).toContain('Cambiar Contraseña');
    expect(textoDe(tree.root)).toContain('SEGURIDAD');
    expect(tree.root.findByProps({ testID: 'contrasena-actual' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'nueva-contrasena' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'confirmar-contrasena' })).toBeTruthy();
  });

  it('muestra error de validación sin llamar a la API', async () => {
    const tree = await enviarFormulario({
      actual: 'vieja-123',
      nueva: 'corta',
      confirmar: 'corta',
    });

    expect(textoDe(tree.root)).toContain(`al menos ${PASSWORD_MIN} caracteres`);
    expect(mockCambiarContrasena).not.toHaveBeenCalled();
  });

  it('llama a cambiarContrasena y muestra el estado de éxito', async () => {
    const tree = await enviarFormulario({
      actual: 'vieja-123',
      nueva: 'nueva-12345',
      confirmar: 'nueva-12345',
    });

    expect(mockCambiarContrasena).toHaveBeenCalledWith({
      passwordActual: 'vieja-123',
      nuevaPassword: 'nueva-12345',
    });
    expect(textoDe(tree.root)).toContain('Contraseña Cambiada');
    expect(tree.root.findByProps({ testID: 'volver-de-exito' })).toBeTruthy();
  });

  it('muestra el error de la API cuando falla', async () => {
    mockCambiarContrasena.mockRejectedValue(
      new ApiError('La contraseña actual es incorrecta.', 400)
    );

    const tree = await enviarFormulario({
      actual: 'incorrecta',
      nueva: 'nueva-12345',
      confirmar: 'nueva-12345',
    });

    expect(textoDe(tree.root)).toContain('La contraseña actual es incorrecta.');
    expect(tree.root.findByProps({ testID: 'error-cambio' })).toBeTruthy();
  });
});

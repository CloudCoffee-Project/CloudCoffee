// src/__tests__/cliente-perfil.test.tsx
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import PerfilScreen, { validarPerfil } from '../app/(cliente)/perfil';
import { actualizarPerfil, obtenerPerfil } from '../services/auth';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../services/httpClient';
import type { PerfilUsuario } from '../types/domain';

jest.mock('../services/auth', () => ({
  obtenerPerfil: jest.fn(),
  actualizarPerfil: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
}));

jest.mock('../context/AuthContext', () => ({
  useAuth: jest.fn(() => ({ cerrarSesion: jest.fn() })),
}));

const mockObtenerPerfil = obtenerPerfil as unknown as jest.Mock;
const mockActualizarPerfil = actualizarPerfil as unknown as jest.Mock;
const mockUseRouter = useRouter as unknown as jest.Mock;
const mockUseAuth = useAuth as unknown as jest.Mock;

const perfilMock: PerfilUsuario = {
  id: 'uuid-1',
  email: 'ana.perez@uct.cl',
  nombre: 'Ana',
  apellido: 'Pérez',
  telefono: '+56 9 1234 5678',
  rol: 'CLIENTE',
  verificado: true,
};

function textoDe(nodo: ReactTestInstance): string {
  return nodo.children
    .map((hijo) => (typeof hijo === 'string' ? hijo : textoDe(hijo as ReactTestInstance)))
    .join('');
}

async function renderizarPerfil(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<PerfilScreen />);
  });
  // Deja resolver la promesa del GET inicial (setPerfil) dentro del act.
  await act(async () => {});
  return tree;
}

async function irAEdicion(tree: ReactTestRenderer): Promise<void> {
  const btn = tree.root.findByProps({ testID: 'editar-perfil' });
  await act(async () => {
    btn.props.onPress();
  });
}

async function pulsar(tree: ReactTestRenderer, testID: string): Promise<void> {
  const nodo = tree.root.findByProps({ testID });
  await act(async () => {
    nodo.props.onPress();
  });
}

describe('validarPerfil', () => {
  it('acepta un perfil válido', () => {
    expect(
      validarPerfil({ nombre: 'Ana', apellido: 'Pérez', telefono: '+56 9 1234 5678' })
    ).toEqual({});
  });

  it('exige los tres campos', () => {
    expect(validarPerfil({ nombre: '  ', apellido: '', telefono: '' })).toEqual({
      nombre: 'Ingresa tu nombre.',
      apellido: 'Ingresa tu apellido.',
      telefono: 'Ingresa tu teléfono.',
    });
  });

  it('exige nombre y apellido de máximo 100 caracteres', () => {
    const errores = validarPerfil({
      nombre: 'A'.repeat(101),
      apellido: 'B'.repeat(101),
      telefono: '987654321',
    });

    expect(errores.nombre).toContain('100');
    expect(errores.apellido).toContain('100');
  });

  it('rechaza teléfonos con formato inválido', () => {
    for (const invalido of ['abc', '12', '1'.repeat(21), 'nan', 'tel $']) {
      expect(
        validarPerfil({ nombre: 'Ana', apellido: 'Pérez', telefono: invalido }).telefono
      ).toBeDefined();
    }
  });

  it('acepta formatos de teléfono válidos', () => {
    for (const valido of ['+56 9 1234 5678', '987654321', '(45) 2 123456', '12 34 56', '987654']) {
      expect(validarPerfil({ nombre: 'Ana', apellido: 'Pérez', telefono: valido })).toEqual({});
    }
  });
});

describe('Pantalla Mi Perfil', () => {
  beforeEach(() => {
    mockObtenerPerfil.mockReset();
    mockActualizarPerfil.mockReset();
    mockUseAuth.mockReset();
    mockUseRouter.mockReset();
    mockUseRouter.mockReturnValue({ push: jest.fn() });
    mockUseAuth.mockReturnValue({ cerrarSesion: jest.fn() });
  });

  it('muestra los datos del perfil en la vista', async () => {
    mockObtenerPerfil.mockResolvedValue(perfilMock);

    const tree = await renderizarPerfil();

    const vista = tree.root.findByProps({ testID: 'perfil-vista' });
    expect(textoDe(vista)).toContain('Ana');
    expect(textoDe(vista)).toContain('Pérez');
    expect(textoDe(vista)).toContain('ana.perez@uct.cl');
    expect(textoDe(vista)).toContain('+56 9 1234 5678');

    act(() => tree.unmount());
  });

  it('muestra el error de carga con opción de reintentar', async () => {
    mockObtenerPerfil.mockRejectedValue(new ApiError('Servicio no disponible', 503));

    const tree = await renderizarPerfil();

    const error = tree.root.findByProps({ testID: 'perfil-error' });
    expect(textoDe(error)).toContain('Servicio no disponible');

    mockObtenerPerfil.mockResolvedValue(perfilMock);
    await pulsar(tree, 'reintentar-perfil');

    expect(tree.root.findByProps({ testID: 'perfil-vista' })).toBeDefined();

    act(() => tree.unmount());
  });

  it('abre la edición con los datos precargados', async () => {
    mockObtenerPerfil.mockResolvedValue(perfilMock);

    const tree = await renderizarPerfil();
    await irAEdicion(tree);

    const nombre = tree.root.findByProps({ testID: 'campo-nombre' });
    expect(nombre.props.value).toBe('Ana');
    expect(tree.root.findByProps({ testID: 'campo-telefono' }).props.value).toBe('+56 9 1234 5678');

    act(() => tree.unmount());
  });

  it('valida el formulario antes de guardar y no llama a la API', async () => {
    mockObtenerPerfil.mockResolvedValue(perfilMock);

    const tree = await renderizarPerfil();
    await irAEdicion(tree);

    const apellido = tree.root.findByProps({ testID: 'campo-apellido' });
    await act(async () => {
      apellido.props.onChangeText('');
    });

    await pulsar(tree, 'guardar-edicion');

    expect(mockActualizarPerfil).not.toHaveBeenCalled();
    const form = tree.root.findByProps({ testID: 'perfil-edicion' });
    expect(textoDe(form)).toContain('Ingresa tu apellido.');

    act(() => tree.unmount());
  });

  it('guarda el perfil y vuelve a la vista con el banner de éxito', async () => {
    mockObtenerPerfil.mockResolvedValue(perfilMock);
    const perfilActualizado = { ...perfilMock, nombre: 'Ana María', telefono: '+56 9 8888 7777' };
    mockActualizarPerfil.mockResolvedValue(perfilActualizado);

    const tree = await renderizarPerfil();
    await irAEdicion(tree);

    const nombre = tree.root.findByProps({ testID: 'campo-nombre' });
    await act(async () => {
      nombre.props.onChangeText('Ana María');
    });
    const telefono = tree.root.findByProps({ testID: 'campo-telefono' });
    await act(async () => {
      telefono.props.onChangeText('+56 9 8888 7777');
    });

    await pulsar(tree, 'guardar-edicion');

    expect(mockActualizarPerfil).toHaveBeenCalledWith({
      nombre: 'Ana María',
      apellido: 'Pérez',
      telefono: '+56 9 8888 7777',
    });
    const exito = tree.root.findByProps({ testID: 'banner-exito' });
    expect(textoDe(exito)).toContain('Perfil actualizado');
    const vista = tree.root.findByProps({ testID: 'perfil-vista' });
    expect(textoDe(vista)).toContain('Ana María');

    act(() => tree.unmount());
  });

  it('muestra el error normalizado si falla el guardado', async () => {
    mockObtenerPerfil.mockResolvedValue(perfilMock);
    mockActualizarPerfil.mockRejectedValue(new ApiError('Teléfono inválido', 400));

    const tree = await renderizarPerfil();
    await irAEdicion(tree);
    await pulsar(tree, 'guardar-edicion');

    const form = tree.root.findByProps({ testID: 'perfil-edicion' });
    expect(textoDe(form)).toContain('Teléfono inválido');

    act(() => tree.unmount());
  });

  it('navega a cambiar-contrasena desde el botón del mockup', async () => {
    mockObtenerPerfil.mockResolvedValue(perfilMock);
    const mockPush = jest.fn();
    mockUseRouter.mockReturnValue({ push: mockPush });

    const tree = await renderizarPerfil();
    await pulsar(tree, 'cambiar-contrasena');

    expect(mockPush).toHaveBeenCalledWith('/(cliente)/cambiar-contrasena');

    act(() => tree.unmount());
  });

  it('navega a mis-seguimientos desde el botón del mockup', async () => {
    mockObtenerPerfil.mockResolvedValue(perfilMock);
    const mockPush = jest.fn();
    mockUseRouter.mockReturnValue({ push: mockPush });

    const tree = await renderizarPerfil();
    await pulsar(tree, 'mis-seguimientos');

    expect(mockPush).toHaveBeenCalledWith('/(cliente)/mis-seguimientos');

    act(() => tree.unmount());
  });

  it('cierra sesión desde el botón del footer', async () => {
    mockObtenerPerfil.mockResolvedValue(perfilMock);
    const mockCerrarSesion = jest.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({ cerrarSesion: mockCerrarSesion });

    const tree = await renderizarPerfil();
    await pulsar(tree, 'cerrar-sesion');

    expect(mockCerrarSesion).toHaveBeenCalled();

    act(() => tree.unmount());
  });
});

// src/context/CarritoContext.test.tsx
// Cubre el estado global del carrito (INT4-32): que la identidad de una línea
// sea la oferta, que agregar dos veces la misma Cafetería sume en vez de
// duplicar, que ninguna línea pase el stock conocido, que los derivados
// (unidades, total) salgan de las líneas, y que el carrito se vacíe al cambiar
// de sesión para que el de uno no leaks al del siguiente en un equipo compartido.
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';

import { CarritoProvider, useCarrito } from './CarritoContext';
import type { NuevoItemCarrito, SesionDecodificada } from '../types/domain';

// El provider solo necesita saber quién tiene la sesión abierta, así que se
// mockea AuthContext en vez de levantar el provider real con sus tokens.
const mockUseAuth = jest.fn();
jest.mock('./AuthContext', () => ({ useAuth: () => mockUseAuth() }));

type ValorCarrito = ReturnType<typeof useCarrito>;

let arbol: ReactTestRenderer | null = null;

// La sonda deja el carrito en las props de un nodo del árbol en vez de guardarlo
// en una variable de módulo: asignarla durante el render es un efecto y el
// compilador de React lo rechaza. Así el test lo lee de donde quedó.
function Sonda() {
  const valor = useCarrito();
  return <View testID="carrito-sonda" {...valor} />;
}

function carrito(): ValorCarrito {
  if (arbol === null) throw new Error('no hay carrito montado');
  return arbol.root.findAllByProps({ testID: 'carrito-sonda' })[0].props as ValorCarrito;
}

function sesionDe(userId: string): SesionDecodificada {
  return { userId, rol: 'cliente', cafeteriaId: null, exp: 0 };
}

function nuevo(over: Partial<NuevoItemCarrito> = {}): NuevoItemCarrito {
  return {
    ofertaId: 'of-central',
    productoId: 'prod-1',
    productoNombre: 'Café Americano 12oz',
    precioUnitario: 1800,
    cafeteriaId: 'cafe-central',
    cafeteriaNombre: 'Cafetería Central',
    stock: 5,
    ...over,
  };
}

function montar(sesion: SesionDecodificada | null = sesionDe('user-1')): ReactTestRenderer {
  mockUseAuth.mockReturnValue({
    sesion,
    bootstrapping: false,
    iniciarSesion: jest.fn(),
    cerrarSesion: jest.fn(),
  });
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <CarritoProvider>
        <Sonda />
      </CarritoProvider>
    );
  });
  arbol = tree;
  return tree;
}

function agregar(item: NuevoItemCarrito, cantidad: number): void {
  act(() => carrito().agregar(item, cantidad));
}

function cambiarCantidad(ofertaId: string, cantidad: number): void {
  act(() => carrito().cambiarCantidad(ofertaId, cantidad));
}

function quitar(ofertaId: string): void {
  act(() => carrito().quitar(ofertaId));
}

beforeEach(() => {
  arbol = null;
  mockUseAuth.mockReset();
});

describe('Carrito global (INT4-32)', () => {
  it('empieza vacío', () => {
    montar();

    expect(carrito().items).toEqual([]);
    expect(carrito().total).toBe(0);
    expect(carrito().unidades).toBe(0);
  });

  it('agrega una línea con su cantidad y calcula total y unidades', () => {
    montar();

    agregar(nuevo(), 2);

    expect(carrito().items).toEqual([{ ...nuevo(), cantidad: 2 }]);
    expect(carrito().total).toBe(3600);
    expect(carrito().unidades).toBe(2);
  });

  it('suma en la misma línea al agregar dos veces la misma oferta', () => {
    montar();

    agregar(nuevo(), 1);
    agregar(nuevo(), 2);

    expect(carrito().items).toHaveLength(1);
    expect(carrito().items[0].cantidad).toBe(3);
    expect(carrito().total).toBe(5400);
  });

  it('abre otra línea si el mismo producto se compra en otra cafetería', () => {
    montar();

    agregar(nuevo(), 1);
    agregar(
      nuevo({ ofertaId: 'of-norte', cafeteriaNombre: 'Cafetería Norte', precioUnitario: 2100 }),
      1
    );

    // Se retiran en puntos distintos, así que no se pueden sumar.
    expect(carrito().items).toHaveLength(2);
    expect(carrito().total).toBe(3900);
    expect(carrito().unidades).toBe(2);
  });

  it('no deja que una línea pase del stock conocido', () => {
    montar();

    agregar(nuevo({ stock: 5 }), 3);
    agregar(nuevo({ stock: 5 }), 4);

    expect(carrito().items[0].cantidad).toBe(5);
  });

  it('no agrega una oferta sin stock ni una cantidad no positiva', () => {
    montar();

    agregar(nuevo({ stock: 0 }), 1);
    agregar(nuevo({ ofertaId: 'of-norte' }), 0);
    agregar(nuevo({ ofertaId: 'of-norte' }), -3);

    expect(carrito().items).toEqual([]);
  });

  it('cantidadDe devuelve lo que hay de cada oferta y 0 si no está', () => {
    montar();

    agregar(nuevo({ stock: 5 }), 3);
    agregar(nuevo({ ofertaId: 'of-kiosko', cafeteriaId: 'cafe-kiosko' }), 1);

    expect(carrito().cantidadDe('of-central')).toBe(3);
    expect(carrito().cantidadDe('of-kiosko')).toBe(1);
    expect(carrito().cantidadDe('of-inexistente')).toBe(0);
  });

  it('cantidadDe sigue a la línea cuando sube, baja o se quita', () => {
    montar();

    agregar(nuevo({ stock: 5 }), 2);
    expect(carrito().cantidadDe('of-central')).toBe(2);

    cambiarCantidad('of-central', 4);
    expect(carrito().cantidadDe('of-central')).toBe(4);

    // Bajar de 1 elimina la línea, así que tampoco queda cantidad.
    cambiarCantidad('of-central', 0);
    expect(carrito().cantidadDe('of-central')).toBe(0);

    agregar(nuevo({ stock: 5 }), 1);
    quitar('of-central');
    expect(carrito().cantidadDe('of-central')).toBe(0);
  });

  it('refresca el precio si el catálogo cambió entre una agregado y otro', () => {
    montar();

    agregar(nuevo({ precioUnitario: 1800 }), 1);
    agregar(nuevo({ precioUnitario: 1900 }), 1);

    // El catálogo manda, no lo que quedó guardado la primera vez.
    expect(carrito().items[0].precioUnitario).toBe(1900);
    expect(carrito().total).toBe(3800);
  });

  it('copia la línea y no guarda el objeto que le pasaron', () => {
    montar();

    const entrada = nuevo();
    agregar(entrada, 1);
    entrada.precioUnitario = 9999;
    entrada.productoNombre = 'Otro producto';

    expect(carrito().items[0].precioUnitario).toBe(1800);
    expect(carrito().items[0].productoNombre).toBe('Café Americano 12oz');
  });

  it('cambia la cantidad de una línea, acotada al stock', () => {
    montar();

    agregar(nuevo({ stock: 4 }), 1);
    act(() => carrito().cambiarCantidad('of-central', 3));
    expect(carrito().items[0].cantidad).toBe(3);

    act(() => carrito().cambiarCantidad('of-central', 9));
    expect(carrito().items[0].cantidad).toBe(4);
  });

  it('quita la línea si la cantidad baja de una unidad', () => {
    montar();

    agregar(nuevo(), 1);
    act(() => carrito().cambiarCantidad('of-central', 0));

    expect(carrito().items).toEqual([]);
  });

  it('quita una línea y deja las otras', () => {
    montar();

    agregar(nuevo(), 1);
    agregar(nuevo({ ofertaId: 'of-norte', precioUnitario: 2100 }), 1);
    act(() => carrito().quitar('of-central'));

    expect(carrito().items).toHaveLength(1);
    expect(carrito().items[0].ofertaId).toBe('of-norte');
  });

  it('vacia el carrito entero', () => {
    montar();

    agregar(nuevo(), 2);
    agregar(nuevo({ ofertaId: 'of-norte', precioUnitario: 2100 }), 1);
    act(() => carrito().vaciar());

    expect(carrito().items).toEqual([]);
    expect(carrito().total).toBe(0);
    expect(carrito().unidades).toBe(0);
  });

  it('se vacía al cerrar sesión, para que el carrito de uno no aparezca al siguiente', () => {
    const tree = montar();
    agregar(nuevo(), 2);
    expect(carrito().items).toHaveLength(1);

    mockUseAuth.mockReturnValue({
      sesion: null,
      bootstrapping: false,
      iniciarSesion: jest.fn(),
      cerrarSesion: jest.fn(),
    });
    act(() => {
      tree.update(
        <CarritoProvider>
          <Sonda />
        </CarritoProvider>
      );
    });

    expect(carrito().items).toEqual([]);
    expect(carrito().total).toBe(0);
  });

  it('se vacía también si cambia el usuario sin pasar por el logout', () => {
    const tree = montar();
    agregar(nuevo(), 2);

    mockUseAuth.mockReturnValue({
      sesion: sesionDe('user-2'),
      bootstrapping: false,
      iniciarSesion: jest.fn(),
      cerrarSesion: jest.fn(),
    });
    act(() => {
      tree.update(
        <CarritoProvider>
          <Sonda />
        </CarritoProvider>
      );
    });

    expect(carrito().items).toEqual([]);
  });

  it('avisa si se usa fuera del provider en vez de devolver un carrito vacío', () => {
    const errorDeConsola = jest.spyOn(console, 'error').mockImplementation(() => {});

    // act y no create a secas: sin él, react-test-renderer difiere el render y el
    // error se reporta después de que terminó el test en vez de Lanzarse acá.
    expect(() =>
      act(() => {
        create(<Sonda />);
      })
    ).toThrow('useCarrito debe usarse dentro de un <CarritoProvider>');

    errorDeConsola.mockRestore();
  });
});

describe('Agrupado por cafetería (lo consume el carrito y el checkout)', () => {
  it('sin líneas no hay grupos', () => {
    montar();

    expect(carrito().grupos).toEqual([]);
  });

  it('arma un grupo por cafetería con líneas, subtotal y unidades acumuladas', () => {
    montar();

    agregar(nuevo({ ofertaId: 'of-central-1', productoNombre: 'Café Americano' }), 2);
    agregar(
      nuevo({ ofertaId: 'of-central-2', productoNombre: 'Té Chai', precioUnitario: 1500 }),
      1
    );

    expect(carrito().grupos).toHaveLength(1);
    const grupo = carrito().grupos[0];

    expect(grupo.cafeteriaId).toBe('cafe-central');
    expect(grupo.cafeteriaNombre).toBe('Cafetería Central');
    expect(grupo.items).toHaveLength(2);
    // 2 x 1.800 + 1 x 1.500
    expect(grupo.subtotal).toBe(5100);
    expect(grupo.unidades).toBe(3);
  });

  it('abre un grupo por punto de retiro y mantiene el orden de la primera vez', () => {
    montar();

    agregar(
      nuevo({
        ofertaId: 'of-norte',
        cafeteriaId: 'cafe-norte',
        cafeteriaNombre: 'Cafetería Norte',
        precioUnitario: 2100,
      }),
      1
    );
    agregar(nuevo(), 1);

    expect(carrito().grupos.map((g) => g.cafeteriaId)).toEqual(['cafe-norte', 'cafe-central']);
    expect(carrito().grupos[0].subtotal).toBe(2100);
    expect(carrito().grupos[1].subtotal).toBe(1800);
  });

  it('quitar la última línea de un grupo hace desaparecer el grupo', () => {
    montar();

    agregar(nuevo(), 1);
    agregar(nuevo({ ofertaId: 'of-norte', cafeteriaId: 'cafe-norte' }), 1);
    act(() => carrito().quitar('of-central'));

    expect(carrito().grupos.map((g) => g.cafeteriaId)).toEqual(['cafe-norte']);
  });
});

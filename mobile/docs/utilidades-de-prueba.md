# Utilidades de prueba compartidas y cobertura

Cómo reutilizar los helpers y los dobles de módulos nativos en las pruebas del
móvil, y cómo se mide la cobertura. Está pensado para que una suite nueva no
vuelva a copiar `textoDe`, los mocks de `expo-router` o el de AsyncStorage.

## Utilidades compartidas

Viven en `mobile/src/test-utils/` y se importan desde el barrel `../test-utils`.
Nada de acá se cuenta en la cobertura (`collectCoverageFrom` los excluye): son
andamiaje de pruebas, no código de producto.

### Lectura del árbol (`texto.ts`)

- `textoDe(nodo)`: texto completo que renderiza un nodo, uniendo strings y
  números de todo el subárbol. Es la versión robusta del `textoDe` que antes
  reimplementaba cada suite.
- `texto(tree, testID)`: texto del nodo con ese `testID`.
- `textosDeTipo(tree, tipo, separador?)`: texto de todos los nodos de un tipo,
  unidos por `separador` (por defecto `|`). Sirve para componentes sin `testID`,
  como el banner de notificaciones.

### Montaje (`render.tsx`)

- `renderizar(elemento)`: monta dentro de `act` y devuelve el árbol.
- `renderizarAsentado(elemento)`: igual, más un turno extra de microtareas para
  las pantallas que cargan datos al montar.
- `desmontar(tree)`: desmonta dentro de `act` (libera suscripciones y timers).

### Interacciones (`interacciones.ts`)

- `buscar(tree, testID)`: primer nodo con ese `testID`.
- `pulsar(tree, testID)`: dispara `onPress` y espera su resultado (las
  pantallas que navegan o llaman al backend usan `onPress` async).
- `escribir(tree, testID, valor)`: dispara `onChangeText`.
- `escribirPorIndice(tree, indice, valor)`: escribe en el n-ésimo `TextInput`;
  para las pantallas de auth, que no les ponen `testID` a sus campos.
- `pulsarPorTexto(tree, texto)`: busca el botón sin `testID` por su texto y sube
  por los padres hasta el primer nodo con `onPress`.

### Dobles de módulos nativos (`mocks.ts`)

- `expoRouterMock`: `useRouter`, `useFocusEffect`, `useIsFocused`,
  `useLocalSearchParams` y el `router` singleton. Devuelve `routerMock`, cuyos
  `push`/`replace`/`back` son `jest.fn` afirmables.
- `routerMock` / `limpiarRouter()`: el router falso y su limpieza entre tests.
- `safeAreaContextMock`: `SafeAreaView` como `View` e `useSafeAreaInsets` en
  cero.
- `crearMockSecureStore()`: fábrica de `expo-secure-store` con un mapa en
  memoria y un `__reset()` propio de cada suite.
- `asyncStorageMock`: superficie de `@react-native-async-storage/async-storage`;
  `getItem` devuelve `null` por defecto.

## Cómo engancharlos

Los mocks se resuelven desde la fábrica de `jest.mock` con `jest.requireActual`
para evitar el error de hoisting de `jest`. Patrón:

```ts
jest.mock('expo-router', () => jest.requireActual('../test-utils').expoRouterMock);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('../test-utils').safeAreaContextMock
);
jest.mock(
  '@react-native-async-storage/async-storage',
  () => jest.requireActual('../test-utils').asyncStorageMock
);

// SecureStore es una fábrica: cada suite necesita su propio almacén.
jest.mock('expo-secure-store', () => jest.requireActual('../test-utils').crearMockSecureStore());
const secureStore = jest.requireMock('expo-secure-store') as { __reset: () => void };
```

`useLocalSearchParams` arranca vacío; la suite que lo necesite lo ajusta con
`(useLocalSearchParams as jest.Mock).mockReturnValue(misParams)`.

## Cobertura

`mobile/package.json` la deja activa por defecto: `jest --coverage` con
`collectCoverageFrom` sobre `src/`, salida `text-summary`/`lcov`/`html`/
`json-summary` en `mobile/coverage/` (ignorada por git) y umbrales globales que
hoy se cumplen con margen:

| Métrica    | Umbral |
| ---------- | ------ |
| Statements | 75     |
| Branches   | 65     |
| Functions  | 76     |
| Lines      | 75     |

- `npm test`: las pruebas con cobertura.
- `npm run test:coverage`: lo mismo, explícito.
- `npm run test:watch`: modo watch.

El CI (`mobile-ci.yml`, fuera de `mobile/`) corre `npm run test -- --ci
--coverage=false` a propósito: ahí solo interesa que las pruebas pasen, no
medir cobertura en cada ejecución.

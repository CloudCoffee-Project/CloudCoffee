// src/config/pagoSimulado.ts
//
// INT4-131: el cliente NO elige si su pago se aprueba, se rechaza o queda
// pendiente. Ese resultado lo decide Order a partir del estado real de la
// compra. El contrato del pago simulado exige un `escenario` en el cuerpo, así
// que la app lo fija una sola vez por despliegue (nunca desde la UI, de un
// parámetro de navegación ni de una respuesta fabricada).
//
// Por defecto se usa `aprobar`, el camino normal de una compra. Los otros dos
// valores existen para reproducir casos límite del contrato en los tests del
// servicio; si QA necesita forzarlos en una ejecución local, cambia la variable
// al levantar Expo. No es dato del usuario ni se persiste como preferencia.
import { esEscenarioPago, type EscenarioPago } from '../types/domain';

const escenarioConfigurado: unknown = process.env.EXPO_PUBLIC_ESCENARIO_PAGO;

export const ESCENARIO_PAGO_CLIENTE: EscenarioPago = esEscenarioPago(escenarioConfigurado)
  ? escenarioConfigurado
  : 'aprobar';

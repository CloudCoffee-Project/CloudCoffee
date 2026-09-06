// src/app/(cliente)/campus.tsx
//
// No es ruta dinámica: es una única pantalla que lista todos los campus
// para que el usuario elija uno. La selección se guarda como estado local
// (AsyncStorage), no como parámetro de ruta.
import PantallaPlaceholder from '../../components/PantallaPlaceholder';

export default function CampusScreen() {
  return <PantallaPlaceholder titulo="Selecciona tu Campus" />;
}

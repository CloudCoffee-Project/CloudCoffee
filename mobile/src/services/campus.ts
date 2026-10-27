// src/services/campus.ts
//
// Clave de persistencia del campus seleccionado por el cliente (INT4-27).
// La resolución de la cafetería para suscripción de stock usa los IDs reales
// que devuelve GET /v1/catalog/campus (INT4-98).

export const CAMPUS_STORAGE_KEY = '@app_campus_seleccionado';

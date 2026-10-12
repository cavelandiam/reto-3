// Hora y fecha actuales. La fecha "local" es la de Colombia (UTC−05:00), igual que los fixtures.

const ZONA = "America/Bogota"

export function ahoraIso(): string {
  return new Date().toISOString()
}

/** Fecha de hoy YYYY-MM-DD en la zona horaria de Colombia. */
export function hoyLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

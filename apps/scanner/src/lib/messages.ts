// What the operator reads when a call to PassRipple fails.

import { ApiFailure } from "./api.ts";

export function failureText(error: unknown): string {
  if (error instanceof ApiFailure) {
    if (error.status === 0)
      return "Sin conexión con PassRipple. Revise la señal e intente de nuevo.";
    if (error.status === 429) return "Demasiados intentos. Espere unos minutos.";
    if (error.status === 401) return "El código es incorrecto, ya se usó o venció.";
    if (error.status === 404) return "El código de staff no es válido, venció o ya se usó.";
  }
  return "Algo salió mal. Intente de nuevo.";
}

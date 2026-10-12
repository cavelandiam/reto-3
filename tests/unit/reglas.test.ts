import { describe, expect, test } from "bun:test"
import { cargarMaestros } from "../../src/domain/maestros"
import { leerPaquete } from "../../src/domain/paquete"
import { rc1, rc2, rc3, rc4, rc5, rc6, rc7, rc8, rc9, rc10, validarPaquete } from "../../src/domain/reglas"
import type { Maestros, Paquete } from "../../src/domain/schemas"
import { RAIZ } from "../helpers"

const m: Maestros = cargarMaestros(RAIZ)

/** Paquete sintético a partir de sol-001 (válido) con cambios puntuales. */
function base(cambios: (p: Paquete) => void = () => {}): Paquete {
  const r = leerPaquete(RAIZ, "sol-001")
  if (!r.ok) throw new Error(r.error)
  const p: Paquete = structuredClone(r.data)
  cambios(p)
  return p
}

describe("RC1 proveedor", () => {
  test("ok por NIT de la solicitud", () => expect(rc1(base(), m).resultado).toBe("ok"))
  test("inexistente → bloqueo", () => {
    const r = rc1(
      base((p) => {
        p.solicitud.proveedor_nit = "999"
      }),
      m,
    )
    expect(r.resultado).toBe("bloqueo")
    expect(r.hallazgo?.accion_sugerida).toContain("RUT")
  })
  test("inactivo → bloqueo", () => {
    const r = rc1(
      base((p) => {
        p.solicitud.proveedor_nit = "901777888"
      }),
      m,
    )
    expect(r.hallazgo?.detalle).toContain("inactivo")
  })
  test("sin NIT en ningún lado → por nombre", () => {
    const r = rc1(
      base((p) => {
        p.solicitud.proveedor_nit = undefined
        if (p.cotizacion) p.cotizacion.nit = null
      }),
      m,
    )
    expect(r.derivados?.proveedor?.resuelto_por).toBe("por_nombre")
  })
})

describe("RC2 aprobación", () => {
  test("ok", () => expect(rc2(base(), m).resultado).toBe("ok"))
  test("sin aprobación → bloqueo", () =>
    expect(
      rc2(
        base((p) => {
          p.aprobacion = null
        }),
        m,
      ).resultado,
    ).toBe("bloqueo"))
  test("'No aprobado' → bloqueo", () => {
    const r = rc2(
      base((p) => {
        if (p.aprobacion) p.aprobacion.aprobado = false
      }),
      m,
    )
    expect(r.hallazgo?.detalle).toContain("no contiene")
  })
  test("centro inexistente → bloqueo", () => {
    const r = rc2(
      base((p) => {
        p.solicitud.centro_costo = "CC-9999"
      }),
      m,
    )
    expect(r.hallazgo?.detalle).toContain("no existe")
  })
  test("aprobador ajeno → bloqueo con aprobadores válidos", () => {
    const r = rc2(
      base((p) => {
        if (p.aprobacion) p.aprobacion.de = "rtorres@periferia-ficticia.com"
      }),
      m,
    )
    expect(r.hallazgo?.detalle).toContain("Aprobadores válidos de CC-1010")
  })
})

describe("RC3 tope", () => {
  test("ok dentro del tope", () => expect(rc3(base(), m).resultado).toBe("ok"))
  test("supera tope del aprobador válido → bloqueo", () => {
    const r = rc3(
      base((p) => {
        p.solicitud.valor_total = 60_000_000
      }),
      m,
    )
    expect(r.hallazgo?.detalle).toContain("supera el tope")
  })
  test("sin aprobación → no aplica", () =>
    expect(
      rc3(
        base((p) => {
          p.aprobacion = null
        }),
        m,
      ).resultado,
    ).toBe("no_aplica"))
})

describe("RC4 subárea", () => {
  test("ok (sin importar mayúsculas/tildes)", () => {
    expect(
      rc4(
        base((p) => {
          p.solicitud.subarea = "infraestructura"
        }),
        m,
      ).resultado,
    ).toBe("ok")
  })
  test("subárea inválida → bloqueo con subáreas válidas", () => {
    const r = rc4(
      base((p) => {
        p.solicitud.subarea = "Marketing"
      }),
      m,
    )
    expect(r.hallazgo?.detalle).toContain("Infraestructura, Soporte, Desarrollo")
  })
})

describe("RC5 cotización", () => {
  test("ok dentro del 2 %", () => {
    expect(
      rc5(
        base((p) => {
          if (p.cotizacion) p.cotizacion.total = 11_600_000
        }),
        m,
      ).resultado,
    ).toBe("ok")
  })
  test("excede 2 % → confirmación con ambos valores", () => {
    const r = rc5(
      base((p) => {
        if (p.cotizacion) p.cotizacion.total = 12_000_000
      }),
      m,
    )
    expect(r.resultado).toBe("confirmacion")
    expect(r.hallazgo?.valores).toMatchObject({ solicitud: 11_400_000, cotizacion: 12_000_000 })
  })
  test("sin cotización → confirmación", () => {
    expect(
      rc5(
        base((p) => {
          p.cotizacion = null
        }),
        m,
      ).resultado,
    ).toBe("confirmacion")
  })
})

describe("RC6 indicador IVA", () => {
  test("informado y válido → ok", () => expect(rc6(base(), m).resultado).toBe("ok"))
  test("ausente → derivado del proveedor + confirmación", () => {
    const r = rc6(
      base((p) => {
        p.solicitud.indicador_iva = undefined
      }),
      m,
    )
    expect(r.resultado).toBe("confirmacion")
    expect(r.derivados?.indicador_iva).toEqual({ valor: "C1", fuente: "maestro.proveedores" })
  })
  test("inexistente → bloqueo", () => {
    expect(
      rc6(
        base((p) => {
          p.solicitud.indicador_iva = "C9"
        }),
        m,
      ).resultado,
    ).toBe("bloqueo")
  })
})

describe("RC7 condiciones de pago", () => {
  test("informada → ok", () => expect(rc7(base(), m).resultado).toBe("ok"))
  test("ausente → derivada sin confirmación", () => {
    const r = rc7(
      base((p) => {
        p.solicitud.condiciones_pago = undefined
      }),
      m,
    )
    expect(r.resultado).toBe("derivado")
    expect(r.hallazgo).toBeUndefined()
    expect(r.derivados?.condiciones_pago?.valor).toBe("Z030")
  })
  test("código inexistente → bloqueo", () => {
    expect(
      rc7(
        base((p) => {
          p.solicitud.condiciones_pago = "Z999"
        }),
        m,
      ).resultado,
    ).toBe("bloqueo")
  })
})

describe("RC8 retroactiva", () => {
  test("sin factura → no aplica", () => expect(rc8(base(), m).resultado).toBe("no_aplica"))
  test("factura posterior → ok", () => {
    const r = rc8(
      base((p) => {
        p.factura = { numero: "F1", fecha: "2026-08-25", total: 1 }
      }),
      m,
    )
    expect(r.resultado).toBe("ok")
  })
  test("factura anterior → confirmación y retroactiva", () => {
    const r = rc8(
      base((p) => {
        p.factura = { numero: "F1", fecha: "2026-08-01", total: 1 }
      }),
      m,
    )
    expect(r.resultado).toBe("confirmacion")
    expect(r.retroactiva).toBe(true)
  })
})

describe("RC9 fecha de aprobación", () => {
  test("posterior → ok", () => expect(rc9(base(), m).resultado).toBe("ok"))
  test("anterior a la solicitud → confirmación", () => {
    const r = rc9(
      base((p) => {
        if (p.aprobacion) p.aprobacion.fecha = "2026-08-19T23:30:00-05:00"
      }),
      m,
    )
    expect(r.resultado).toBe("confirmacion")
  })
})

describe("RC10 aritmética", () => {
  test("cuadra (±1) → ok", () => {
    expect(
      rc10(
        base((p) => {
          p.solicitud.valor_total = 11_400_001
        }),
        m,
      ).resultado,
    ).toBe("ok")
  })
  test("no cuadra → bloqueo con los tres valores", () => {
    const r = rc10(
      base((p) => {
        p.solicitud.valor_total = 11_500_000
      }),
      m,
    )
    expect(r.hallazgo?.valores).toEqual({ cantidad: 120, valor_unitario: 95000, valor_total: 11_500_000 })
  })
})

test("validarPaquete evalúa todas las reglas aunque haya bloqueos", () => {
  const v = validarPaquete(
    base((p) => {
      p.solicitud.proveedor_nit = "999"
      p.solicitud.subarea = "X"
      p.solicitud.valor_total = 1
    }),
    m,
  )
  expect(v.apta).toBe(false)
  expect(v.bloqueos.map((b) => b.codigo)).toEqual(["RC1", "RC4", "RC10"])
})

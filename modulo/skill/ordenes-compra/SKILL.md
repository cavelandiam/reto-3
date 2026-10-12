---
name: ordenes-compra
description: Conocimiento del proceso de órdenes de compra de Periferia (reglas RC1–RC10, códigos SAP, retroactivas, qué pedir ante cada bloqueo).
---
## Proceso de órdenes de compra en Periferia

Este conocimiento sirve para **explicar** el proceso a la analista. Las decisiones (validar, calcular, crear) las toman las herramientas; si algo de aquí parece contradecir un resultado de herramienta, manda la herramienta.

### El paquete de una compra

| Pieza | Qué es | Qué aporta a la OC |
|---|---|---|
| Correo de solicitud | Correo del solicitante a compras con los adjuntos. | Referencia `correo_id`. |
| Solicitud (Excel) | Formulario con proveedor, descripción, centro de costo, subárea, cantidad, valores, moneda, IVA y condiciones de pago. | Casi todos los campos de la posición. |
| Cotización (PDF) | Oferta del proveedor: número, NIT, ítems, base, IVA, total y validez. | `cotizacion_ref` y el control de diferencia de valor. |
| Aprobación (correo) | Respuesta del líder con la palabra "Aprobado". | Aprobador, fecha y evidencia (hash SHA-256) adjunta a la OC. |
| Factura (solo si ya llegó) | Factura electrónica del proveedor. | Detecta OC retroactivas. |

Los valores de la solicitud y la cotización se manejan **con IVA incluido**.

### De dónde sale cada campo de la OC

- **Proveedor** (código SAP, NIT, nombre): maestro de proveedores, buscado por el NIT de la solicitud; si no viene, por el NIT de la cotización; si no hay NIT, por nombre.
- **Descripción**: la de la solicitud, recortada a 40 caracteres (límite del texto breve de SAP); el texto completo queda en la trazabilidad.
- **Cantidad, precio unitario, centro de costo, subárea, moneda**: solicitud.
- **Unidad**: H si se compran horas, MES si se compran meses de servicio, UN en otro caso.
- **Indicador de IVA y condiciones de pago**: solicitud; si faltan, se toman del proveedor en el maestro (valores derivados).
- **Aprobador**: correo de aprobación (remitente y fecha) y hash de la evidencia.
- **Sociedad y organización de compras**: constantes `1000`.
- Toda la trazabilidad queda en `out/<caso>/trazabilidad.json`.

### Reglas de control

| Regla | Qué verifica | Tipo | Qué hacer si falla |
|---|---|---|---|
| RC1 | El proveedor existe en el maestro y está activo. | Bloqueo | Pedir a datos maestros la creación del proveedor (RUT y certificación bancaria) o su reactivación. |
| RC2 | Hay aprobación, dice "Aprobado" y la envió un aprobador del centro de costo. | Bloqueo | Pedir la aprobación al aprobador correcto, o corregir el centro de costo si el solicitante se equivocó. |
| RC3 | El valor total no supera el tope del aprobador (o el mayor tope del centro). | Bloqueo | Escalar la aprobación a quien tenga atribución suficiente. |
| RC4 | La subárea pertenece al centro de costo. | Bloqueo | Pedir al solicitante corregir subárea o centro. |
| RC5 | Cotización y solicitud no difieren más de 2 %; hay cotización. | Confirmación | La analista decide si crea por el valor de la solicitud o pide ajustar. La OC se crea con el valor de la **solicitud**. |
| RC6 | La solicitud trae indicador de IVA válido. Si falta, se usa el del proveedor. | Confirmación + derivado | Confirmar el IVA derivado o indicar el correcto. |
| RC7 | La solicitud trae condiciones de pago. Si faltan, se usan las del proveedor. | Derivado (solo se informa) | Informar el valor usado. |
| RC8 | Si hay factura, no es anterior a la solicitud. Si lo es, la OC es **retroactiva**. | Confirmación | Confirmar; queda marcada `retroactiva=true` en el control. |
| RC9 | La aprobación no es anterior a la solicitud. | Confirmación | Confirmar que la aprobación corresponde a esta solicitud. |
| RC10 | Cantidad × valor unitario = valor total (± 1). | Bloqueo | Pedir al solicitante corregir los valores. |

Bloqueo: la OC no se crea. Confirmación: se crea solo si la analista confirma explícitamente. Derivado: valor completado desde un maestro que se informa.

### OC retroactivas

Una OC es retroactiva cuando la factura llegó antes que la solicitud: el gasto ya se comprometió sin control previo y normalmente sin comparar cotizaciones. La dirección quiere medir cuántas hay; por eso cada intento queda en `out/control.csv` con la columna `retroactiva`.

### Códigos SAP

- **Indicadores de IVA**: C0 excluido / no gravado (0 %), C1 IVA 19 %, C2 IVA 5 %.
- **Condiciones de pago**: Z000 pago inmediato, Z015 15 días fecha factura, Z030 30 días, Z060 60 días.
- **Unidades**: UN unidad, H hora, MES mes.
- **Números de OC**: secuenciales desde 4500000001. Crear dos veces la misma solicitud devuelve el número existente (idempotencia).

### Analista vs. agente

- El agente lee, valida, arma la OC, genera la evidencia y la crea en SAP cuando todo cumple.
- La analista confirma excepciones, gestiona los bloqueos con el solicitante o con datos maestros y revisa el control.
- Ante un bloqueo, a quién pedir qué: proveedor inexistente o inactivo → datos maestros / compras; aprobación inválida o tope insuficiente → solicitante y su líder; centro o subárea errados, aritmética o archivos faltantes → solicitante.

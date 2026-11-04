# Cash Control MiniApp · BRANLY RUIZ

Versión **independiente y local** de Cash Control. El repositorio original `branlyruiz/cash-control` no se modifica.

## Abre la miniapp

Código de la aplicación local: **`docs/`**. Incluye HTML, CSS y JavaScript sin dependencias de servidor, IndexedDB para registrar movimientos y deudas, manifiesto PWA, service worker e iconos de iPhone/Android.

Una vez activado GitHub Pages en este repositorio con **Source: Deploy from a branch → main → /docs**, la dirección será:

https://branlyruiz.github.io/Cash-Control-MiniApp/

En iPhone: abrir el enlace con Safari → Compartir → Añadir a pantalla de inicio.

## Inicio en blanco

- El primer mes es **noviembre de 2026**.
- Todos los saldos empiezan en **$0 COP** y se calculan a partir de tus movimientos.
- No hay registros precargados, importación histórica automática ni conexión con la antigua base SQLite.
- Las categorías se crean al añadir movimientos.

## Actualización V14

- Deudas a favor y en contra usan filas compactas como Por cobrar de Kuumi: inicial, concepto, nota, saldo pendiente y botón **+** para abonar directamente.
- El formulario de abono ya conoce la deuda: importe, fecha, cuenta y nota opcional. **Pagar saldo completo** rellena el importe restante; el pie muestra el saldo después del abono.
- La misma presentación se aplica a las categorías de deuda y a la sección Deudas. Cada registro conserva su identidad aunque comparta el concepto con otra deuda.
- Las deudas pagadas se retiran de pendientes y quedan disponibles en Deudas saldadas. Los abonos se pueden corregir desde Movimientos.
- Se conservan los datos y cálculos de V13, el formato de respaldo y la base local.
- Se elimina de Inicio la sección redundante Distribución de gastos.

## Actualización V13

- Formulario con tres opciones principales: **Ingreso, Gasto y Deuda**. En Gasto se elige fijo o variable; en Deuda se elige a favor o en contra y se registra una nueva deuda, un abono o el pago total.
- **Pagado total** calcula el saldo restante y guarda un abono por ese importe en la fecha y cuenta elegidas. Pagar deudas en contra resta disponible; cobrar deudas a favor lo suma. Las deudas saldadas dejan de aparecer en las categorías activas, conservando su historial.
- Una sola tarjeta por concepto en Categorías, con valor, barra de proporción y acceso al detalle. El diseño de Inicio se conserva.
- Campos de al menos 16 px para evitar la ampliación automática al editar en iPhone; cierre del formulario con liberación del teclado. Se mantiene el zoom manual.
- Base IndexedDB y formato de respaldo JSON conservados. Los registros anteriores, incluidas transferencias, siguen siendo compatibles.

Comprobaciones financieras: `node --test tests/miniapp-finance.test.cjs`.

## Funciones de la miniapp

- **Cinco secciones de categorías:** ingresos, gastos variables, gastos fijos, deudas a favor y deudas en contra.
- **Gastos fijos recurrentes:** concepto, importe mensual previsto, día de pago (1–31) y mes desde el cual se aplica; las fechas se ajustan al último día de meses cortos.
- **Alertas de vencimiento:** se muestran pagos sin abono, vencidos o con vencimiento en 0–2 días en el mes vigente; botón de pago rápido con selección de cuenta.
- **Resumen financiero ampliado:** gastos fijos previstos y pagados, disponible arrastrado del mes anterior, flujo del dinero y patrimonio neto aproximado.
- **Edición por concepto:** renombrar conceptos, inspeccionar y editar registros y eliminar registros del mes; eliminación separada de planes fijos.
- Los movimientos existentes siguen en IndexedDB local, sin importar el historial del proyecto original.

## Funciones locales

- Dashboard por mes, disponible digital y efectivo, ingresos, gastos, distribución por categorías.
- Ingresos, gastos, transferencias, deudas por cobrar y por pagar, abonos, edición y eliminación.
- Base de datos **IndexedDB** exclusivamente en el navegador del dispositivo.
- Exportación de copia JSON, restauración con validación y confirmación antes de reemplazar, exportación CSV, borrado de datos.
- Tras la primera carga, el service worker permite abrirla sin internet.

**No hay sincronización automática entre dispositivos.** Los datos pueden perderse si se borran los datos del sitio o se elimina el almacenamiento de la aplicación. Exporta copias regularmente. Se recomienda instalarla y usarla siempre desde la misma URL.

## Código original conservado para referencia

Los directorios `cash-control-admin--front/` y `cash-control--backend/` son una copia del proyecto Next.js/FastAPI de desarrollo. **No son necesarios para ejecutar la miniapp local de `docs/`**. No se incluyeron datos personales, SQLite ni archivos Excel originales.

## Estado de publicación

Los archivos PWA están preparados. GitHub Pages se habilita desde **Settings → Pages**. El repositorio por sí solo no confirma que la página esté en línea.

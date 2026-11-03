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

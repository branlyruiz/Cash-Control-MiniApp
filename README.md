# Cash Control MiniApp · BRANLY RUIZ

Versión móvil independiente del proyecto Cash Control. Su código fue copiado de la rama `cash-control_v1` a un repositorio separado; **no modifica el proyecto original**.

## Estado

- Código de la aplicación copiado: frontend Next.js 16, backend FastAPI y SQLite.
- Metadatos para instalación desde iOS/Android, manifiesto web y logotipo incluidos en `cash-control-admin--front/public`.
- **Pendiente:** despliegue HTTPS del frontend y la API, base de datos persistente, configuración y prueba real en iPhone.
- **Importante:** todavía no es una miniapp publicada ni incluye datos históricos privados. No habilitar GitHub Pages esperando que ejecute los servidores.

## Ejecutar localmente

Se requiere Node.js 20.9+ y Python 3.10+. Ejecuta desde la raíz:

```bash
make dev
```

La interfaz se abre en `http://127.0.0.1:3100` y la API en `http://127.0.0.1:8000/docs`. Consulta `Makefile` para los comandos disponibles.

## Publicar como miniapp

1. Desplegar el backend FastAPI en un servicio Python con volumen persistente para `cash-control--backend/data/cash-control.sqlite3`.
2. Establecer las variables de entorno privadas necesarias y crear/configurar el usuario inicial con cuidado.
3. Desplegar el frontend Next.js en un hosting Node compatible, con `BACKEND_URL` apuntando a la API.
4. Conectar HTTPS, probar autenticación y verificar que se registran/recuperan movimientos.
5. En Safari para iPhone, abrir la URL del frontend y usar **Compartir → Añadir a pantalla de inicio**.

La aplicación está pensada para trabajar **con conexión**: no se añadió caché offline de los datos financieros, porque requieren consistencia con el servidor.

## Datos

La base SQLite, los archivos privados de Excel y los secretos no se incluyeron en este repositorio. El despliegue requiere almacenamiento persistente y copias de seguridad.

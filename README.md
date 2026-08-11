# ▲ Rclone Cloud Merger & Windows Drive Mapper

Una aplicación de escritorio híbrida y portable para Windows que te permite administrar, fusionar y mapear múltiples cuentas de almacenamiento en la nube (como OneDrive de 1TB) en un único disco virtual accesible directamente desde el Explorador de Archivos de Windows.

Desarrollado sobre **Node.js (Express & WebSockets)** para el backend y una interfaz de usuario web **Glassmorphic** minimalista y moderna que se ejecuta como una aplicación nativa sin bordes ni barra de direcciones.

---

## 🚀 Características Principales

*   **Fusión Virtual (Union Backend)**: Combina la capacidad de almacenamiento de múltiples cuentas (por ejemplo, 3 cuentas de OneDrive de 1TB = un disco virtual unificado de 3TB).
*   **Mapeo Nativo de Windows**: Mapea tu almacenamiento unificado en una letra de unidad física (`X:`, `Y:`, `Z:`, etc.) visible en el Explorador de Archivos.
*   **Instalación Portable Automática**: Si no tienes Rclone, el backend descarga y configura la versión oficial de 64 bits para Windows en una carpeta local de forma automática.
*   **Doble Modo de Montaje**:
    *   **Nativo (WinFsp)**: Alto rendimiento y compatibilidad física (recomendado).
    *   **Unidad de Red (WebDAV Fallback)**: Mapeo de red local mediante un servidor WebDAV integrado en Rclone (ideal si no puedes instalar controladores de kernel).
*   **Asistente Inteligente OneDrive (OAuth)**: Automatiza las preguntas típicas del login de Microsoft en segundo plano y previene la selección de carpetas de sistema inválidas.
*   **Consola de Configuración Manual**: Acceso rápido a la consola oficial de Rclone para configuraciones avanzadas (SharePoint, Google Drive, Dropbox, etc.).
*   **Inicio con Windows Integrado**: Opción de activar un acceso directo en tu carpeta de inicio para arrancar el servidor en silencio al encender la PC y auto-montar el disco de forma invisible.
*   **Apagado Inteligente**: Si cierras la ventana de la aplicación y no hay discos montados de forma activa, el servidor Node.js se apaga automáticamente a los 5 segundos para liberar memoria.

---

## 🛠️ Requisitos Previos

1.  **Node.js** (v16.0.0 o superior): Necesario para arrancar el servidor local. [Descargar Node.js](https://nodejs.org).
2.  **WinFsp (Windows File System Proxy)**: *Altamente recomendado*. Permite a Rclone montar las unidades en Windows como discos físicos nativos. [Descargar WinFsp](https://github.com/winfsp/winfsp/releases).

---

## 📂 Estructura del Proyecto

*   `server.js`: Servidor Express que gestiona Rclone, los sockets de registro, el auto-montaje y el auto-apagado.
*   `launch.vbs`: Lanzador invisible de Windows. Inicia la app sin mostrar ventanas de comando y arranca el panel de control en "App Mode" de Microsoft Edge.
*   `run.bat`: Batch script estándar. Útil para desarrollo o depuración (muestra los logs del servidor).
*   `public/`: Carpeta con la interfaz de usuario.
    *   `index.html`: Estructura del dashboard y ventanas modales de carga y autorización.
    *   `style.css`: Estilo visual premium oscuro con efectos de transparencia, reflejos y brillos de fondo.
    *   `app.js`: Lógica del cliente, sincronización por WebSockets y peticiones a la API.
*   `bin/`: Carpeta (creada automáticamente) donde se guarda el ejecutable `rclone.exe`, el archivo de configuración `rclone.conf` y el estado de montaje `mount_config.json`.

---

## 💻 Instrucciones de Uso

### 📦 Instalación Rápida (Recomendado para Distribuir)
1. Descarga o clona este repositorio en tu equipo.
2. Haz doble clic en el archivo **`Install.bat`**.
3. El instalador copiará la aplicación y creará accesos directos automáticos en tu **Escritorio** y en tu **Menú Inicio**.
4. ¡Listo! Ya puedes abrir la app en cualquier momento buscando **"Rclone Cloud Merger"** en tu Menú Inicio o haciendo doble clic en el icono del Escritorio.
*(Para desinstalar en cualquier momento, ejecuta `Uninstall.bat`).*

### Inicio Manual / Desarrollo
1. Descarga o clona este repositorio.
2. Haz doble clic en **`launch.vbs`** (o `run.bat` para ver la consola de logs).
3. Se abrirá la ventana de escritorio independiente en modo aplicación.

### Conectar Cuentas (OneDrive)
1. Haz clic en **"+ OneDrive"**.
2. Escribe un nombre identificativo para la cuenta (ej. `onedrive_personal_1`) y haz clic en **"Comenzar Autorización"**.
3. Se abrirá una pestaña en tu navegador predeterminado para que inicies sesión en Microsoft y des los permisos correspondientes.
4. El backend capturará el token y el ID de almacenamiento (`OneDrive (personal)`) de forma automática, cerrando la pestaña y mostrando la cuenta con su barra de capacidad en el panel izquierdo.

### Fusionar y Montar
1. Una vez tengas al menos 2 cuentas conectadas, selecciónalas con los checkboxes en el panel central.
2. Haz clic en **"Integrar en Disco Virtual"** para crear la unidad unificada.
3. Elige una letra de unidad disponible (ej. `X:`), ponle un nombre personalizado (ej. `Nubes Unidas`) y haz clic en **"Montar Unidad"**.
4. ¡Listo! Abre **Este PC** en el Explorador de Archivos y verás tu nuevo disco de gran capacidad disponible para leer y escribir.

---

## 💾 Sistema de Escritura de Archivos (`--vfs-cache-mode full`)

Para garantizar la compatibilidad con Windows Explorer (que bloquea, lee y modifica archivos constantemente) y evitar fallas al guardar documentos (como archivos de Microsoft Word o Excel), la aplicación monta la unidad usando el sistema de caché **VFS (Virtual File System) en modo completo**:

1. **Lectura**: Al abrir un archivo, Rclone descarga solo los fragmentos necesarios en una carpeta local temporal (bajo la carpeta de tu usuario).
2. **Escritura**: Al guardar o editar un archivo, los cambios se escriben instantáneamente en la caché local (velocidad de disco local).
3. **Subida en segundo plano**: Rclone sube el archivo modificado de forma asíncrona a tu OneDrive. Si hay cortes de red, Rclone reintenta de forma segura en segundo plano.
4. **Limpieza automática**: La caché elimina los archivos temporales que no han sido leídos en más de 1 hora.

---

## 🐞 Errores Conocidos y Limitaciones

1.  **Cuentas Corporativas / Educativas (HTTP 403 Access Denied)**:
    *   *Causa*: Muchas empresas o universidades bloquean el acceso de aplicaciones de terceros (como Rclone) a sus directorios en la API Graph de Microsoft.
    *   *Solución*: Si el asistente automático da error de permisos, haz clic en **"Config. Manual"**, inicia sesión allí y asegúrate de configurar los permisos de la organización o ingresar tus propias credenciales de Azure AD si tu departamento de TI lo requiere.
2.  **Unidades WebDAV Mapeadas como `DavWWWRoot`**:
    *   *Causa*: Windows por defecto nombra cualquier unidad de red WebDAV con este identificador.
    *   *Solución*: El backend intenta renombrar la unidad automáticamente con PowerShell. Sin embargo, en algunas configuraciones estrictas de Windows Defender, el script de renombrado puede ser bloqueado o requerir un par de segundos adicionales para surtir efecto en el Explorador de Archivos.
3.  **El Puerto 3000 ya está en uso (`EADDRINUSE`)**:
    *   *Causa*: Si cierras la ventana de la aplicación pero tienes un disco montado, el servidor sigue ejecutándose en segundo plano para servir los archivos al Explorador de Archivos. Si intentas hacer doble clic de nuevo en `launch.vbs`, la nueva ventana no podrá iniciar otro servidor en el mismo puerto.
    *   *Solución*: Entra en tu navegador web a `http://localhost:3000` o finaliza el proceso `node.exe` desde el Administrador de Tareas antes de volver a lanzar el script `.vbs`.
4.  **Conexión WebDAV sin SSL**:
    *   *Causa*: Por defecto, Windows WebClient restringe conexiones WebDAV no seguras (`http://`).
    *   *Solución*: Si el montaje por WebDAV (Fallback) no funciona, debes ajustar la clave de registro `BasicAuthLevel` a `2` en `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\WebClient\Parameters` y reiniciar el servicio **WebClient** en Windows. *Se recomienda instalar WinFsp para evitar este problema por completo.*

---

## 📌 Tareas Pendientes (Roadmap)

- [ ] **Soporte nativo para otros servicios**: Agregar flujos automatizados guiados (OAuth Express) para Google Drive, Dropbox y Mega en la interfaz gráfica (actualmente solo soportados mediante el configurador manual).
- [ ] **Encriptación de Archivos (Rclone Crypt)**: Permitir añadir una capa de cifrado sobre el disco virtual para que los archivos se encripten localmente en tu PC antes de ser subidos a la nube.
- [ ] **Explorador de Archivos Integrado**: Añadir una pestaña en el dashboard web para explorar, descargar y subir archivos directamente a las nubes conectadas sin necesidad de montar la unidad en Windows.
- [ ] **Configuración de Red Local**: Permitir cambiar el puerto del servidor (`3000`) y el del servidor WebDAV (`8080`) desde la propia interfaz de configuración en caso de conflictos de red.
- [ ] **Gestión de Limpieza de Caché**: Añadir un botón para forzar la limpieza manual de la carpeta temporal de caché VFS y configurar el tiempo máximo de retención de archivos.

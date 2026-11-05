/**
 * PreConfig.js para el despliegue self-hosted. Sustituye a
 * src/main/webapp/js/PreConfig.js en tiempo de ejecución (ver server/app.js).
 * No se modifica el árbol original de drawio.
 */
// Overrides of global vars need to be pre-loaded
window.DRAWIO_PUBLIC_BUILD = true;
window.EXPORT_URL = null; // Sin export server: PDF vía diálogo de impresión. Apuntar aquí a un export server propio si se despliega uno.
window.DRAWIO_BASE_URL = window.location.origin + '/drawio';
window.DRAWIO_VIEWER_URL = null;
window.DRAWIO_LIGHTBOX_URL = null;
window.DRAW_MATH_URL = 'math4/es5';
window.DRAWIO_LOG_URL = ''; // Telemetría apagada
window.DRAWIO_CONFIG = null;
urlParams['sync'] = 'manual';

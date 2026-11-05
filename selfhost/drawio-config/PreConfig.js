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

// Colaboración: sync automático (merge de cambios remotos vía SelfHostFile).
urlParams['sync'] = 'auto';

// Relay WebSocket de colaboración (server/realtime.js). REALTIME_URL (/cache)
// no está implementado aún: drawio detecta que no responde y sincroniza solo
// por el socket, recargando el archivo ante cada notificación de guardado.
window.RT_WEBSOCKET_URL = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') +
	window.location.host + '/rt';

// Carga SelfHostFile.js justo después de app.min.js y antes de que arranque App
// (bootstrap.js llama a App.main en el callback de app.min.js), sin tocar
// los archivos de drawio.
(function()
{
	var mxscriptOrig = window.mxscript;

	window.mxscript = function(src, onLoad)
	{
		if (typeof src === 'string' && src === 'js/app.min.js' && typeof onLoad === 'function')
		{
			var args = Array.prototype.slice.call(arguments);

			args[1] = function()
			{
				mxscriptOrig('js/SelfHostFile.js', onLoad);
			};

			return mxscriptOrig.apply(this, args);
		}

		return mxscriptOrig.apply(this, arguments);
	};
})();

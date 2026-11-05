/**
 * SelfHostFile: archivo de drawio respaldado por la API de selfhost/
 * (GET/PUT /api/diagrams/:id). El descriptor es el entero `version` de la fila,
 * que sirve de etag para el bloqueo optimista del servidor.
 *
 * Se carga después de app.min.js (ver PreConfig.js) y se activa con ?shid=<uuid>.
 * Modelado sobre StorageFile.js; usa DrawioFile.mergeFile para resolver los
 * conflictos 409 en lugar de descartar los cambios locales.
 */
(function()
{
	var API = '/api/diagrams/';

	function request(method, id, body, success, error)
	{
		var xhr = new XMLHttpRequest();
		xhr.open(method, API + encodeURIComponent(id), true);
		xhr.setRequestHeader('Accept', 'application/json');

		if (body != null)
		{
			xhr.setRequestHeader('Content-Type', 'application/json');
		}

		xhr.onload = function()
		{
			var json = null;

			try
			{
				json = JSON.parse(xhr.responseText);
			}
			catch (e)
			{
				// Respuesta sin cuerpo JSON
			}

			if (xhr.status >= 200 && xhr.status < 300)
			{
				success(json);
			}
			else if (error != null)
			{
				error({
					status: xhr.status,
					message: (json != null && json.error != null) ? json.error : xhr.statusText,
					current: (json != null) ? json.current : null
				});
			}
		};

		xhr.onerror = function()
		{
			if (error != null)
			{
				error({status: 0, message: mxResources.get('errorSavingFile')});
			}
		};

		xhr.send((body != null) ? JSON.stringify(body) : null);
	};

	SelfHostFile = function(ui, row)
	{
		DrawioFile.call(this, ui, row.xml);

		this.id = row.id;
		this.title = row.title;
		this.version = row.version;
	};

	mxUtils.extend(SelfHostFile, DrawioFile);

	SelfHostFile.prototype.autosaveDelay = 1000;
	SelfHostFile.prototype.maxAutosaveDelay = 20000;

	/**
	 * Intentos máximos de merge + reintento ante un 409.
	 */
	SelfHostFile.prototype.maxRetries = 5;

	/**
	 * Intervalo de polling en ms. Se sustituye por el relay WebSocket (paso 2).
	 */
	SelfHostFile.prototype.pollingInterval = 3000;

	var anonymousUser = null;

	/**
	 * Identidad anónima de esta pestaña (no hay login). P2PCollab descarta todos
	 * los mensajes (diffs, notificaciones, cursores, selecciones) si el usuario
	 * es null o no tiene displayName, así que este método es obligatorio para
	 * la colaboración. El nombre puede fijarse con ?nombre=.
	 */
	SelfHostFile.prototype.getCurrentUser = function()
	{
		if (anonymousUser == null)
		{
			var id = null;

			try
			{
				id = window.sessionStorage.getItem('selfhost.userId');
			}
			catch (e)
			{
				// sessionStorage no disponible: la identidad dura lo que la página
			}

			if (id == null)
			{
				id = Editor.guid();

				try
				{
					window.sessionStorage.setItem('selfhost.userId', id);
				}
				catch (e)
				{
					// ignorado
				}
			}

			var name = urlParams['nombre'];

			anonymousUser = {
				id: id,
				displayName: (name != null && name.length > 0) ? name.substring(0, 40) :
					'Usuario ' + id.substring(0, 4)
			};
		}

		return anonymousUser;
	};

	SelfHostFile.prototype.getMode = function()
	{
		return App.MODE_BROWSER;
	};

	SelfHostFile.prototype.getHash = function()
	{
		return 'S' + this.id;
	};

	SelfHostFile.prototype.getTitle = function()
	{
		return this.title;
	};

	SelfHostFile.prototype.isRenamable = function()
	{
		return true;
	};

	SelfHostFile.prototype.isAutosaveOptional = function()
	{
		return true;
	};

	SelfHostFile.prototype.isSyncSupported = function()
	{
		return true;
	};

	/**
	 * Con el relay WebSocket no hace falta polling; queda como respaldo si
	 * los sockets están desactivados (?sockets=0).
	 */
	SelfHostFile.prototype.isPolling = function()
	{
		return !DrawioFileSync.ENABLE_SOCKETS;
	};

	/**
	 * Habilita el modelo realtime de drawio (diffs por el socket, cursores y
	 * selecciones remotas).
	 */
	SelfHostFile.prototype.isRealtimeSupported = function()
	{
		return true;
	};

	SelfHostFile.prototype.getPollingInterval = function()
	{
		return this.pollingInterval;
	};

	// ---- Descriptor: el entero `version` ----

	SelfHostFile.prototype.getDescriptor = function()
	{
		return this.version;
	};

	SelfHostFile.prototype.setDescriptor = function(version)
	{
		this.version = version;
	};

	SelfHostFile.prototype.getDescriptorEtag = function(desc)
	{
		return desc;
	};

	SelfHostFile.prototype.loadDescriptor = function(success, error)
	{
		this.getLatestVersionId(success, error);
	};

	SelfHostFile.prototype.getLatestVersionId = function(success, error)
	{
		request('GET', this.id, null, function(row)
		{
			success(row.version);
		}, error);
	};

	SelfHostFile.prototype.getLatestVersion = function(success, error)
	{
		request('GET', this.id, null, mxUtils.bind(this, function(row)
		{
			success(new SelfHostFile(this.ui, row));
		}), error);
	};

	// ---- Guardado ----

	SelfHostFile.prototype.save = function(revision, success, error)
	{
		DrawioFile.prototype.save.apply(this, [revision, mxUtils.bind(this, function()
		{
			// Los bytes se acaban de actualizar; una edición hecha durante la
			// petición no está en ellos y mantiene el archivo modificado.
			this.setShadowModified(false);
			this.saveFile(this.getTitle(), false, success, error);
		}), error]);
	};

	SelfHostFile.prototype.saveAs = function(title, success, error)
	{
		this.rename(title, success, error);
	};

	SelfHostFile.prototype.rename = function(title, success, error)
	{
		if (this.getTitle() == title)
		{
			success();

			return;
		}

		request('PUT', this.id, {title: title, version: this.version}, mxUtils.bind(this, function(row)
		{
			this.title = row.title;
			this.version = row.version;
			this.ui.updateDocumentTitle();
			success();
		}), mxUtils.bind(this, function(err)
		{
			this.handleSaveError(err, mxUtils.bind(this, function()
			{
				this.rename(title, success, error);
			}), error);
		}));
	};

	/**
	 * Escribe el XML con el bloqueo optimista del servidor. Ante un 409 mezcla
	 * la versión remota (`current`) con los cambios locales y reintenta.
	 */
	SelfHostFile.prototype.saveFile = function(title, revision, success, error, retry)
	{
		retry = (retry != null) ? retry : 0;

		if (!this.isEditable())
		{
			if (success != null)
			{
				success();
			}

			return;
		}

		var desc = this.getDescriptor();
		var data = this.getData();

		request('PUT', this.id, {xml: data, title: title, version: desc}, mxUtils.bind(this, function(row)
		{
			this.title = row.title;
			this.setModified(this.getShadowModified());
			this.setDescriptor(row.version);
			this.contentChanged();
			this.fileSaved(data, desc, success, error);
		}), mxUtils.bind(this, function(err)
		{
			this.handleSaveError(err, mxUtils.bind(this, function()
			{
				this.updateFileData();
				this.setShadowModified(false);
				this.saveFile(title, revision, success, error, retry + 1);
			}), error, retry);
		}));
	};

	/**
	 * Resuelve un 409 mezclando `err.current` y llamando a retry; cualquier
	 * otro error (o agotar los reintentos) se pasa a error.
	 */
	SelfHostFile.prototype.handleSaveError = function(err, retryFn, error, retry)
	{
		if (err != null && err.status == 409 && err.current != null &&
			(retry == null || retry < this.maxRetries) && !this.invalidChecksum)
		{
			this.mergeFile(new SelfHostFile(this.ui, err.current), mxUtils.bind(this, function()
			{
				// Espera aleatoria para que dos clientes no choquen en cada reintento
				window.setTimeout(retryFn, 300 + Math.random() * 300);
			}), error);
		}
		else
		{
			if (err != null && err.status == 409)
			{
				this.setConflict();
			}

			if (error != null)
			{
				error(err);
			}
		}
	};

	// ---- Apertura desde ?shid=<uuid> ----

	/**
	 * Carga el diagrama de la API y lo abre. Sustituye al inicio normal de App
	 * solo cuando existe el parámetro shid.
	 */
	SelfHostFile.open = function(ui, id)
	{
		request('GET', id, null, function(row)
		{
			ui.fileLoaded(new SelfHostFile(ui, row));
		}, function(err)
		{
			ui.spinner.stop();
			ui.showError(mxResources.get('error'),
				(err.status == 404) ? 'Diagrama no encontrado.' : err.message);
		});
	};

	var appStart = App.prototype.start;

	App.prototype.start = function()
	{
		var id = urlParams['shid'];

		if (id == null)
		{
			return appStart.apply(this, arguments);
		}

		// Expuesto solo para depurar y para pruebas automatizadas del editor.
		window.shUi = this;
		this.restoreLibraries();
		this.spinner.stop();
		SelfHostFile.open(this, id);
	};
})();

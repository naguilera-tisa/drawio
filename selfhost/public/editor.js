// Host del editor: embebe drawio (embed=1&proto=json) y persiste vía /api.
const id = location.pathname.split('/').pop();
const frame = document.getElementById('frame');
const titleInput = document.getElementById('title');
const saveState = document.getElementById('saveState');
const banner = document.getElementById('banner');

let diagram = null;   // fila actual (con version)
let pendingXml = null; // último XML pendiente de guardar
let saving = false;
let timer;
let conflict = false;

const origin = location.origin;
frame.src = '/drawio/index.html?embed=1&proto=json&spin=1&saveAndExit=1&noSaveBtn=1&offline=1&splash=0&ui=kennedy';

const post = (msg) => frame.contentWindow.postMessage(JSON.stringify(msg), origin);
const setState = (t) => { saveState.textContent = t; };

async function api(url, opts) {
  const res = await fetch(url, opts);
  const body = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error || res.statusText), { status: res.status, body });
  return body;
}
const put = (data) => api(`/api/diagrams/${id}`, {
  method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ...data, version: diagram.version }),
});

function showConflict() {
  conflict = true;
  banner.style.display = 'block';
  banner.replaceChildren('Otra sesión modificó este diagrama; tus últimos cambios no se guardaron. ');
  const b = document.createElement('button');
  b.textContent = 'Recargar versión del servidor';
  b.onclick = () => location.reload();
  banner.append(b);
  setState('Conflicto');
}

async function flush(thumbnail) {
  if (saving || conflict || pendingXml === null) return;
  saving = true;
  const xml = pendingXml;
  pendingXml = null;
  setState('Guardando…');
  try {
    diagram = await put({ xml, ...(thumbnail ? { thumbnail } : {}) });
    setState('Guardado ' + new Date().toLocaleTimeString());
  } catch (e) {
    if (e.status === 409) showConflict();
    else { pendingXml ??= xml; setState('Error al guardar: ' + e.message); }
  } finally {
    saving = false;
    if (pendingXml !== null && !conflict) schedule();
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => flush(), 1000);
}

function requestThumbnail() {
  post({ action: 'export', format: 'svg', spin: 'Generando vista previa' });
}

titleInput.onchange = async () => {
  if (!diagram || conflict) return;
  try { diagram = await put({ title: titleInput.value }); document.title = diagram.title; }
  catch (e) { if (e.status === 409) showConflict(); else setState('Error: ' + e.message); }
};

window.addEventListener('message', async (evt) => {
  if (evt.source !== frame.contentWindow || evt.origin !== origin) return;
  let msg;
  try { msg = JSON.parse(evt.data); } catch { return; }

  switch (msg.event) {
    case 'init':
      try {
        diagram = await api(`/api/diagrams/${id}`);
      } catch (e) {
        banner.style.display = 'block';
        banner.textContent = e.status === 404 ? 'Diagrama no encontrado.' : 'Error: ' + e.message;
        return;
      }
      titleInput.value = diagram.title;
      document.title = diagram.title;
      post({ action: 'load', xml: diagram.xml, autosave: 1, title: diagram.title });
      setState('Cargado');
      break;
    case 'autosave':
    case 'save':
      if (typeof msg.xml === 'string') { pendingXml = msg.xml; schedule(); }
      if (msg.event === 'save') requestThumbnail();
      break;
    case 'export':
      // data es un data URL (svg en base64); si es muy grande se omite la miniatura
      if (msg.data && msg.data.length <= 500_000) {
        clearTimeout(timer);
        pendingXml ??= diagram.xml;
        await flush(msg.data);
      }
      break;
    case 'exit':
      clearTimeout(timer);
      await flush();
      location.href = '/';
      break;
  }
});

// Miniatura al salir de la pestaña/volver a la galería sin pulsar guardar
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && pendingXml !== null && !conflict) { clearTimeout(timer); flush(); }
});

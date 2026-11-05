const grid = document.getElementById('grid');
const statusEl = document.getElementById('status');
const pager = document.getElementById('pager');
const search = document.getElementById('search');

let page = 1;
let timer;

async function api(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.status === 204 ? null : res.json();
}

const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function card(d) {
  const thumb = el('a', { className: 'thumb', href: `/editor/${d.id}` },
    d.thumbnail ? el('img', { src: d.thumbnail, alt: '', loading: 'lazy' }) : el('div', { className: 'empty' }, 'Sin vista previa'));
  const meta = el('div', { className: 'meta' },
    el('a', { href: `/editor/${d.id}`, title: d.title }, d.title),
    el('small', {}, 'Editado ' + new Date(d.updated_at).toLocaleString()));
  const actions = el('div', { className: 'actions' },
    el('button', { onclick: () => rename(d) }, 'Renombrar'),
    el('button', { onclick: () => duplicate(d) }, 'Duplicar'),
    el('button', { className: 'danger', onclick: () => remove(d) }, 'Borrar'));
  return el('article', { className: 'card' }, thumb, meta, actions);
}

async function load() {
  statusEl.textContent = 'Cargando…';
  try {
    const q = encodeURIComponent(search.value.trim());
    const data = await api(`/api/diagrams?q=${q}&page=${page}`);
    grid.replaceChildren(...data.items.map(card));
    statusEl.textContent = data.total ? `${data.total} diagrama(s)` : 'No hay diagramas todavía. Crea el primero.';
    const pages = Math.max(1, Math.ceil(data.total / data.size));
    pager.replaceChildren(
      el('button', { textContent: '‹ Anterior', disabled: page <= 1, onclick: () => { page--; load(); } }),
      el('span', { className: 'muted', textContent: `${page} / ${pages}` }),
      el('button', { textContent: 'Siguiente ›', disabled: page >= pages, onclick: () => { page++; load(); } }));
    pager.hidden = pages <= 1;
  } catch (e) {
    statusEl.textContent = 'Error: ' + e.message;
  }
}

async function rename(d) {
  const title = prompt('Nuevo título', d.title);
  if (!title || title === d.title) return;
  try { await api(`/api/diagrams/${d.id}`, json('PUT', { title, version: d.version })); } catch (e) { alert(e.message); }
  load();
}
async function duplicate(d) {
  try { await api(`/api/diagrams/${d.id}/duplicate`, { method: 'POST' }); } catch (e) { alert(e.message); }
  load();
}
async function remove(d) {
  if (!confirm(`¿Borrar "${d.title}"?`)) return;
  try { await api(`/api/diagrams/${d.id}`, { method: 'DELETE' }); } catch (e) { alert(e.message); }
  load();
}

document.getElementById('new').onclick = async () => {
  const title = prompt('Título del diagrama', 'Nuevo diagrama');
  if (title === null) return;
  const d = await api('/api/diagrams', json('POST', { title }));
  location.href = `/editor/${d.id}`;
};
search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { page = 1; load(); }, 250); };

load();

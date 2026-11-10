import { CARD_LAYOUTS, cardLayout } from './layout.js';
import { escapeHTML as e } from './project.js';
import { coverGrids } from './render.js';

export function bindLayoutDrag(container, getIds, move, current = () => true) {
  let dragged = null;
  container.addEventListener('dragstart', event => {
    if (event.target.closest('input,select,textarea,button')) { event.preventDefault(); return; }
    const item = event.target.closest('[data-layout-id]');
    if (!item || !current()) { event.preventDefault(); return; }
    dragged = item.dataset.layoutId;
    event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', dragged);
    item.classList.add('is-dragging');
  });
  container.addEventListener('dragover', event => {
    if (dragged && current() && event.target.closest('[data-layout-id]')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
  });
  container.addEventListener('drop', event => {
    const target = event.target.closest('[data-layout-id]');
    if (!target || !dragged || !current()) return;
    event.preventDefault();
    const ids = getIds(), from = ids.indexOf(dragged), to = ids.indexOf(target.dataset.layoutId);
    if (from >= 0 && to >= 0 && from !== to) move(from, to);
    dragged = null;
  });
  container.addEventListener('dragend', () => { dragged = null; container.querySelectorAll('.is-dragging').forEach(node => node.classList.remove('is-dragging')); });
}

export function mountCoverLayout(root, { projects, base, current, changed, cancel, save }) {
  const draft = structuredClone(projects);
  root.innerHTML = `<section class="cover-layout-editor"><div class="panel-heading"><div><p class="eyebrow">Página Projetos</p><h1>Montar a grade de capas</h1></div><button type="button" class="plain" data-layout-cancel>Voltar aos trabalhos</button></div><p class="muted">Arraste as capas na prévia ou use os botões de posição. Escolha o espaço de cada trabalho. As mudanças só entram no site ao salvar.</p><div class="layout-toolbar"><label>Ver prévia em<select data-preview-device aria-label="Ver prévia em"><option value="desktop">Computador</option><option value="phone">Celular</option></select></label><button class="secondary" type="button" data-layout-reset>Usar tamanhos automáticos</button></div><div class="layout-preview layout-surface" aria-label="Prévia da página de projetos"></div><h2 class="layout-controls-title">Posição e tamanho de cada capa</h2><p class="muted">Rascunhos ficam fora da prévia pública.</p><div class="layout-controls"></div><p data-message role="status" aria-live="polite"></p><div class="save-bar"><span>Confira a prévia antes de publicar a nova composição.</span><button type="button" class="primary" data-layout-save>Salvar layout da grade</button></div></section>`;
  const preview = root.querySelector('.layout-preview'), controls = root.querySelector('.layout-controls');
  const notify = text => { root.querySelector('[data-message]').textContent = text; };
  function render(focusId) {
    const published = draft.filter(project => project.status === 'published');
    preview.innerHTML = coverGrids(published, base) || '<p class="empty-media">Nenhum trabalho publicado para mostrar.</p>';
    preview.querySelectorAll('.project').forEach((node, index) => {
      node.dataset.layoutId = published[index].id; node.draggable = true;
      node.addEventListener('click', event => event.preventDefault());
      node.setAttribute('aria-label', `Arrastar capa de ${published[index].title}`);
    });
    controls.innerHTML = draft.map((project, i) => `<article class="layout-control" data-layout-id="${e(project.id)}" draggable="true"><div><h3>${e(project.title)}</h3><small>${project.status === 'published' ? 'Publicado' : 'Rascunho'}</small></div><label>Tamanho da capa de ${e(project.title)}<select data-card-size="${i}" aria-label="Tamanho da capa de ${e(project.title)}">${Object.entries(CARD_LAYOUTS).map(([value, label]) => `<option value="${value}"${cardLayout(project) === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><div class="layout-position"><button type="button" class="secondary" data-layout-move="${i}" data-direction="-1" aria-label="Mover ${e(project.title)} para antes"${i === 0 ? ' disabled' : ''}>← Antes</button><button type="button" class="secondary" data-layout-move="${i}" data-direction="1" aria-label="Mover ${e(project.title)} para depois"${i === draft.length - 1 ? ' disabled' : ''}>Depois →</button></div></article>`).join('');
    if (focusId) controls.querySelector(`[data-layout-id="${CSS.escape(focusId)}"] button:not(:disabled)`)?.focus({ preventScroll: true });
  }
  function move(from, to) {
    if (!current() || from === to || to < 0 || to >= draft.length) return;
    const [item] = draft.splice(from, 1); draft.splice(to, 0, item);
    changed(); render(item.id); notify('Posição alterada na prévia. Salve para aplicar ao site.');
  }
  controls.addEventListener('change', event => {
    const select = event.target.closest('[data-card-size]');
    if (!select || !current() || !Object.hasOwn(CARD_LAYOUTS, select.value)) return;
    draft[Number(select.dataset.cardSize)].card_layout = select.value;
    changed(); render(); notify('Tamanho alterado na prévia.');
  });
  controls.addEventListener('click', event => {
    const button = event.target.closest('[data-layout-move]');
    if (button) move(Number(button.dataset.layoutMove), Number(button.dataset.layoutMove) + Number(button.dataset.direction));
  });
  bindLayoutDrag(controls, () => draft.map(project => project.id), move, current);
  bindLayoutDrag(preview, () => draft.map(project => project.id), move, current);
  root.querySelector('[data-preview-device]').addEventListener('change', event => preview.classList.toggle('preview-phone', event.target.value === 'phone'));
  root.querySelector('[data-layout-reset]').addEventListener('click', () => { if (!current()) return; draft.forEach(project => project.card_layout = 'auto'); changed(); render(); notify('Tamanhos automáticos na prévia.'); });
  root.querySelector('[data-layout-cancel]').addEventListener('click', cancel);
  root.querySelector('[data-layout-save]').addEventListener('click', () => save(draft));
  render();
}

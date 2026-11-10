import { bindLayoutDrag } from './admin-layout.js';
import { IMAGE_WIDTHS, IMAGE_ALIGNS, imageWidth, imageAlign } from './layout.js';
import { escapeHTML as e } from './project.js';
import { projectGallery } from './render.js';

// Changes use the project's existing, validated presentation fields.
// This component never saves, uploads, or reads another project's content.
export function mountImageLayoutEditor(section, { getProject, base, current, change, move, preset, reset, close, addImages }) {
  let selected = null, destroyed = false;
  section.innerHTML = `<div class="image-editor-heading"><div><p class="eyebrow">Página do trabalho</p><h2 id="image-layout-title" tabindex="-1">Montar layout das imagens</h2><p>Clique em uma imagem para ajustar. Arraste para mudar a ordem ou use Antes e Depois.</p></div><button type="button" class="secondary" data-layout-close>Voltar aos dados do trabalho</button></div>
    <div class="image-editor-toolbar"><div class="image-presets" role="group" aria-label="Organizações rápidas"><button type="button" data-image-preset="full">Uma por linha</button><button type="button" data-image-preset="half">Duas por linha</button><button type="button" data-image-preset="third">Três por linha</button></div><label>Prévia em<select id="image-preview-device" aria-label="Dispositivo da prévia das imagens"><option value="desktop">Computador</option><option value="phone">Celular</option></select></label><button type="button" class="secondary" data-layout-add-images>Adicionar imagens</button></div>
    <div class="image-editor-thumbnails" role="group" aria-label="Selecionar uma imagem do trabalho"></div>
    <div class="image-editor-workspace"><aside class="image-inspector" aria-label="Ajustes da imagem selecionada"><p class="image-selected-number"></p><p class="image-selected-caption"></p><h3>Tamanho</h3><div class="image-size-options" role="group" aria-label="Tamanho da imagem selecionada">${Object.entries(IMAGE_WIDTHS).map(([value, label]) => `<button type="button" data-visual-width="${value}" aria-label="Definir tamanho: ${label}" aria-pressed="false">${{ full: 'Inteira', half: '1/2', third: '1/3' }[value]}</button>`).join('')}</div><h3>Alinhamento</h3><div class="image-align-options" role="group" aria-label="Alinhamento da imagem selecionada">${Object.entries(IMAGE_ALIGNS).map(([value, label]) => `<button type="button" data-visual-align="${value}" aria-pressed="false">${label}</button>`).join('')}</div><h3>Posição</h3><div class="image-position-options"><button type="button" data-image-step="-1">← Antes</button><button type="button" data-image-step="1">Depois →</button></div><p class="image-editor-help">A escolha da capa continua nos dados do trabalho. No celular, as imagens ficam em uma coluna.</p><button type="button" class="plain" id="reset-image-layout">Restaurar disposição automática</button></aside>
    <div class="image-editor-paper"><div class="media-preview" aria-label="Montagem visual das imagens"></div></div></div>
    <p class="image-editor-status" role="status" aria-live="polite"></p><p class="image-editor-save-note">Salve o trabalho abaixo para aplicar esta montagem.</p>`;
  const canvas = section.querySelector('.media-preview');
  const strip = section.querySelector('.image-editor-thumbnails');
  const status = section.querySelector('.image-editor-status');
  const enabled = () => !destroyed && current();
  const project = () => destroyed ? null : getProject();
  const frames = () => [...canvas.querySelectorAll('.image-editor-frame')];
  const indexOfSelection = () => project()?.media.findIndex(media => media.path === selected) ?? -1;

  function syncSelection() {
    const record = project();
    if (!record) return;
    const index = indexOfSelection(), media = record.media[index];
    section.querySelector('.image-selected-number').textContent = media ? `Imagem ${index + 1} de ${record.media.length}` : 'Nenhuma imagem selecionada';
    section.querySelector('.image-selected-caption').textContent = media?.alt || (media ? 'Ajuste o espaço desta imagem na página.' : 'Adicione imagens para começar.');
    for (const frame of frames()) {
      const active = frame.dataset.imagePath === selected;
      frame.classList.toggle('is-selected', active); frame.setAttribute('aria-pressed', String(active));
    }
    for (const button of strip.querySelectorAll('button')) { button.setAttribute('aria-pressed', String(button.dataset.selectImage === selected)); button.disabled = !enabled(); }
    for (const button of section.querySelectorAll('[data-visual-width]')) {
      button.setAttribute('aria-pressed', String(Boolean(media) && button.dataset.visualWidth === imageWidth(media)));
      button.disabled = !media || !enabled();
    }
    for (const button of section.querySelectorAll('[data-visual-align]')) {
      button.setAttribute('aria-pressed', String(Boolean(media) && button.dataset.visualAlign === imageAlign(media)));
      button.disabled = !media || !enabled();
    }
    for (const button of section.querySelectorAll('[data-image-step]')) {
      const target = index + Number(button.dataset.imageStep);
      button.disabled = !media || !enabled() || target < 0 || target >= record.media.length;
    }
    section.querySelectorAll('[data-image-preset],#reset-image-layout').forEach(button => button.disabled = !record.media.length || !enabled());
    section.querySelector('[data-layout-add-images]').disabled = !enabled();
    section.querySelector('[data-layout-close]').disabled = !enabled();
    for (const frame of frames()) { frame.draggable = enabled(); frame.tabIndex = enabled() ? 0 : -1; frame.setAttribute('aria-disabled', String(!enabled())); }
  }

  function select(path, focus = false) {
    if (!project()?.media.some(media => media.path === path)) return;
    selected = path; syncSelection();
    if (focus) {
      const frame = frames().find(frame => frame.dataset.imagePath === selected);
      frame?.focus({ preventScroll: true }); frame?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function render() {
    const record = project();
    if (!record) return;
    if (!record.media.some(media => media.path === selected)) selected = record.cover_path || record.media[0]?.path || null;
    const scrollTop = section.querySelector('.image-editor-paper').scrollTop;
    canvas.innerHTML = record.media.length ? projectGallery(record, base) : '<p class="empty-media">Adicione imagens para ver a montagem.</p>';
    for (const image of [...canvas.querySelectorAll('img')]) {
      const index = record.media.findIndex(media => media.path === image.dataset.mediaPath);
      if (index < 0) continue;
      let frame = image.closest('.media-frame');
      if (!frame) { frame = document.createElement('figure'); image.replaceWith(frame); frame.append(image); }
      frame.classList.add('image-editor-frame');
      frame.dataset.imagePath = record.media[index].path;
      frame.dataset.layoutId = record.media[index].path;
      frame.setAttribute('role', 'button'); frame.tabIndex = 0;
      frame.setAttribute('aria-label', `Selecionar imagem ${index + 1}`);
      image.draggable = false; image.loading = 'eager';
      const badge = document.createElement('span'); badge.className = 'image-canvas-number'; badge.textContent = `Imagem ${index + 1}`; badge.setAttribute('aria-hidden', 'true'); frame.append(badge);
    }
    strip.innerHTML = record.media.map((media, index) => `<button type="button" data-select-image="${e(media.path)}" aria-label="Selecionar miniatura ${index + 1}" aria-pressed="false"><img src="${e(media.url || (media.local ? base + media.local : ''))}" alt="" draggable="false"><span>${index + 1}</span></button>`).join('');
    syncSelection();
    section.querySelector('.image-editor-paper').scrollTop = scrollTop;
  }

  strip.addEventListener('click', event => {
    const button = event.target.closest('[data-select-image]');
    if (button && enabled()) select(button.dataset.selectImage, true);
  });
  canvas.addEventListener('click', event => {
    const frame = event.target.closest('.image-editor-frame');
    if (frame && enabled()) select(frame.dataset.imagePath);
  });
  canvas.addEventListener('keydown', event => {
    const frame = event.target.closest('.image-editor-frame');
    if (frame && enabled() && ['Enter', ' '].includes(event.key)) { event.preventDefault(); select(frame.dataset.imagePath); }
  });
  canvas.addEventListener('dragstart', event => {
    const frame = event.target.closest('.image-editor-frame');
    if (frame && enabled()) select(frame.dataset.imagePath);
  });
  bindLayoutDrag(canvas, () => project()?.media.map(media => media.path) || [], (from, to) => {
    move(from, to); status.textContent = 'Posição alterada na montagem. Salve o trabalho para aplicar.';
  }, enabled);
  section.addEventListener('click', event => {
    if (!enabled()) return;
    const button = event.target.closest('button');
    if (!button) return;
    const index = indexOfSelection();
    if (button.hasAttribute('data-visual-width') && index >= 0) change(index, 'width', button.dataset.visualWidth);
    if (button.hasAttribute('data-visual-align') && index >= 0) change(index, 'align', button.dataset.visualAlign);
    if (button.hasAttribute('data-image-step') && index >= 0) move(index, index + Number(button.dataset.imageStep));
    if (button.hasAttribute('data-image-preset')) preset(button.dataset.imagePreset);
    if (button.id === 'reset-image-layout') reset();
    if (button.hasAttribute('data-layout-close')) close();
    if (button.hasAttribute('data-layout-add-images')) addImages();
    if (button.matches('[data-visual-width],[data-visual-align],[data-image-step],[data-image-preset],#reset-image-layout')) status.textContent = 'Montagem atualizada na prévia. Salve o trabalho para aplicar.';
  });
  section.querySelector('#image-preview-device').addEventListener('change', event => canvas.classList.toggle('preview-phone', event.target.value === 'phone'));
  render();
  return { render, select, focus: () => section.querySelector('#image-layout-title').focus({ preventScroll: true }), destroy: () => { destroyed = true; } };
}

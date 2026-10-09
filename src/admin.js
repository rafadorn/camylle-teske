import './styles.css';
import './admin.css';
import { client, configured, listProjects, saveProject, uploadImage, removeImages, deleteProject, reorderProjects, friendlyError } from './backend.js';
import { slugify, validateImage, validateProject, escapeHTML as e } from './project.js';
import { importInitial, initialImportState } from './import-initial.js';

const root = document.querySelector('#admin');
const base = import.meta.env.BASE_URL;
let projects = [], editor = null, dirty = false, saving = false;
let recovery = new URLSearchParams(location.search).get('senha') === 'alterar';

function message(text, error = false) {
  const node = root.querySelector('[data-message]');
  if (!node) return;
  node.textContent = text;
  node.classList.toggle('error', error);
  node.setAttribute('role', error ? 'alert' : 'status');
}

function busy(button, value) { button.disabled = value; button.setAttribute('aria-busy', String(value)); }

function login() {
  editor = null; dirty = false;
  root.innerHTML = `<section class="login-card"><p class="eyebrow">Seu espaço de trabalho</p><h1>Oi, Camy.</h1><p class="muted">Entre para cuidar do seu portfólio.</p><form id="login-form"><label>E-mail<input name="email" type="email" autocomplete="username" required></label><label>Senha<input name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Entrar</button><button class="plain" type="button" id="forgot">Esqueci minha senha</button></form><p data-message aria-live="polite"></p></section>`;
  root.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('button');
    busy(button, true); message('Entrando…');
    try {
      const { error } = await client.auth.signInWithPassword({ email: form.email.value, password: form.password.value });
      if (error) throw error;
      await enter();
    } catch (error) { message(friendlyError(error), true); busy(button, false); }
  });
  root.querySelector('#forgot').addEventListener('click', async event => {
    const button = event.currentTarget;
    const email = root.querySelector('[name="email"]');
    if (!email.reportValidity() || !email.value) { email.focus(); return; }
    busy(button, true);
    const { error } = await client.auth.resetPasswordForEmail(email.value, { redirectTo: `${location.origin}${base}admin/?senha=alterar` });
    message(error ? friendlyError(error) : 'Se esse e-mail estiver cadastrado, você receberá um link para trocar a senha.', Boolean(error));
    busy(button, false);
  });
}

function changePassword() {
  root.innerHTML = '<section class="login-card"><p class="eyebrow">Acesso ao painel</p><h1>Nova senha.</h1><form id="password-form"><label>Nova senha<input name="password" type="password" minlength="10" autocomplete="new-password" required></label><label>Repita a senha<input name="confirmation" type="password" minlength="10" autocomplete="new-password" required></label><button class="primary" type="submit">Salvar senha</button></form><p data-message aria-live="polite"></p></section>';
  root.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('button');
    if (form.password.value !== form.confirmation.value) { message('As senhas precisam ser iguais.', true); return; }
    busy(button, true);
    const { error } = await client.auth.updateUser({ password: form.password.value });
    if (error) { message(friendlyError(error), true); busy(button, false); return; }
    recovery = false; history.replaceState(null, '', `${base}admin/`); await enter();
  });
}

async function enter() {
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session) { login(); return; }
  if (recovery) { changePassword(); return; }
  const { data: allowed, error } = await client.rpc('portfolio_access');
  if (error) throw error;
  if (!allowed) {
    root.innerHTML = '<section class="login-card"><h1>Acesso não liberado.</h1><p>Esta conta ainda não tem permissão para editar o portfólio.</p><button type="button" class="secondary" id="logout">Sair</button></section>';
    root.querySelector('#logout').addEventListener('click', signOut);
    return;
  }
  projects = await listProjects(true);
  overview();
}

async function signOut() {
  if (!leaveEditor()) return;
  const { error } = await client.auth.signOut();
  if (error) message(friendlyError(error), true);
  else login();
}

function leaveEditor() {
  if (saving) return false;
  if (dirty && !confirm('Sair sem salvar as alterações?')) return false;
  for (const media of editor?.media || []) if (media.blob) URL.revokeObjectURL(media.blob);
  editor = null; dirty = false;
  return true;
}

function overview(notice = '') {
  root.innerHTML = `<section><div class="panel-heading"><div><p class="eyebrow">Seu portfólio</p><h1>Trabalhos</h1><p class="muted">${projects.filter(p => p.status === 'published').length} publicados · ${projects.filter(p => p.status === 'draft').length} rascunhos</p></div><div class="heading-actions"><button class="plain" id="logout" type="button">Sair</button><button class="primary" id="new" type="button">Novo trabalho</button></div></div><p data-message aria-live="polite">${e(notice)}</p><div class="work-list">${projects.map((p, i) => `<article class="work-row"><div class="row-image">${p.media.length ? `<img src="${e((p.media.find(m => m.path === p.cover_path) || p.media[0]).url)}" alt="">` : '<span>Sem capa</span>'}</div><div class="row-info"><h2>${e(p.title)}</h2><p>${e(p.category || 'Categoria a preencher')}</p><span class="status-pill${p.status === 'draft' ? ' draft' : ''}">${p.status === 'published' ? 'Publicado' : 'Rascunho'}</span></div><div class="row-actions"><div class="order-actions"><button type="button" data-move="${i}" data-direction="-1" aria-label="Subir ${e(p.title)}" ${i === 0 ? 'disabled' : ''}>Subir</button><button type="button" data-move="${i}" data-direction="1" aria-label="Descer ${e(p.title)}" ${i === projects.length - 1 ? 'disabled' : ''}>Descer</button></div><button class="secondary" type="button" data-edit="${p.id}">Editar</button></div></article>`).join('') || '<div class="empty-state"><h2>Seu próximo trabalho começa aqui.</h2><p>Adicione as imagens e conte um pouco sobre o projeto.</p></div>'}</div></section>`;
  root.querySelector('#logout').addEventListener('click', signOut);
  root.querySelector('#new').addEventListener('click', () => openEditor());
  root.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => openEditor(projects.find(p => p.id === button.dataset.edit))));
  root.querySelectorAll('[data-move]').forEach(button => button.addEventListener('click', async () => {
    const i = Number(button.dataset.move), j = i + Number(button.dataset.direction);
    const reordered = [...projects]; [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    root.querySelectorAll('[data-move]').forEach(b => b.disabled = true);
    try { await reorderProjects(reordered.map(p => p.id)); projects = reordered.map((p, i) => ({ ...p, position: i + 1 })); overview('Ordem atualizada no portfólio.'); }
    catch (error) { overview(); message(friendlyError(error), true); }
  }));
  const initial = initialImportState(projects);
  if (!projects.length || (initial.imported > 0 && initial.pending > 0)) {
    const empty = root.querySelector('.empty-state') || root.querySelector('.work-list');
    empty.insertAdjacentHTML('beforeend', `<div class="import-initial"><button type="button" class="secondary" id="import">${initial.imported ? 'Importar trabalhos preparados restantes' : 'Importar os 6 trabalhos preparados'}</button></div>`);
    root.querySelector('#import').addEventListener('click', async () => {
      saving = true;
      root.querySelectorAll('button').forEach(button => button.disabled = true);
      try {
        await importInitial(projects, message);
        projects = await listProjects(true); overview('Os seis trabalhos estão no portfólio.');
      } catch (error) {
        try { projects = await listProjects(true); } catch { /* Mantém a possibilidade de tentar novamente. */ }
        overview(); message(friendlyError(error), true);
      }
      finally { saving = false; }
    });
  }
}

function openEditor(project) {
  editor = project ? structuredClone(project) : {
    id: crypto.randomUUID(), slug: '', title: '', category: '', description: '',
    position: Math.max(0, ...projects.map(p => p.position)) + 1,
    status: 'draft', cover_layout: 'single', cover_path: null, media: [],
  };
  editor.isNew = !project; editor.originalPaths = project?.media.map(m => m.path) || [];
  dirty = false;
  root.innerHTML = `<section class="edit-section"><div class="panel-heading"><div><p class="eyebrow">${project ? 'Editar trabalho' : 'Novo trabalho'}</p><h1>${project ? e(project.title) : 'Dê forma à próxima ideia.'}</h1></div><button class="plain" type="button" id="back">Voltar aos trabalhos</button></div><form id="project-form"><div class="editor-grid"><div class="editor-copy"><label>Título<input name="title" value="${e(editor.title)}" maxlength="160" required placeholder="Nome do projeto"></label><label>Categoria<input name="category" value="${e(editor.category)}" maxlength="160" placeholder="Ex.: Identidade visual"></label><label>Sobre o trabalho<textarea name="description" rows="8" maxlength="12000" placeholder="Conte a ideia, o processo e o resultado.">${e(editor.description)}</textarea></label><label>Endereço do trabalho<input name="slug" value="${e(editor.slug)}" maxlength="100" pattern="[a-z0-9]+(-[a-z0-9]+)*" required ${project ? 'readonly' : ''}><small>O endereço fica fixo depois de salvar para preservar os links.</small></label><label>Composição da capa<select name="cover_layout" aria-label="Composição da capa"><option value="single" ${editor.cover_layout === 'single' ? 'selected' : ''}>Uma imagem</option><option value="triptych" ${editor.cover_layout === 'triptych' ? 'selected' : ''}>Três primeiras imagens lado a lado</option></select></label></div><div class="editor-images"><div class="section-heading"><h2>Imagens</h2><span data-count></span></div><p class="muted">Escolha a capa e organize as imagens do projeto.</p><label class="upload-zone"><span>Adicionar imagens</span><small>JPG, PNG ou WebP · até 8 MB por imagem</small><input id="upload" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><div id="media-list"></div></div></div><p data-message aria-live="polite"></p><div class="save-bar"><span class="save-hint">${editor.status === 'published' ? 'Este trabalho está no portfólio.' : 'Rascunhos ficam visíveis apenas no painel.'}</span><div><button type="button" class="secondary" id="draft">Salvar como rascunho</button><button type="submit" class="primary">${editor.status === 'published' ? 'Salvar e manter publicado' : 'Salvar e publicar'}</button></div></div>${project ? '<button type="button" class="delete-button" id="delete">Excluir trabalho</button>' : ''}</form></section>`;
  root.querySelector('#back').addEventListener('click', () => { if (leaveEditor()) overview(); });
  const form = root.querySelector('form');
  let customSlug = false;
  form.slug.addEventListener('input', () => { customSlug = true; });
  form.title.addEventListener('input', () => { if (editor.isNew && !customSlug) form.slug.value = slugify(form.title.value); });
  form.addEventListener('input', () => { dirty = true; });
  form.addEventListener('change', () => { dirty = true; });
  form.addEventListener('submit', event => { event.preventDefault(); persist('published'); });
  root.querySelector('#draft').addEventListener('click', () => { if (form.reportValidity()) persist('draft'); });
  root.querySelector('#upload').addEventListener('change', async event => {
    const files = [...event.target.files];
    try {
      if (editor.media.length + files.length > 40) throw new Error('Use até 40 imagens por trabalho.');
      files.forEach(validateImage);
      for (const file of files) {
        const blob = URL.createObjectURL(file);
        try {
          await new Promise((resolve, reject) => { const image = new Image(); image.onload = resolve; image.onerror = () => reject(new Error(`${file.name}: esse arquivo não é uma imagem válida.`)); image.src = blob; });
        } catch (error) { URL.revokeObjectURL(blob); throw error; }
        const path = `pending/${crypto.randomUUID()}`;
        editor.media.push({ path, alt: '', file, blob, url: blob });
        if (!editor.cover_path) editor.cover_path = path;
      }
      dirty = true; renderMedia(); message('Imagens adicionadas. Salve o trabalho para enviar.');
    } catch (error) { renderMedia(); message(friendlyError(error), true); }
    event.target.value = '';
  });
  root.querySelector('#delete')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    if (!confirm(`Excluir “${editor.title}” e as imagens deste trabalho?`)) return;
    busy(button, true);
    try {
      const paths = [...new Set([...editor.originalPaths, ...editor.media.filter(m => !m.file).map(m => m.path)])];
      await deleteProject(editor.id, paths);
      dirty = false; leaveEditor(); projects = await listProjects(true); overview('Trabalho excluído.');
    } catch (error) {
      // A exclusão do registro pode ter sido concluída mesmo que a limpeza falhe.
      try { projects = await listProjects(true); } catch { /* Preserva a mensagem original. */ }
      if (!projects.some(p => p.id === editor.id)) { dirty = false; leaveEditor(); overview('Trabalho excluído. Algumas imagens podem precisar de limpeza no armazenamento.'); }
      else { message(friendlyError(error), true); busy(button, false); }
    }
  });
  renderMedia(); window.scrollTo(0, 0);
}

function renderMedia() {
  root.querySelector('[data-count]').textContent = `${editor.media.length} / 40`;
  root.querySelector('#media-list').innerHTML = editor.media.map((m, i) => `<article class="media-item"><img src="${e(m.url)}" alt="${e(m.alt)}"><div><div class="media-heading"><span>Imagem ${i + 1}</span><button type="button" class="cover-button${m.path === editor.cover_path ? ' selected' : ''}" data-cover="${i}" aria-pressed="${m.path === editor.cover_path}">${m.path === editor.cover_path ? 'Capa escolhida' : 'Usar como capa'}</button></div><label>Descrição da imagem<input data-alt="${i}" value="${e(m.alt)}" maxlength="600" placeholder="Descreva a imagem para acessibilidade"></label><div class="media-actions"><button type="button" data-reorder="${i}" data-direction="-1" aria-label="Subir imagem ${i + 1}" ${i === 0 ? 'disabled' : ''}>Subir</button><button type="button" data-reorder="${i}" data-direction="1" aria-label="Descer imagem ${i + 1}" ${i === editor.media.length - 1 ? 'disabled' : ''}>Descer</button><button type="button" class="plain" data-remove="${i}">Remover</button></div></div></article>`).join('') || '<p class="empty-media">As imagens que você escolher aparecem aqui.</p>';
  root.querySelectorAll('[data-alt]').forEach(input => input.addEventListener('input', () => { editor.media[Number(input.dataset.alt)].alt = input.value; dirty = true; }));
  root.querySelectorAll('[data-cover]').forEach(button => button.addEventListener('click', () => { editor.cover_path = editor.media[Number(button.dataset.cover)].path; dirty = true; renderMedia(); }));
  root.querySelectorAll('[data-reorder]').forEach(button => button.addEventListener('click', () => {
    const i = Number(button.dataset.reorder), j = i + Number(button.dataset.direction);
    [editor.media[i], editor.media[j]] = [editor.media[j], editor.media[i]];
    dirty = true; renderMedia();
  }));
  root.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => {
    const [removed] = editor.media.splice(Number(button.dataset.remove), 1);
    if (removed.blob) URL.revokeObjectURL(removed.blob);
    if (removed.path === editor.cover_path) editor.cover_path = editor.media[0]?.path || null;
    dirty = true; renderMedia();
  }));
}

async function persist(status) {
  if (saving) return;
  const form = root.querySelector('#project-form');
  const record = { ...editor, title: form.title.value, slug: form.slug.value, category: form.category.value,
    description: form.description.value, cover_layout: form.cover_layout.value, status };
  try { validateProject(record); } catch (error) { message(friendlyError(error), true); return; }
  saving = true;
  root.querySelectorAll('button,input,textarea,select').forEach(node => node.disabled = true);
  message('Enviando imagens e salvando trabalho…');
  try {
    for (const media of record.media) if (media.file) {
      const oldPath = media.path;
      media.path = await uploadImage(record.id, media.file);
      media.file = null;
      if (record.cover_path === oldPath) record.cover_path = media.path;
      if (editor.cover_path === oldPath) editor.cover_path = media.path;
    }
    await saveProject(record);
    // A gravação já foi concluída. Uma falha de atualização da tela não desfaz a publicação.
    dirty = false;
    const removed = editor.originalPaths.filter(path => !record.media.some(m => m.path === path));
    let notice = status === 'published' ? 'Trabalho publicado no portfólio.' : 'Rascunho salvo. Ele não aparece no portfólio.';
    try { await removeImages(removed); } catch { notice += ' Algumas imagens antigas precisam de limpeza no armazenamento.'; }
    saving = false; leaveEditor();
    try { projects = await listProjects(true); overview(notice); }
    catch (error) { root.innerHTML = '<div class="login-card"><h1>Trabalho salvo.</h1><p>Não foi possível atualizar a lista agora.</p><button class="secondary" id="reload">Atualizar lista</button><p data-message aria-live="polite"></p></div>'; root.querySelector('#reload').addEventListener('click', () => enter().catch(error => message(friendlyError(error), true))); }
  } catch (error) {
    saving = false;
    root.querySelectorAll('button,input,textarea,select').forEach(node => node.disabled = false);
    renderMedia();
    message(friendlyError(error), true);
  }
}

window.addEventListener('beforeunload', event => { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } });
if (!configured) {
  root.innerHTML = '<section class="login-card"><p class="eyebrow">Painel do portfólio</p><h1>Falta ativar o acesso.</h1><p>O painel está preparado. Após conectar a conta do portfólio, a Camy poderá entrar e publicar seus trabalhos aqui.</p></section>';
} else {
  client.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') { recovery = true; setTimeout(changePassword, 0); }
    if (event === 'SIGNED_OUT') { editor = null; dirty = false; setTimeout(login, 0); }
  });
  enter().catch(error => { login(); message(friendlyError(error), true); });
}

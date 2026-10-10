import './styles.css';
import './admin.css';
import { client, configured, secureConnection, listProjects, saveProject, uploadImage, removeImages, deleteProject, reorderProjects, friendlyError } from './backend.js';
import { slugify, validateImage, validateProject, escapeHTML as e } from './project.js';
import { importInitial, initialImportState } from './import-initial.js';
import { createAuthBoundary, httpsLocation, sessionExpired } from './security.js';

const root = document.querySelector('#admin');
const base = import.meta.env.BASE_URL;
let projects = [], editor = null, dirty = false, saving = false, processingImages = false;
let recovery = new URLSearchParams(location.search).get('senha') === 'alterar';
const auth = createAuthBoundary();
let entering = null;
let signingOut = false;

function message(text, error = false) {
  const node = root.querySelector('[data-message]');
  if (!node) return;
  node.textContent = text;
  node.classList.toggle('error', error);
  node.setAttribute('role', error ? 'alert' : 'status');
}

function busy(button, value) { button.disabled = value; button.setAttribute('aria-busy', String(value)); }

function clearEditor() {
  for (const media of editor?.media || []) if (media.blob) URL.revokeObjectURL(media.blob);
  editor = null; dirty = false; processingImages = false;
}

function clearWorkspace() { clearEditor(); projects = []; saving = false; }

function endSession(notice = 'Sua sessão terminou. Entre novamente para continuar.', error = true) {
  auth.invalidate(); clearWorkspace();
  if (recovery) history.replaceState(null, '', `${base}admin/`);
  recovery = false;
  login(notice, error);
}

function expired(error) {
  if (!sessionExpired(error)) return false;
  endSession(); return true;
}

function login(notice = '', error = false) {
  clearWorkspace();
  root.innerHTML = `<section class="login-card"><p class="eyebrow">Seu espaço de trabalho</p><h1>Oi, Camy.</h1><p class="muted">Entre para cuidar do seu portfólio.</p><form id="login-form"><label>E-mail<input name="email" type="email" autocomplete="username" required></label><label>Senha<input name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Entrar</button><button class="plain" type="button" id="forgot">Esqueci minha senha</button></form><p data-message aria-live="polite"></p></section>`;
  root.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('button');
    if (button.disabled) return;
    const ticket = auth.capture();
    busy(button, true); message('Entrando…');
    try {
      const { error } = await client.auth.signInWithPassword({ email: form.email.value, password: form.password.value });
      if (error) throw error;
      if (form.isConnected) await enter();
    } catch (error) { if (auth.current(ticket) && form.isConnected) message(friendlyError(error), true); }
    finally { if (button.isConnected) busy(button, false); }
  });
  root.querySelector('#forgot').addEventListener('click', async event => {
    const button = event.currentTarget;
    if (button.disabled) return;
    const email = root.querySelector('[name="email"]');
    if (!email.reportValidity() || !email.value) { email.focus(); return; }
    const ticket = auth.capture();
    busy(button, true); message('Enviando o link de recuperação…');
    try {
      const { error } = await client.auth.resetPasswordForEmail(email.value, { redirectTo: `${location.origin}${base}admin/?senha=alterar` });
      if (error) throw error;
      if (auth.current(ticket) && button.isConnected) message('Se esse e-mail estiver cadastrado, você receberá um link para trocar a senha.');
    } catch (error) {
      if (auth.current(ticket) && button.isConnected) message(`Não foi possível enviar o link de recuperação. ${friendlyError(error)}`, true);
    } finally { if (button.isConnected) busy(button, false); }
  });
  if (notice) message(notice, error);
}

function changePassword() {
  root.innerHTML = '<section class="login-card"><p class="eyebrow">Acesso ao painel</p><h1>Nova senha.</h1><form id="password-form"><label>Nova senha<input name="password" type="password" minlength="10" autocomplete="new-password" required></label><label>Repita a senha<input name="confirmation" type="password" minlength="10" autocomplete="new-password" required></label><button class="primary" type="submit">Salvar senha</button></form><p data-message aria-live="polite"></p></section>';
  root.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('button');
    if (button.disabled) return;
    if (form.password.value !== form.confirmation.value) { message('As senhas precisam ser iguais.', true); return; }
    const ticket = auth.capture();
    busy(button, true); message('Salvando sua nova senha…');
    try {
      const { error } = await client.auth.updateUser({ password: form.password.value });
      if (!auth.current(ticket) || !form.isConnected) return;
      if (error) throw error;
      form.reset(); recovery = false; history.replaceState(null, '', `${base}admin/`);
      await enter();
      if (auth.current(ticket)) message('Senha atualizada. Você já pode cuidar do portfólio.');
    } catch (error) {
      if (auth.current(ticket) && form.isConnected && !expired(error)) message(`Não foi possível atualizar sua senha. ${friendlyError(error)}`, true);
    } finally { if (button.isConnected) busy(button, false); }
  });
}

function enter() {
  const ticket = auth.capture();
  if (entering?.ticket === ticket) return entering.promise;
  const request = { ticket, promise: null };
  request.promise = loadWorkspace(ticket).finally(() => { if (entering === request) entering = null; });
  entering = request;
  return request.promise;
}

async function loadWorkspace(ticket) {
  try {
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (!auth.current(ticket)) return;
    if (sessionError) throw sessionError;
    if (!session) {
      endSession(recovery ? 'Este link de recuperação expirou. Solicite um novo em “Esqueci minha senha”.' : '', recovery);
      return;
    }
    if (auth.observe('SESSION_CHECK', session) === 'enter') clearWorkspace();
    ticket = auth.capture();
    if (recovery) { if (!editor) changePassword(); return; }
    const { data: allowed, error } = await client.rpc('portfolio_access');
    if (!auth.current(ticket)) return;
    if (error) throw error;
    if (!allowed) {
      clearWorkspace();
      root.innerHTML = '<section class="login-card"><h1>Acesso não liberado.</h1><p>Esta conta ainda não tem permissão para editar o portfólio.</p><button type="button" class="secondary" id="logout">Sair</button><p data-message aria-live="polite"></p></section>';
      root.querySelector('#logout').addEventListener('click', signOut);
      return;
    }
    const loaded = await listProjects(true);
    if (!auth.current(ticket) || editor || saving) return;
    projects = loaded; overview();
  } catch (error) {
    if (!auth.current(ticket) || expired(error)) return;
    if (editor) { message(`Não foi possível atualizar o painel. Suas alterações continuam aqui. ${friendlyError(error)}`, true); return; }
    root.innerHTML = '<section class="login-card"><h1>Não foi possível abrir os trabalhos.</h1><p>Confira sua conexão e tente novamente.</p><button type="button" class="primary" id="retry">Tentar novamente</button><button type="button" class="plain" id="logout">Sair</button><p data-message aria-live="polite"></p></section>';
    message(friendlyError(error), true);
    root.querySelector('#retry').addEventListener('click', enter);
    root.querySelector('#logout').addEventListener('click', signOut);
  }
}

async function signOut(event) {
  if (saving || (dirty && !confirm('Sair sem salvar as alterações?'))) return;
  const button = event?.currentTarget, ticket = auth.capture();
  signingOut = true;
  if (button) busy(button, true);
  try {
    const { error } = await client.auth.signOut();
    if (error) throw error;
    if (auth.current(ticket)) endSession('Você saiu do painel.', false);
  } catch (error) {
    if (auth.current(ticket)) message(`Não foi possível sair agora. ${friendlyError(error)}`, true);
    else if (!auth.userId) message(`Você saiu deste navegador. Não foi possível encerrar as outras sessões. ${friendlyError(error)}`, true);
  } finally { signingOut = false; if (button?.isConnected) busy(button, false); }
}

function leaveEditor() {
  if (saving) return false;
  if (dirty && !confirm('Sair sem salvar as alterações?')) return false;
  clearEditor();
  return true;
}

function overview(notice = '') {
  root.innerHTML = `<section><div class="panel-heading"><div><p class="eyebrow">Seu portfólio</p><h1>Trabalhos</h1><p class="muted">${projects.filter(p => p.status === 'published').length} publicados · ${projects.filter(p => p.status === 'draft').length} rascunhos</p></div><div class="heading-actions"><button class="plain" id="logout" type="button">Sair</button><button class="primary" id="new" type="button">Novo trabalho</button></div></div><p data-message aria-live="polite">${e(notice)}</p><div class="work-list">${projects.map((p, i) => `<article class="work-row"><div class="row-image">${p.media.length ? `<img src="${e((p.media.find(m => m.path === p.cover_path) || p.media[0]).url)}" alt="">` : '<span>Sem capa</span>'}</div><div class="row-info"><h2>${e(p.title)}</h2><p>${e(p.category || 'Categoria a preencher')}</p><span class="status-pill${p.status === 'draft' ? ' draft' : ''}">${p.status === 'published' ? 'Publicado' : 'Rascunho'}</span></div><div class="row-actions"><div class="order-actions"><button type="button" data-move="${i}" data-direction="-1" aria-label="Subir ${e(p.title)}" ${i === 0 ? 'disabled' : ''}>Subir</button><button type="button" data-move="${i}" data-direction="1" aria-label="Descer ${e(p.title)}" ${i === projects.length - 1 ? 'disabled' : ''}>Descer</button></div><button class="secondary" type="button" data-edit="${p.id}">Editar</button></div></article>`).join('') || '<div class="empty-state"><h2>Seu próximo trabalho começa aqui.</h2><p>Adicione as imagens e conte um pouco sobre o projeto.</p></div>'}</div></section>`;
  root.querySelector('#logout').addEventListener('click', signOut);
  root.querySelector('#new').addEventListener('click', () => openEditor());
  root.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => openEditor(projects.find(p => p.id === button.dataset.edit))));
  root.querySelectorAll('[data-move]').forEach(button => button.addEventListener('click', async () => {
    if (saving) return;
    const ticket = auth.capture();
    const i = Number(button.dataset.move), j = i + Number(button.dataset.direction);
    const reordered = [...projects]; [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    saving = true; root.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      await reorderProjects(reordered.map(p => p.id));
      if (!auth.current(ticket)) return;
      projects = reordered.map((p, i) => ({ ...p, position: i + 1 })); overview('Ordem atualizada no portfólio.');
    } catch (error) {
      if (auth.current(ticket) && !expired(error)) { overview(); message(friendlyError(error), true); }
    } finally { if (auth.current(ticket)) saving = false; }
  }));
  const initial = initialImportState(projects);
  if (!projects.length || (initial.imported > 0 && initial.pending > 0)) {
    const empty = root.querySelector('.empty-state') || root.querySelector('.work-list');
    empty.insertAdjacentHTML('beforeend', `<div class="import-initial"><button type="button" class="secondary" id="import">${initial.imported ? 'Importar trabalhos preparados restantes' : 'Importar os 6 trabalhos preparados'}</button></div>`);
    root.querySelector('#import').addEventListener('click', async () => {
      if (saving) return;
      const ticket = auth.capture();
      saving = true;
      root.querySelectorAll('button').forEach(button => button.disabled = true);
      try {
        await importInitial(projects, text => { if (auth.current(ticket)) message(text); }, () => auth.current(ticket));
        if (!auth.current(ticket)) return;
        const loaded = await listProjects(true);
        if (!auth.current(ticket)) return;
        projects = loaded; overview('Os seis trabalhos estão no portfólio.');
      } catch (error) {
        if (!auth.current(ticket) || expired(error)) return;
        try {
          const loaded = await listProjects(true);
          if (!auth.current(ticket)) return;
          projects = loaded;
        } catch (refreshError) { if (!auth.current(ticket) || expired(refreshError)) return; }
        overview(); message(friendlyError(error), true);
      }
      finally { if (auth.current(ticket)) saving = false; }
    });
  }
}

function openEditor(project) {
  if (saving) return;
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
    if (saving || processingImages || !editor) return;
    const input = event.target, files = [...input.files], editing = editor, ticket = auth.capture();
    const current = () => auth.current(ticket) && editor === editing;
    processingImages = true; input.disabled = true;
    const saveButtons = [...root.querySelectorAll('#project-form button[type="submit"],#draft,#delete')];
    saveButtons.forEach(button => button.disabled = true);
    message('Preparando as imagens…');
    try {
      if (editing.media.length + files.length > 40) throw new Error('Use até 40 imagens por trabalho.');
      files.forEach(validateImage);
      for (const file of files) {
        const blob = URL.createObjectURL(file);
        try {
          await new Promise((resolve, reject) => { const image = new Image(); image.onload = resolve; image.onerror = () => reject(new Error(`${file.name}: esse arquivo não é uma imagem válida.`)); image.src = blob; });
        } catch (error) { URL.revokeObjectURL(blob); throw error; }
        if (!current()) { URL.revokeObjectURL(blob); return; }
        const path = `pending/${crypto.randomUUID()}`;
        editing.media.push({ path, alt: '', file, blob, url: blob });
        if (!editing.cover_path) editing.cover_path = path;
        dirty = true;
      }
      if (!current()) return;
      dirty = true; renderMedia(); message('Imagens adicionadas. Salve o trabalho para enviar.');
    } catch (error) { if (current()) { renderMedia(); message(friendlyError(error), true); } }
    finally {
      input.value = '';
      if (current()) {
        processingImages = false; input.disabled = false;
        saveButtons.forEach(button => button.disabled = false);
      }
    }
  });
  root.querySelector('#delete')?.addEventListener('click', async event => {
    if (saving || processingImages) return;
    const editing = editor, ticket = auth.capture();
    const current = () => auth.current(ticket) && editor === editing;
    if (!confirm(`Excluir “${editor.title}” e as imagens deste trabalho?`)) return;
    saving = true; root.querySelectorAll('button,input,textarea,select').forEach(node => node.disabled = true);
    try {
      const paths = [...new Set([...editing.originalPaths, ...editing.media.filter(m => !m.file).map(m => m.path)])];
      await deleteProject(editing.id, paths, current);
      if (!current()) return;
      const loaded = await listProjects(true);
      if (!current()) return;
      saving = false; dirty = false; leaveEditor(); projects = loaded; overview('Trabalho excluído.');
    } catch (error) {
      if (!current() || expired(error)) return;
      // A exclusão do registro pode ter sido concluída mesmo que a limpeza falhe.
      let loaded;
      try { loaded = await listProjects(true); } catch (refreshError) { if (!current() || expired(refreshError)) return; }
      if (!current()) return;
      saving = false;
      if (loaded && !loaded.some(p => p.id === editing.id)) {
        dirty = false; leaveEditor(); projects = loaded; overview('Trabalho excluído. Algumas imagens podem precisar de limpeza no armazenamento.');
      } else {
        root.querySelectorAll('button,input,textarea,select').forEach(node => node.disabled = false);
        renderMedia(); message(friendlyError(error), true);
      }
    } finally { if (current()) saving = false; }
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
  if (saving || !editor) return;
  if (processingImages) { message('Aguarde as imagens terminarem de carregar antes de salvar.', true); return; }
  const editing = editor, ticket = auth.capture();
  const current = () => auth.current(ticket) && editor === editing;
  const form = root.querySelector('#project-form');
  const record = { ...editing, title: form.title.value, slug: form.slug.value, category: form.category.value,
    description: form.description.value, cover_layout: form.cover_layout.value, status };
  try { validateProject(record); } catch (error) { message(friendlyError(error), true); return; }
  saving = true;
  root.querySelectorAll('button,input,textarea,select').forEach(node => node.disabled = true);
  message('Enviando imagens e salvando trabalho…');
  try {
    for (const media of record.media) if (media.file) {
      const oldPath = media.path;
      const path = await uploadImage(record.id, media.file);
      if (!current()) return;
      media.path = path;
      media.file = null;
      if (record.cover_path === oldPath) record.cover_path = media.path;
      if (editing.cover_path === oldPath) editing.cover_path = media.path;
    }
    await saveProject(record);
    if (!current()) return;
    // A gravação já foi concluída. Uma falha de atualização da tela não desfaz a publicação.
    dirty = false;
    const removed = editing.originalPaths.filter(path => !record.media.some(m => m.path === path));
    let notice = status === 'published' ? 'Trabalho publicado no portfólio.' : 'Rascunho salvo. Ele não aparece no portfólio.';
    try { await removeImages(removed); }
    catch (error) { if (!current() || expired(error)) return; notice += ' Algumas imagens antigas precisam de limpeza no armazenamento.'; }
    if (!current()) return;
    saving = false; leaveEditor();
    try {
      const loaded = await listProjects(true);
      if (!auth.current(ticket) || editor) return;
      projects = loaded; overview(notice);
    } catch (error) {
      if (!auth.current(ticket) || editor || expired(error)) return;
      root.innerHTML = '<div class="login-card"><h1>Trabalho salvo.</h1><p>Não foi possível atualizar a lista agora.</p><button class="secondary" id="reload">Atualizar lista</button><p data-message aria-live="polite"></p></div>';
      root.querySelector('#reload').addEventListener('click', enter);
      message(friendlyError(error), true);
    }
  } catch (error) {
    if (!current() || expired(error)) return;
    saving = false;
    root.querySelectorAll('button,input,textarea,select').forEach(node => node.disabled = false);
    renderMedia();
    message(friendlyError(error), true);
  }
}

window.addEventListener('beforeunload', event => { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } });
if (!secureConnection) {
  const secureURL = httpsLocation(location);
  root.innerHTML = `<section class="login-card"><p class="eyebrow">Acesso seguro ao painel</p><h1>Entre pelo endereço seguro.</h1><p>Para proteger sua senha e seus trabalhos, o painel precisa de uma conexão HTTPS.</p>${secureURL ? `<a class="primary" href="${e(secureURL)}">Abrir painel com HTTPS</a><p class="muted">Se o endereço seguro ainda não abrir, aguarde a ativação do certificado do domínio.</p>` : '<p>Abra o painel pelo endereço HTTPS do portfólio.</p>'}</section>`;
} else if (!configured) {
  root.innerHTML = '<section class="login-card"><p class="eyebrow">Painel do portfólio</p><h1>Falta ativar o acesso.</h1><p>O painel está preparado. Após conectar a conta do portfólio, a Camy poderá entrar e publicar seus trabalhos aqui.</p></section>';
} else {
  client.auth.onAuthStateChange((event, session) => {
    const action = auth.observe(event, session);
    if (action === 'login') {
      const initial = event === 'INITIAL_SESSION';
      const notice = signingOut ? 'Você saiu do painel.' : initial
        ? (recovery ? 'Este link de recuperação expirou. Solicite um novo em “Esqueci minha senha”.' : '') : undefined;
      endSession(notice, !signingOut && (!initial || recovery));
    } else if (action === 'recovery') {
      clearWorkspace(); recovery = true;
      const ticket = auth.capture();
      setTimeout(() => { if (auth.current(ticket)) changePassword(); }, 0);
    } else if (action === 'enter') {
      clearWorkspace();
      const ticket = auth.capture();
      root.innerHTML = '<p class="page-message" role="status">Abrindo seus trabalhos…</p>';
      setTimeout(() => { if (auth.current(ticket)) enter(); }, 0);
    }
  });
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !auth.userId) return;
    const ticket = auth.capture();
    try {
      const { data: { session }, error } = await client.auth.getSession();
      if (!auth.current(ticket)) return;
      if (error) { expired(error); return; }
      if (!session) endSession();
      else if (session.user.id !== auth.userId) {
        auth.observe('SESSION_CHECK', session); clearWorkspace();
        await enter();
      }
    } catch (error) { if (auth.current(ticket)) expired(error); }
  });
  enter();
}

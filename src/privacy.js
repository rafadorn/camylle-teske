import { analyticsPath } from './analytics-path.js';

export const CONSENT_KEY = 'camy-statistics-consent-v1';
const choices = new Set(['accepted', 'refused']);

export function createPrivacy({ endpoint, publicKey, base, fetcher = fetch, win = window, doc = document }) {
  let choice = null, path = null, attempted = false, pending = null;
  const readChoice = () => {
    try { const value = win.localStorage.getItem(CONSENT_KEY); return choices.has(value) ? value : null; } catch { return null; }
  };
  choice = readChoice();
  const section = doc.createElement('section');
  section.className = 'privacy-banner';
  section.setAttribute('role', 'region'); section.setAttribute('aria-labelledby', 'privacy-title');
  section.innerHTML = '<h2 id="privacy-title">Podemos contar seu acesso?</h2><p>Com sua autorização, contamos acessos e páginas visitadas, sem identificar você. Recusar não impede a navegação.</p><div class="privacy-actions"><button type="button" data-choice="accepted">Aceitar estatísticas</button><button type="button" data-choice="refused">Recusar</button></div><a class="privacy-info">Como usamos os dados</a>';
  section.querySelector('.privacy-info').href = base + 'privacidade/';
  const dialog = doc.createElement('dialog'); dialog.className = 'privacy-dialog'; dialog.setAttribute('aria-labelledby', 'privacy-dialog-title');
  dialog.innerHTML = '<button type="button" class="privacy-close" aria-label="Fechar preferências">×</button><h2 id="privacy-dialog-title">Preferências de privacidade</h2><p>Estatísticas são opcionais. Você pode aceitar ou recusar e continuar usando o site.</p><p>Contamos acessos por dia e por página, sem nomes, e-mails, IPs ou identificadores individuais no relatório. Acessos não são pessoas únicas.</p><p data-privacy-current></p><div class="privacy-actions"><button type="button" data-choice="accepted">Aceitar estatísticas</button><button type="button" data-choice="refused">Recusar</button></div><a class="privacy-info">Ver política de privacidade</a>';
  dialog.querySelector('.privacy-info').href = base + 'privacidade/';
  const status = doc.createElement('p'); status.className = 'privacy-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  doc.body.append(section, dialog, status);
  let opener = null;

  function render() {
    section.hidden = choice !== null;
    dialog.querySelector('[data-privacy-current]').textContent = choice === 'accepted' ? 'Sua escolha atual: estatísticas permitidas. Você pode interromper os próximos envios escolhendo Recusar.' : choice === 'refused' ? 'Sua escolha atual: estatísticas recusadas.' : 'Você ainda não escolheu. Nenhuma estatística é enviada antes da autorização.';
    dialog.querySelectorAll('[data-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.choice === choice)));
  }
  async function send() {
    if (choice !== 'accepted' || !path || attempted || !endpoint || !publicKey || doc.visibilityState === 'hidden') return;
    attempted = true;
    const controller = new AbortController(); pending = controller;
    const timeout = win.setTimeout(() => controller.abort(), 5000);
    try {
      // This request never consumes an authenticated session or forwards cookies.
      await fetcher(endpoint, { method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { 'content-type': 'application/json', apikey: publicKey },
        body: JSON.stringify({ path, consent: 'statistics-v1' }), signal: controller.signal });
    } catch { /* Statistics failing must never interrupt the portfolio. */ }
    finally { win.clearTimeout(timeout); if (pending === controller) pending = null; }
  }
  function choose(next) {
    if (!choices.has(next)) return;
    choice = next;
    let saved = false;
    try { win.localStorage.setItem(CONSENT_KEY, choice); saved = true; } catch { /* Choice still applies to this page. */ }
    if (choice !== 'accepted') pending?.abort();
    render(); dialog.close();
    status.textContent = `${saved ? 'Preferência salva.' : 'Preferência aplicada nesta página.'} ${choice === 'accepted' ? 'Estatísticas permitidas.' : 'Estatísticas recusadas.'}`;
    if (opener?.isConnected) opener.focus();
    void send();
  }
  for (const container of [section, dialog]) container.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', () => choose(button.dataset.choice)));
  dialog.querySelector('.privacy-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  for (const button of doc.querySelectorAll('[data-privacy-open]')) button.addEventListener('click', () => { opener = button; render(); dialog.showModal(); });
  win.addEventListener('storage', event => { if (event.key === CONSENT_KEY || event.key === null) { choice = readChoice(); if (choice !== 'accepted') pending?.abort(); render(); void send(); } });
  win.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    // A restored page must honor a refusal made while it was frozen.
    pending?.abort(); choice = readChoice(); attempted = false; render(); void send();
  });
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden) void send(); });
  render();
  return { page(value) { path = analyticsPath(value); void send(); } };
}

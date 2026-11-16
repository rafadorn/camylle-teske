import { publicationVersion, validateStatus, STATUS_FILE } from './publication.js';

export function mountPublication(anchor, { projects, base, auth, fetcher = fetch }) {
  const ticket = auth.capture();
  const section = document.createElement('aside');
  section.className = 'publication-status';
  section.innerHTML = '<div><h2>Versão pública do site</h2><p data-publication-message role="status" aria-live="polite">Conferindo a última publicação…</p></div><button type="button" class="secondary">Conferir publicação</button>';
  anchor.before(section);
  const message = section.querySelector('[data-publication-message]');
  const button = section.querySelector('button');
  const current = () => auth.current(ticket) && section.isConnected;
  async function update() {
    button.disabled = true;
    try {
      const expected = await publicationVersion(projects);
      const response = await fetcher(base + STATUS_FILE + '?v=' + Date.now(), { cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error('Publicação indisponível.');
      const status = validateStatus(await response.json());
      if (!current()) return;
      const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(status.published_at));
      const updated = status.source_version === expected;
      section.dataset.publicationState = updated ? 'current' : 'pending';
      message.textContent = updated ? `Site atualizado. Última publicação: ${date}.` : `Há alterações salvas aguardando publicação. A última versão do site é de ${date}. A sincronização automática verifica mudanças a cada 15 minutos; a publicação pode levar mais tempo.`;
    } catch {
      if (current()) message.textContent = 'Não foi possível conferir a publicação agora. Seus trabalhos continuam salvos no painel.';
    } finally { if (current()) button.disabled = false; }
  }
  button.addEventListener('click', update);
  update();
}

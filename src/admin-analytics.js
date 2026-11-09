import { escapeHTML as e } from './project.js';
import { summarizeViews, analyticsURL } from './analytics-path.js';

const number = value => new Intl.NumberFormat('pt-BR').format(value);
const pageLabel = path => ({ '/': 'Início', '/projetos/': 'Projetos', '/sobre/': 'Sobre', '/contato/': 'Contato', '/privacidade/': 'Privacidade' }[path] || path);
const dateLabel = day => day.slice(8) + '/' + day.slice(5, 7);

export function mountAnalytics(before, { client, auth, expired, friendlyError, base }) {
  const details = document.createElement('details'); details.className = 'analytics-panel';
  details.innerHTML = '<summary>Estatísticas de acesso</summary><p class="muted">Acessos autorizados, sem identificar pessoas. Uma pessoa pode gerar vários acessos. Os dados começam na ativação desta contagem.</p><div class="analytics-controls"><label>Período<select aria-label="Período das estatísticas"><option value="7">Últimos 7 dias</option><option value="30" selected>Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select></label><button class="secondary" type="button">Atualizar estatísticas</button></div><p class="analytics-status" role="status" aria-live="polite"></p><div class="analytics-report"></div>';
  before.before(details);
  const report = details.querySelector('.analytics-report'), status = details.querySelector('.analytics-status'), select = details.querySelector('select'), refresh = details.querySelector('button');
  let data = null, loading = false;
  function render() {
    if (!data) return;
    const stats = summarizeViews(data, Number(select.value));
    report.innerHTML = `<dl class="analytics-totals"><div><dt>Hoje</dt><dd>${number(stats.today)}</dd></div><div><dt>Últimos 7 dias</dt><dd>${number(stats.week)}</dd></div><div><dt>Últimos 30 dias</dt><dd>${number(stats.month)}</dd></div></dl><p>${number(stats.total)} acessos no período selecionado · horário de Brasília.</p>${stats.pages.length ? `<h2>Páginas mais acessadas</h2><div class="analytics-table"><table><thead><tr><th scope="col">Página</th><th scope="col">Acessos</th></tr></thead><tbody>${stats.pages.map(row => `<tr><th scope="row"><a href="${e(analyticsURL(row.path, base))}" target="_blank" rel="noopener noreferrer">${e(pageLabel(row.path))}</a></th><td>${number(row.views)}</td></tr>`).join('')}</tbody></table></div><details class="analytics-days"><summary>Acessos por dia</summary><div class="analytics-table"><table><thead><tr><th scope="col">Dia</th><th scope="col">Acessos</th></tr></thead><tbody>${[...stats.days].reverse().map(row => `<tr><th scope="row">${e(dateLabel(row.day))}</th><td>${number(row.views)}</td></tr>`).join('')}</tbody></table></div></details>` : '<p class="muted">Ainda não há acessos autorizados neste período.</p>'}`;
  }
  async function load() {
    if (loading) return;
    const ticket = auth.capture(); loading = true; refresh.disabled = true; details.setAttribute('aria-busy', 'true'); status.textContent = 'Carregando estatísticas…';
    try {
      const response = await client.rpc('portfolio_analytics', { days: 90 });
      if (!auth.current(ticket) || !details.isConnected) return;
      if (response.error) throw response.error;
      if (!Array.isArray(response.data)) throw new Error('Resposta de estatísticas inválida.');
      data = response.data; render(); status.textContent = 'Estatísticas atualizadas.';
    } catch (error) {
      if (!auth.current(ticket) || !details.isConnected || expired(error)) return;
      status.textContent = 'Não foi possível carregar as estatísticas. ' + friendlyError(error);
    } finally { loading = false; if (details.isConnected) { refresh.disabled = false; details.removeAttribute('aria-busy'); } }
  }
  details.addEventListener('toggle', () => { if (details.open && data === null) void load(); });
  refresh.addEventListener('click', load); select.addEventListener('change', render);
}

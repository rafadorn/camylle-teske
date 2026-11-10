export const CARD_LAYOUTS = { auto: 'Composição automática', small: 'Pequena', wide: 'Larga', tall: 'Alta', feature: 'Destaque grande', full: 'Largura inteira' };
export const IMAGE_WIDTHS = { full: 'Largura inteira', half: 'Metade', third: 'Um terço' };
export const IMAGE_ALIGNS = { auto: 'Seguir a sequência', left: 'Esquerda', center: 'Centro', right: 'Direita' };
const own = (object, key) => Object.hasOwn(object, key);
export const cardLayout = project => own(CARD_LAYOUTS, project.card_layout) ? project.card_layout : 'auto';
export const imageWidth = media => own(IMAGE_WIDTHS, media.width) ? media.width : 'full';
export const imageAlign = media => own(IMAGE_ALIGNS, media.align) ? media.align : 'auto';
export const hasImageLayout = project => project.media.some(media => media.width !== undefined || media.align !== undefined);

export function validateLayout(project) {
  if (project.card_layout !== undefined && !own(CARD_LAYOUTS, project.card_layout)) throw new Error('Escolha um tamanho válido para a capa na grade.');
  for (const media of project.media) {
    if (media.width !== undefined && !own(IMAGE_WIDTHS, media.width)) throw new Error('Escolha uma largura válida para a imagem.');
    if (media.align !== undefined && !own(IMAGE_ALIGNS, media.align)) throw new Error('Escolha um alinhamento válido para a imagem.');
  }
}

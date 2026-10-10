import sharp from 'sharp';
export const hours = [9, 10, 11];
export function story(artworkHash: string) {
  return { schemaVersion: 1 as const, id: 'story-2026-10-10', date: '2026-10-10', timezone: 'Europe/Madrid', artworkHash, title: 'El jardín', premise: 'Una niña busca un lugar para su jardín.', trailer: 'Una niña prepara una sorpresa alegre entre las flores.', cast: [{ id: 'ana', identity: 'Niña con sombrero rojo' }], scenes: hours.map(hour => ({ hour, presentCast: ['ana'], state: 'La maceta sigue junto a la puerta.', action: `Ana cuida el jardín a las ${hour}.` })), ending: 'Los vecinos comparten el jardín.', createdAt: '2026-10-10T05:00:00.000Z' };
}
export async function image(color = 'red') { return sharp({ create: { width: 32, height: 24, channels: 3, background: color } }).png().toBuffer(); }

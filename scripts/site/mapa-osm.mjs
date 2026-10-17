// O mapa fixo de "Onde fica" (história 4.5): uma imagem do mapa de verdade, do OpenStreetMap,
// com o pino da casa. Roda à mão, uma vez, e o resultado fica no repositório; o site serve a
// imagem dele mesmo, sem pedir nada a outro site quando a página abre.
//
//   node scripts/site/mapa-osm.mjs           refaz os tamanhos a partir do original guardado
//   node scripts/site/mapa-osm.mjs --baixar  baixa o mapa de novo (só se a casa mudar de lugar)
//
// Regras de uso dos tiles do OpenStreetMap (operations.osmfoundation.org/policies/tiles):
// poucos tiles, uma vez só, um de cada vez, com User-Agent que diz quem pede, e o crédito
// "© colaboradores do OpenStreetMap" com link para openstreetmap.org/copyright ao lado do mapa.
//
// Saída:
//   assets-src/mapa/mapa-osm.png          o original, já com o pino (fora do `npm run images`)
//   public/img/mapa/mapa-<largura>.<avif|webp|png>
//   src/content/map.json                  tamanho, cor de espera e o ponto do mapa
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import sharp from "sharp";

const ZOOM = 16;
const WIDTH = 768;
const HEIGHT = 480;
const WIDTHS = [480, 768];
const TILE = 256;
const MASTER = "assets-src/mapa/mapa-osm.png";
const OUT = "public/img/mapa";
const MANIFEST = "src/content/map.json";
const USER_AGENT = "territorio-app/0.1 (+https://territoriofoz.com.br; mapa fixo do site, baixado uma vez)";

const house = JSON.parse(await readFile("src/content/house.json", "utf8"));
const { lat, lng, coords_confirmed: confirmed } = house.address;
if (typeof lat !== "number" || typeof lng !== "number" || confirmed === false) {
  console.error("Sem latitude e longitude confirmadas em src/content/house.json: o mapa não é feito (FR-10).");
  process.exit(1);
}

/** Latitude e longitude → pixel no mapa inteiro do zoom (projeção dos tiles, Web Mercator). */
function toPixel(latitude, longitude, zoom) {
  const size = TILE * 2 ** zoom;
  const sin = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

/** O pino da casa, nas cores do site: terracota, contorno ferro e o miolo papel. */
function pin() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="64" viewBox="-24 -60 48 64">
  <ellipse cx="0" cy="0" rx="9" ry="3" fill="#161311" opacity="0.35"/>
  <path d="M0 0 C-12 -17 -20 -27 -20 -38 A20 20 0 1 1 20 -38 C20 -27 12 -17 0 0 Z" fill="#A54829" stroke="#161311" stroke-width="2.5"/>
  <circle cx="0" cy="-38" r="7.5" fill="#F6F0E3"/>
</svg>`);
}

async function download() {
  const center = toPixel(lat, lng, ZOOM);
  const left = Math.round(center.x - WIDTH / 2);
  const top = Math.round(center.y - HEIGHT / 2);
  const [x0, x1] = [Math.floor(left / TILE), Math.floor((left + WIDTH - 1) / TILE)];
  const [y0, y1] = [Math.floor(top / TILE), Math.floor((top + HEIGHT - 1) / TILE)];
  const tiles = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const url = `https://tile.openstreetmap.org/${ZOOM}/${x}/${y}.png`;
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      tiles.push({ input: Buffer.from(await response.arrayBuffer()), left: (x - x0) * TILE, top: (y - y0) * TILE });
      await wait(500); // um de cada vez, sem pressa
    }
  }
  console.log(`${tiles.length} tiles baixados (zoom ${ZOOM})`);
  const sheet = await sharp({
    create: { width: (x1 - x0 + 1) * TILE, height: (y1 - y0 + 1) * TILE, channels: 3, background: "#f2efe9" },
  })
    .composite(tiles)
    .png()
    .toBuffer();
  // o recorte com a casa no meio, e o pino com a ponta exatamente no ponto da casa
  const crop = await sharp(sheet)
    .extract({ left: left - x0 * TILE, top: top - y0 * TILE, width: WIDTH, height: HEIGHT })
    .toBuffer();
  const pinX = Math.round(center.x - left);
  const pinY = Math.round(center.y - top);
  await mkdir("assets-src/mapa", { recursive: true });
  await sharp(crop)
    .composite([{ input: pin(), left: pinX - 24, top: pinY - 60 }])
    .png()
    .toFile(MASTER);
}

if (process.argv.includes("--baixar") || !existsSync(MASTER)) await download();

await mkdir(OUT, { recursive: true });
let bytes = 0;
for (const w of WIDTHS) {
  const resized = sharp(MASTER).resize({ width: w });
  const outputs = [
    [`mapa-${w}.avif`, resized.clone().avif({ quality: 55, effort: 6 })],
    [`mapa-${w}.webp`, resized.clone().webp({ quality: 80 })],
    [`mapa-${w}.png`, resized.clone().png({ palette: true, quality: 85, compressionLevel: 9 })],
  ];
  for (const [file, pipeline] of outputs) bytes += (await pipeline.toFile(`${OUT}/${file}`)).size;
}
const manifest = {
  note: "Feito por scripts/site/mapa-osm.mjs a partir do OpenStreetMap. Se a casa mudar de lugar, rode com --baixar.",
  width: WIDTH,
  height: HEIGHT,
  widths: WIDTHS,
  placeholder: "#f2efe9", // o fundo do mapa do OpenStreetMap, pintado enquanto a imagem chega
  lat,
  lng,
  zoom: ZOOM,
  credit_url: "https://www.openstreetmap.org/copyright",
};
await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`mapa em ${OUT}: ${WIDTHS.length * 3} arquivos, ${Math.round(bytes / 1024)} KB`);

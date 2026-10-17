// Transforma as fotos originais de assets-src/ nos tamanhos que o site serve:
// public/img/fotos/<nome>-<largura>.<avif|webp|jpg>, nunca mais largas que o original, e
// src/content/images.json com largura, altura e cor dominante (pintada enquanto carrega).
// Os metadados (câmera, GPS) somem ao recodificar.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { extname, join, basename } from "node:path";
import sharp from "sharp";

const SRC = "assets-src";
const OUT = "public/img/fotos";
const MANIFEST = "src/content/images.json";
const WIDTHS = [480, 960, 1600];

await mkdir(OUT, { recursive: true });
await mkdir("src/content", { recursive: true });

const manifest = {};
let files = 0;
let bytes = 0;

for (const file of (await readdir(SRC)).sort()) {
  if (![".jpg", ".jpeg", ".png", ".webp"].includes(extname(file).toLowerCase())) continue;
  const name = basename(file, extname(file));
  const input = sharp(join(SRC, file)).rotate();
  // metadata() descreve o arquivo como está gravado: uma foto de celular girada pelo EXIF (5 a 8) troca os lados
  const meta = await input.metadata();
  const turned = (meta.orientation ?? 1) >= 5;
  const width = turned ? meta.height : meta.width;
  const height = turned ? meta.width : meta.height;
  const { dominant } = await input.stats();
  const hex = "#" + [dominant.r, dominant.g, dominant.b].map((c) => c.toString(16).padStart(2, "0")).join("");
  const widths = [...new Set(WIDTHS.map((w) => Math.min(w, width)))];

  for (const w of widths) {
    const resized = input.clone().resize({ width: w, withoutEnlargement: true });
    const outputs = [
      [`${name}-${w}.avif`, resized.clone().avif({ quality: 52, effort: 5 })],
      [`${name}-${w}.webp`, resized.clone().webp({ quality: 74 })],
      [`${name}-${w}.jpg`, resized.clone().jpeg({ quality: 78, mozjpeg: true, progressive: true })],
    ];
    for (const [out, pipeline] of outputs) {
      const info = await pipeline.toFile(join(OUT, out));
      files++;
      bytes += info.size;
    }
  }
  manifest[name] = { width, height, placeholder: hex, widths };
}

await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log(`${Object.keys(manifest).length} fotos, ${files} arquivos, ${Math.round(bytes / 1024)} KB em ${OUT}`);

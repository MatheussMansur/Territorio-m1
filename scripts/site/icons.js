// Os ícones do site e do painel (história 4.8): os dois manifestos e o <head> apontam para
// os mesmos arquivos, feitos por scripts/site/build_icons.py a partir da raiz. O build falha quando
// falta um deles ou quando um tamanho obrigatório não é oferecido.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const MANIFESTS = ["site.webmanifest", "manifest-painel.webmanifest"];
// a tela inicial pede 192 e 512 (e um maskable), as abas o SVG e o 32, o iOS o 180
export const REQUIRED = ["/img/marca/icone.svg", "/img/marca/icone-32.png", "/img/marca/icone-180.png", "/img/marca/icone-192.png", "/img/marca/icone-512.png", "/img/marca/icone-mascaravel-512.png"];

/** Os problemas em frases: arquivos que faltam, tamanhos que um manifesto não oferece, manifestos diferentes. */
export function iconProblems(root) {
  const pub = join(root, "public");
  const problems = [];
  for (const file of REQUIRED) if (!existsSync(join(pub, file))) problems.push(`falta o ícone ${file} (rode python scripts/site/build_icons.py)`);
  const lists = [];
  for (const name of MANIFESTS) {
    const path = join(pub, name);
    if (!existsSync(path)) {
      problems.push(`falta o manifesto ${name}`);
      continue;
    }
    const icons = JSON.parse(readFileSync(path, "utf8")).icons || [];
    for (const icon of icons) if (!existsSync(join(pub, icon.src))) problems.push(`${name} aponta para ${icon.src}, que não existe`);
    for (const size of ["192x192", "512x512"]) if (!icons.some((i) => i.sizes === size)) problems.push(`${name} sem o tamanho ${size}`);
    if (!icons.some((i) => i.purpose === "maskable")) problems.push(`${name} sem o ícone para a tela inicial (maskable)`);
    lists.push(JSON.stringify(icons.map((i) => i.src).sort()));
  }
  if (lists.length === 2 && lists[0] !== lists[1]) problems.push("o manifesto do site e o do painel apontam para ícones diferentes");
  return problems;
}

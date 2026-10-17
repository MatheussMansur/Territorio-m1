// Os pares de cores do DESIGN.md (as tabelas "Contraste medido"), medidos a partir dos valores de
// src/styles/tokens.css nos dois temas (história 1.4, UX-DR-4, UX-DR-5): texto normal precisa de 4.5,
// tinta-3 sobre kraft é só para texto grande (3), e terracota pura nunca fica sobre fundo escuro.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../../src/styles/tokens.css", import.meta.url), "utf8");

/** Toda propriedade customizada do bloco :root principal com o valor cru (os temas e as paletas
 * especiais de algumas seções redefinem papéis nos próprios blocos, fora deste teste). */
const root = /:root\s*\{([\s\S]*?)\r?\n\}/.exec(css)[1];
const raw = new Map([...root.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

/** A cor hex de um token num tema, seguindo var() e light-dark(). */
function colour(name, theme = "light", depth = 0) {
  if (depth > 10) throw new Error(`laço em --${name}`);
  const value = raw.get(name);
  if (value == null) throw new Error(`--${name} não existe em tokens.css`);
  return resolve(value, theme, depth);
}
function resolve(value, theme, depth) {
  const ld = /^light-dark\((.+)\)$/.exec(value);
  if (ld) {
    let level = 0;
    let cut = -1;
    for (let i = 0; i < ld[1].length; i++) {
      if (ld[1][i] === "(") level++;
      else if (ld[1][i] === ")") level--;
      else if (ld[1][i] === "," && level === 0) cut = i;
    }
    return resolve((theme === "light" ? ld[1].slice(0, cut) : ld[1].slice(cut + 1)).trim(), theme, depth + 1);
  }
  const v = /^var\(--([\w-]+)\)$/.exec(value);
  if (v) return colour(v[1], theme, depth + 1);
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
  throw new Error(`valor que o teste não lê: ${value}`);
}

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [texto, fundo, o valor da tabela do DESIGN.md, mínimo]
const LIGHT = [
  ["ferro", "papel", 14.49, 4.5],
  ["ferro", "papel-claro", 16.29, 4.5],
  ["ferro", "kraft", 9.57, 4.5],
  ["tinta-2", "papel", 8.51, 4.5],
  ["tinta-2", "kraft", 5.62, 4.5],
  ["tinta-3", "papel", 5.39, 4.5],
  ["tinta-3", "kraft", 3.56, 3], // só texto grande
  ["papel-claro", "ferro", 16.29, 4.5],
  ["terracota", "papel", 4.62, 4.5],
  ["papel-claro", "terracota", 5.2, 4.5],
  ["terracota-escura", "papel", 7.14, 4.5],
  ["lampada", "ferro", 9.76, 4.5],
];
const DARK = [
  ["papel-claro", "noite", 17.27, 4.5],
  ["papel-claro", "ferro-2", 13.48, 4.5],
  ["papel-claro", "ferro-3", 14.82, 4.5],
  ["papel-no-escuro", "noite", 11.36, 4.5],
  ["papel-no-escuro", "ferro-2", 8.87, 4.5],
  ["rotulo-no-escuro", "noite", 7.35, 4.5],
  ["rotulo-no-escuro", "ferro-2", 5.73, 4.5],
  ["terracota-clara", "noite", 7.49, 4.5],
  ["terracota-clara", "ferro-2", 5.84, 4.5],
  ["noite", "terracota-clara", 7.49, 4.5],
  ["lampada", "noite", 10.35, 4.5],
];

for (const [label, pairs] of [["claro", LIGHT], ["escuro", DARK]]) {
  test(`pares do DESIGN.md no tema ${label}: o mínimo e o valor da tabela`, () => {
    for (const [fg, bg, table, min] of pairs) {
      const measured = contrast(colour(fg), colour(bg));
      assert.ok(measured >= min, `${fg} sobre ${bg}: ${measured.toFixed(2)} (mínimo ${min})`);
      assert.ok(Math.abs(measured - table) < 0.02, `${fg} sobre ${bg}: ${measured.toFixed(2)}, a tabela diz ${table}`);
    }
  });
}

test("os papéis de texto (--cor-*) passam de 4,5 sobre o fundo e a superfície, nos dois temas", () => {
  const texts = ["cor-texto", "cor-texto-suave", "cor-texto-fraco", "cor-atencao-texto", "cor-erro"];
  const grounds = ["cor-fundo", "cor-superficie"];
  for (const theme of ["light", "dark"]) {
    for (const t of texts) for (const g of grounds) {
      const c = contrast(colour(t, theme), colour(g, theme));
      assert.ok(c >= 4.5, `${t} sobre ${g} (${theme}): ${c.toFixed(2)}`);
    }
    const button = contrast(colour("cor-acao-texto", theme), colour("cor-acao", theme));
    assert.ok(button >= 4.5, `botão (${theme}): ${button.toFixed(2)}`);
  }
});

test("terracota pura nunca sobre fundo escuro", () => {
  const terracota = colour("terracota");
  // nenhum papel vira terracota pura no tema escuro
  for (const name of raw.keys()) {
    if (!name.startsWith("cor-")) continue;
    let dark;
    try {
      dark = colour(name, "dark");
    } catch {
      continue; // colour-mix e parecidos: não é uma cor simples
    }
    assert.notEqual(dark, terracota, `--${name} vira terracota pura no tema escuro`);
  }
  // e as superfícies escuras do tema claro (barras, a folha da noite) também não a usam
  for (const name of [...raw.keys()].filter((n) => n.startsWith("cor-escuro"))) {
    let value;
    try {
      value = colour(name, "light");
    } catch {
      continue;
    }
    assert.notEqual(value, terracota, `--${name} é terracota pura numa superfície escura`);
  }
  assert.ok(contrast(terracota, colour("noite")) < 4.5, "a regra existe porque terracota sobre noite não passa");
});

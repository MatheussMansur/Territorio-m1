// Toda parte dinâmica da interface é desenhada com lit-html: os valores são escapados por padrão,
// então um texto que veio da API nunca vira HTML.
export { html, nothing, render, svg } from "lit-html";
export { classMap } from "lit-html/directives/class-map.js";
export { ifDefined } from "lit-html/directives/if-defined.js";
export { repeat } from "lit-html/directives/repeat.js";

/** Atalho para querySelector. */
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

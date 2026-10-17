// A ficha do cliente (histórias 5.15 a 5.17): números, notas, etiquetas, preferências, consentimentos e
// o histórico de reservas; "Ver telefone" depois da confirmação de identidade; bloquear com motivo;
// perdoar uma falta com motivo; exportar e anonimizar só para o dono. Uma gravação feita por cima
// de outra mais nova de outra pessoa (412) pede para juntar as duas notas ou descartar esta.
import { confirmAction } from "../../../components/confirm.js";
import { toast } from "../../../components/toast.js";
import { formatDay } from "../../../lib/dates.js";
import { html, nothing, render } from "../../../lib/html.js";
import { formatPhone } from "../../../lib/phone.js";
import { t } from "../../../lib/strings.js";
import { uuid } from "../../../lib/uuid.js";
import * as api from "../../../services/api/staff-clientes.js";
import * as reservas from "../../../services/api/staff-reservas.js";
import { withIdentity } from "../../identity.js";
import { canDo } from "../../nav.js";
import { dayOf, errorState, fieldError, formDialog, loadingState, messageOf, saveFile, slug } from "./comum.js";
import { tagBadges } from "./lista.js";

import { AREA } from "../../area-names.js";
const SOURCE = { site: "Site", staff: "Equipe", whatsapp: "WhatsApp", phone: "Telefone", walk_in: "Sem reserva" };
const LOCALE = { pt: "português", es: "espanhol", en: "inglês" };

const statusBadge = (status) => html`<span class=${`badge badge--${status.replace("_", "-")}`}>${t(`status.${status}`)}</span>`;

/** Uma cópia legível da exportação, para quem não abre JSON. */
function readable(data) {
  const c = data.customer;
  const lines = [
    `Dados guardados pelo ${data.house} sobre ${c.name || "cliente anonimizado"}`,
    `Exportado em ${new Date(data.exported_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    "",
    `Telefone: ${c.phone ? formatPhone(c.phone) : "—"}`,
    `Língua das mensagens: ${LOCALE[c.locale] || c.locale}`,
    `Visitas: ${c.visits} · Faltas: ${c.no_shows}`,
    `Recebe novidades: ${data.consents.marketing_opt_in ? "sim" : "não"}`,
    `Lembrar de mim no aparelho: ${data.consents.remember_me ? "sim" : "não"}`,
    `Política de privacidade aceita: versão ${data.consents.privacy_version || "—"}`,
    `Notas da casa: ${c.internal_notes || "—"}`,
    "",
    "Reservas:",
    ...data.reservations.map((r) => `- ${formatDay(r.date, "dm")} às ${r.time}, ${r.party_size} pessoas, ${t(`status.${r.status}`)} (${r.code})`),
  ];
  return `${lines.join("\n")}\n`;
}

export async function mountCard(container, { user, id, navigate }) {
  // o telefone completo, exportar e anonimizar: o arquivo de permissões diz quem (história 1.3)
  const revealsPhone = canDo(user.role, "POST /staff/customers/{id}/reveal-phone", user.areas ?? undefined);
  const exports = canDo(user.role, "POST /staff/customers/{id}/export", user.areas ?? undefined);
  const anonymizes = canDo(user.role, "POST /staff/customers/{id}/anonymize", user.areas ?? undefined);
  const state = { status: "loading", c: null, error: null, phone: null, notes: "", saving: null, exported: null };
  const controller = new AbortController();
  let gone = false;

  const draw = () => !gone && render(view(), container);

  async function load() {
    state.status = "loading";
    draw();
    try {
      state.c = await api.getOne(id, { signal: controller.signal });
      state.notes = state.c.internal_notes;
      state.status = "ready";
    } catch (error) {
      if (controller.signal.aborted) return;
      state.error = error;
      state.status = "error";
    }
    draw();
  }

  async function patch(changes, done) {
    try {
      state.c = await api.update(id, changes, state.c.version);
      state.notes = state.c.internal_notes;
      if (done) toast({ title: done });
    } catch (error) {
      if (error?.status === 412 && error.body?.current) await joinOrDiscard(changes, error, done);
      else toast({ kind: "error", title: "Não gravou", message: messageOf(error) });
    }
    state.saving = null;
    draw();
  }

  /** Outra pessoa gravou a ficha antes (precondition_failed): juntar as duas, ou ficar com a dela (5.15). */
  async function joinOrDiscard(changes, error, done) {
    const theirs = error.body.current;
    const mine = changes.internal_notes;
    const joinable = typeof mine === "string" && mine.trim() !== (theirs.internal_notes || "").trim();
    const choice = await formDialog({
      title: "Outra pessoa gravou a ficha antes",
      intro: "A ficha mudou enquanto você escrevia. Escolha como fica.",
      body: html`<div class="juntar">
        <div><p class="bloco__titulo">Como está agora</p><p class="juntar__texto">${theirs.internal_notes || "Sem notas."}</p></div>
        ${joinable ? html`<div><p class="bloco__titulo">O que você escreveu</p><p class="juntar__texto">${mine || "Sem notas."}</p></div>` : nothing}
        <fieldset class="juntar__opcoes">
          <legend class="field__label">O que fazer</legend>
          ${joinable ? html`<label class="check"><input type="radio" name="escolha" value="juntar" checked /> <span>Juntar as duas notas</span></label>` : nothing}
          <label class="check"><input type="radio" name="escolha" value="aplicar" ?checked=${!joinable} /> <span>Gravar a minha mudança por cima</span></label>
          <label class="check"><input type="radio" name="escolha" value="descartar" /> <span>Descartar a minha e ficar com a de agora</span></label>
        </fieldset>
      </div>`,
      submitLabel: "Continuar",
      onSubmit: async (form) => {
        const pick = form.elements.namedItem("escolha").value;
        if (pick === "descartar") return { discarded: true };
        const next = pick === "juntar" ? { ...changes, internal_notes: [theirs.internal_notes, mine].filter((x) => x && x.trim()).join("\n") } : changes;
        return api.update(id, next, theirs.version);
      },
    });
    if (!choice) {
      state.c = theirs;
      state.notes = state.notes || theirs.internal_notes;
      return;
    }
    if (choice.discarded) {
      state.c = theirs;
      state.notes = theirs.internal_notes;
      toast({ title: "Ficou a ficha de agora", message: "A sua mudança foi descartada." });
      return;
    }
    state.c = choice;
    state.notes = choice.internal_notes;
    if (done) toast({ title: done });
  }

  /** "Perdoar falta": a falta deixa de contar para a regra de pendência; o motivo vai para o registro. */
  async function forgive(r) {
    const result = await formDialog({
      title: `Perdoar a falta de ${formatDay(r.date)}?`,
      intro: "A falta deixa de contar para a regra de pedido pendente. O motivo fica no registro de ações.",
      body: html`<div class="field">
        <label class="field__label" for="motivo-perdao">Motivo</label>
        <textarea class="field__input" id="motivo-perdao" name="reason" maxlength="280" required></textarea>
      </div>`,
      submitLabel: "Perdoar falta",
      onSubmit: async (form) => {
        const reason = form.elements.namedItem("reason").value.trim();
        if (!reason) throw fieldError("reason", "Conte o motivo, para o registro.");
        return reservas.action(r.id, { action: "forgive_no_show", reason }, uuid());
      },
    });
    if (!result) return;
    toast({ title: "Falta perdoada", message: "Ela não conta mais para a regra de pendente." });
    await load();
  }

  const saveNotes = (event) => {
    event.preventDefault();
    state.saving = "notes";
    draw();
    patch({ internal_notes: state.notes.trim() }, "Notas gravadas");
  };

  const toggleTag = (tag, on) => {
    const tags = new Set(state.c.tags);
    if (on) tags.add(tag);
    else tags.delete(tag);
    state.saving = "tags";
    patch({ tags: [...tags] }, on ? `Marcado como ${tag === "regular" ? "frequente" : "atenção"}` : "Marcador tirado");
  };

  async function block() {
    const result = await formDialog({
      title: `Bloquear ${state.c.name}?`,
      intro: "Ele deixa de reservar e de entrar na espera pelo site e vê só \"Vamos combinar pelo WhatsApp\". As reservas que já tem continuam, e a equipe ainda pode reservar para ele.",
      body: html`<div class="field">
        <label class="field__label" for="motivo-bloqueio">Motivo <small>a equipe vê, o cliente não</small></label>
        <textarea class="field__input" id="motivo-bloqueio" name="blocked_reason" maxlength="280" required></textarea>
      </div>`,
      submitLabel: "Bloquear",
      danger: true,
      onSubmit: async (form) => {
        const reason = form.elements.namedItem("blocked_reason").value.trim();
        if (!reason) throw fieldError("blocked_reason", "Conte o motivo, para a equipe saber.");
        return api.update(id, { blocked: true, blocked_reason: reason });
      },
    });
    if (!result) return;
    state.c = result;
    toast({ title: `${state.c.name} bloqueado`, message: "A mudança ficou no registro de ações." });
    draw();
  }

  async function unblock() {
    const ok = await confirmAction({ title: `Desbloquear ${state.c.name}?`, message: "Ele volta a reservar pelo site normalmente.", confirmLabel: "Desbloquear" });
    if (ok) patch({ blocked: false }, `${state.c.name} desbloqueado`);
  }

  async function revealPhone() {
    try {
      const answer = await withIdentity(() => api.revealPhone(id), { message: "Ver o telefone completo pede a senha e o código de novo. Vale por 5 minutos, e fica no registro de ações." });
      if (!answer) return;
      state.phone = answer.phone_e164;
      draw();
      container.querySelector(".telefone__completo")?.focus();
    } catch (error) {
      toast({ kind: "error", title: "Não deu para mostrar o telefone", message: messageOf(error) });
    }
  }

  async function exportData() {
    try {
      const data = await withIdentity(() => api.exportData(id), { title: "Exportar dados", message: "Exportar pede a senha e o código de novo, e fica no registro de ações." });
      if (!data) return;
      state.exported = data;
      draw();
      container.querySelector(".exportado .btn")?.focus();
      toast({ title: "Dados prontos para baixar", message: "A exportação ficou no registro de ações." });
    } catch (error) {
      toast({ kind: "error", title: "Não exportou", message: messageOf(error) });
    }
  }

  const download = (kind) => {
    const name = `cliente-${slug(state.c.name)}`;
    if (kind === "json") saveFile(JSON.stringify(state.exported, null, 2), `${name}.json`);
    else saveFile(readable(state.exported), `${name}.txt`, "text/plain;charset=utf-8");
  };

  async function anonymize() {
    const future = state.c.history.filter((r) => ["pending", "confirmed", "waitlisted", "offered"].includes(r.status) && new Date(r.starts_at) > new Date()).length;
    const ok = await confirmAction({
      title: `Anonimizar ${state.c.name}?`,
      message: `Nome, telefone e notas somem para sempre; as visitas ficam sem nome.${future ? ` ${future === 1 ? "A reserva futura é cancelada" : `As ${future} reservas futuras são canceladas`} com aviso.` : ""} Não dá para desfazer.`,
      confirmLabel: "Anonimizar",
      danger: true,
    });
    if (!ok) return;
    try {
      const done = await withIdentity(() => api.anonymize(id).then(() => true), { title: "Confirme para anonimizar", message: "Anonimizar pede a senha e o código de novo." });
      if (!done) return;
      toast({ title: "Cliente anonimizado", message: future ? "As reservas futuras foram canceladas e o cliente foi avisado. A ação ficou no registro." : "A ação ficou no registro." });
      state.phone = null;
      state.exported = null;
      await load();
    } catch (error) {
      toast({ kind: "error", title: "Não anonimizou", message: messageOf(error) });
    }
  }

  const back = html`<a class="voltar" href="/admin/clientes"><span aria-hidden="true">←</span> Clientes</a>`;

  function phoneLine(c) {
    if (c.anonymized) return html`<p class="telefone fraco">Sem telefone guardado</p>`;
    if (state.phone)
      return html`<p class="telefone">
        <a class="telefone__completo mono" href=${`tel:${state.phone}`}>${formatPhone(state.phone)}</a>
        <button class="link-button" type="button" @click=${() => ((state.phone = null), draw())}>Esconder</button>
      </p>`;
    return html`<p class="telefone">
      <span class="mono" aria-label=${`Telefone mascarado ${c.phone_masked}`}>${c.phone_masked || "—"}</span>
      ${c.phone_masked && revealsPhone ? html`<button class="action ver-telefone" type="button" @click=${revealPhone}>Ver telefone</button>` : nothing}
    </p>`;
  }

  const historyTable = (c) =>
    c.history.length
      ? html`<div class="table-wrap">
          <table class="data-table data-table--stack">
            <caption class="sr-only">Reservas de ${c.name}</caption>
            <thead><tr><th scope="col">Dia</th><th scope="col">Hora</th><th scope="col">Pessoas</th><th scope="col">Mesa</th><th scope="col">Situação</th><th scope="col">Origem</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
            <tbody>
              ${c.history.map(
                (r) => html`<tr>
                  <td data-label="Dia" class="num">${formatDay(r.date)}</td>
                  <td data-label="Hora" class="num">${r.time}</td>
                  <td data-label="Pessoas" class="num">${r.party_size}</td>
                  <td data-label="Mesa" class="num">${r.table_codes.join(" + ") || "—"}</td>
                  <td data-label="Situação">${statusBadge(r.status)}</td>
                  <td data-label="Origem">${SOURCE[r.source] || r.source}</td>
                  <td data-label="Ações">
                    ${r.status === "no_show" && r.no_show_counted !== false && !c.anonymized
                      ? html`<button class="action" type="button" aria-label=${`Perdoar a falta de ${formatDay(r.date)}`} @click=${() => forgive(r)}>Perdoar falta</button>`
                      : r.status === "no_show"
                        ? html`<span class="fraco">perdoada</span>`
                        : nothing}
                  </td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>`
      : html`<p class="fraco">Nenhuma reserva ainda.</p>`;

  function view() {
    if (state.status === "loading") return html`${back}${loadingState("Abrindo a ficha…")}`;
    if (state.status === "error")
      return html`${back}${state.error?.status === 404 ? errorState(state.error, () => navigate("/admin/clientes"), "Essa ficha não existe mais") : errorState(state.error, load, "A ficha não abriu")}`;
    const c = state.c;
    const anon = c.anonymized;
    return html`${back}
      <article class="ficha" aria-labelledby="ficha-nome">
        <header class="ficha__cabeca">
          <h2 class="ficha__nome" id="ficha-nome">${anon ? "Cliente anonimizado" : c.name}</h2>
          <span class="marcadores">${tagBadges(c)}${anon ? html`<span class="badge marcador">Anonimizado</span>` : nothing}</span>
          ${phoneLine(c)}
        </header>

        <div class="stats ficha__numeros">
          <div class="stat"><b>${c.visits}</b><small>${c.visits === 1 ? "visita" : "visitas"}</small></div>
          <div class="stat"><b>${c.no_shows}</b><small>${c.no_shows === 1 ? "falta" : "faltas"}</small></div>
          <div class="stat stat--kraft"><b class="stat__data">${c.last_visit_at ? dayOf(c.last_visit_at) : "—"}</b><small>última visita</small></div>
          <div class="stat stat--kraft"><b class="stat__data">${c.created_at ? formatDay(c.created_at.slice(0, 10), "dm") : "—"}</b><small>cliente desde</small></div>
        </div>

        ${c.blocked
          ? html`<div class="notice notice--alert bloqueio" role="note">
              <p><b>Bloqueado.</b> ${c.blocked_reason || "Sem motivo anotado."}</p>
              <p class="bloco__nota">Ele não reserva pelo site e vê "Vamos combinar pelo WhatsApp". A equipe ainda pode reservar para ele.</p>
              <button class="btn btn--sm btn--outline" type="button" @click=${unblock}>Desbloquear</button>
            </div>`
          : nothing}

        <div class="ficha__grade">
          <div class="ficha__lado">
            ${anon
              ? html`<p class="notice">Os dados desta pessoa foram apagados a pedido dela. Ficaram só as visitas, sem nome nem telefone.</p>`
              : html`<section class="bloco" aria-labelledby="notas-titulo">
                    <h3 class="bloco__titulo" id="notas-titulo">Notas da casa</h3>
                    <form class="notas" @submit=${saveNotes}>
                      <div class="field">
                        <label class="field__label" for="notas-cliente">Preferências e cuidados <small>só a equipe vê</small></label>
                        <textarea class="field__input" id="notas-cliente" maxlength="2000" .value=${state.notes} @input=${(e) => ((state.notes = e.target.value), draw())}></textarea>
                      </div>
                      <button class="btn btn--sm" type="submit" ?disabled=${state.notes.trim() === c.internal_notes.trim()} aria-busy=${state.saving === "notes" ? "true" : "false"}>Gravar notas</button>
                    </form>
                  </section>

                  <section class="bloco" aria-labelledby="marcadores-titulo">
                    <h3 class="bloco__titulo" id="marcadores-titulo">Marcadores</h3>
                    <label class="check"><input type="checkbox" .checked=${c.tags.includes("regular")} ?disabled=${state.saving === "tags"} @change=${(e) => toggleTag("regular", e.target.checked)} /> <span><b>Frequente</b>: a equipe recebe pelo nome.</span></label>
                    <label class="check"><input type="checkbox" .checked=${c.tags.includes("attention")} ?disabled=${state.saving === "tags"} @change=${(e) => toggleTag("attention", e.target.checked)} /> <span><b>Atenção</b>: confirmar antes de segurar mesa.</span></label>
                    ${c.blocked ? nothing : html`<button class="btn btn--sm btn--outline bloquear" type="button" @click=${block}>Bloquear cliente</button>`}
                  </section>

                  <section class="bloco" aria-labelledby="pref-titulo">
                    <h3 class="bloco__titulo" id="pref-titulo">Preferências e consentimentos</h3>
                    <dl class="dados">
                      <div><dt>Lugar preferido</dt><dd>${AREA[c.preferences?.area] || "sem preferência"}</dd></div>
                      <div><dt>Mensagens em</dt><dd>${LOCALE[c.locale] || c.locale}</dd></div>
                      <div><dt>Novidades da casa</dt><dd>${c.marketing_opt_in ? "aceita receber" : "não recebe"}</dd></div>
                      <div><dt>Lembrar de mim</dt><dd>${c.remember_me ? "aceitou, no aparelho dele" : "não aceitou"}</dd></div>
                      <div><dt>Política de privacidade</dt><dd>${c.privacy_version ? `aceita, versão de ${formatDay(c.privacy_version, "dm")}` : "—"}</dd></div>
                    </dl>
                  </section>`}

            ${(exports || anonymizes) && !anon
              ? html`<section class="bloco lgpd" aria-labelledby="lgpd-titulo">
                  <h3 class="bloco__titulo" id="lgpd-titulo">Dados do cliente</h3>
                  <p class="bloco__nota">Quando o cliente pede os dados dele ou pede para ser esquecido (LGPD). Cada ação pede a senha de novo e fica no registro.</p>
                  <div class="lgpd__acoes">
                    ${exports ? html`<button class="btn btn--sm btn--outline" type="button" @click=${exportData}>Exportar dados</button>` : nothing}
                    ${anonymizes ? html`<button class="btn btn--sm btn--danger" type="button" @click=${anonymize}>Anonimizar</button>` : nothing}
                  </div>
                  ${state.exported
                    ? html`<div class="exportado">
                        <p>Dados prontos. Escolha o formato:</p>
                        <button class="btn btn--sm" type="button" @click=${() => download("json")}>Baixar JSON</button>
                        <button class="btn btn--sm btn--outline" type="button" @click=${() => download("txt")}>Baixar versão legível</button>
                      </div>`
                    : nothing}
                </section>`
              : nothing}
          </div>

          <section class="bloco ficha__historico" aria-labelledby="historico-titulo">
            <h3 class="bloco__titulo" id="historico-titulo">Histórico de reservas</h3>
            ${historyTable(c)}
          </section>
        </div>
      </article>`;
  }

  load();
  return () => {
    gone = true;
    controller.abort();
  };
}

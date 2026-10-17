// O que cada mesa da noite é agora, lido de GET /staff/floor (FloorState). A API
// manda o dia, as reservas, as sessões de mesa e as regras salvas em Configurações
// (tolerância, o que acontece no fim dela, "para liberar"); as palavras da planta saem daqui.
// Os pontos fixos da planta (bar, cozinha, entrada…) vêm com cada área, só para orientar
// a equipe: não têm estado, nunca sentam ninguém e nunca contam.
import { houseTime } from "../../../lib/dates.js";
import { gridOf } from "../plantas/areas.js";
import { placeLegacy } from "../plantas/pontos.js";

const MIN = 60_000;
const SOON_MIN = 120; // uma reserva tão perto assim segura a mesa ("reservada")

export const STATE_WORD = { free: "livre", reserved: "reservada", seated: "sentada", late: "atrasada", release: "para liberar" };

export const firstName = (r) => (r?.customer?.name || "").split(" ")[0] || (r?.source === "walk_in" ? "Sem reserva" : "Sem nome");

export const people = (n) => `${n} ${n === 1 ? "pessoa" : "pessoas"}`;

/** Minutos até um instante, arredondados para baixo; negativo depois que passou. */
export const minutesUntil = (iso, now) => Math.floor((new Date(iso) - now) / MIN);

/** O fim da tolerância de uma reserva confirmada que não chegou (pelas regras da casa). */
export function toleranceEnd(r, rules) {
  if (r.tolerance_until) return new Date(r.tolerance_until);
  const tolerance = rules?.tolerance_min ?? r.tolerance_min ?? 0;
  return new Date(new Date(r.starts_at).getTime() + (tolerance + (r.extra_tolerance_min || 0)) * MIN);
}

/** "A mesa espera até 20:20", ou "A mesa espera às 20:00 em ponto" quando a tolerância é 0. */
export function toleranceSentence(r, rules) {
  const tolerance = rules?.tolerance_min ?? r.tolerance_min ?? 0;
  if (!tolerance && !r.extra_tolerance_min) return `A mesa espera às ${r.time} em ponto`;
  return `A mesa espera até ${houseTime(toleranceEnd(r, rules).toISOString())}`;
}

const waiting = (r) => r.status === "confirmed" || (r.status === "pending" && r.table_codes?.length);

/**
 * Toda mesa da planta da noite com o seu estado.
 * @returns {{areas: Array<{key, name, mode, tables: any[], fixtures: any[], cols: number, rows: number, capacity?: number, inside?: number}>, tables: Map<string, any>, rules: any}}
 */
export function readFloor(floor, now) {
  const day = floor.day || {};
  const rules = floor.rules || {};
  const source = day.layout || { tables: [] };
  const layout = { ...source, tables: placeLegacy(source.tables || []) };
  const sessions = (floor.sessions || []).filter((s) => s.status === "open");
  const byId = new Map((floor.reservations || []).map((r) => [r.id, r]));
  const tables = new Map();

  for (const t of layout.tables) {
    const session = sessions.find((s) => s.table_codes.includes(t.code));
    const row = { ...t, state: "free", note: "", session: null, reservation: null, joined: [] };
    if (session) {
      const origin = byId.get(session.reservation_id);
      const next = upcoming(floor, t.code, now);
      Object.assign(row, {
        state: session.release_hint ? "release" : "seated",
        session,
        reservation: origin,
        joined: session.table_codes.filter((c) => c !== t.code),
        // uma mesa que sentou um grupo antes de uma reserva diz até quando está livre
        note: session.release_hint ? `até ${houseTime(session.ends_at)}` : `${firstName(origin)} · ${session.people}${next ? ` · livre até ${next.time}` : ""}`,
      });
      if (next) row.next = next;
    } else {
      const late = (floor.reservations || [])
        .filter((r) => r.status === "confirmed" && r.table_codes.includes(t.code) && new Date(r.starts_at) <= now)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
      const next = upcoming(floor, t.code, now);
      if (late) {
        const end = toleranceEnd(late, rules);
        const left = minutesUntil(end.toISOString(), now);
        const over = end <= now;
        Object.assign(row, {
          state: "late",
          reservation: late,
          deadline: end,
          left,
          over,
          // com "perde a prioridade" a mesa fica aberta a quem chega depois que a tolerância acaba
          priorityLost: over && rules.after_tolerance !== "release",
          note: over ? "Não veio?" : `faltam ${left + 1} min`,
        });
      } else if (next && (next.status === "offered" || next.status === "pending" || minutesUntil(next.starts_at, now) <= SOON_MIN)) {
        // o horário, o primeiro nome e quantas pessoas, depois do motivo que segura a mesa (N21)
        const who = `${next.time} · ${firstName(next)} · ${people(next.party_size)}`;
        const reason = next.status === "offered" ? `oferecida até ${houseTime(next.offer_expires_at)} · ${who}` : next.status === "pending" ? `pendente · ${who}` : who;
        Object.assign(row, { state: "reserved", reservation: next, note: reason });
      } else if (next) {
        Object.assign(row, { heldAt: next.time, note: `livre até ${next.time}` });
      } else {
        row.note = `${t.max_seats} lug.`;
      }
      if (next) row.next = next;
    }
    tables.set(t.code, row);
  }

  const names = Object.fromEntries((floor.areas || []).map((a) => [a.key, a.name]));
  const areas = (day.areas || [])
    .filter((a) => a.mode !== "closed")
    .map((a) => {
      const { cols, rows } = gridOf((layout.areas || []).find((x) => x.key === a.key));
      const area = {
        key: a.key,
        name: names[a.key] || a.key,
        mode: a.mode,
        tables: [...tables.values()].filter((t) => t.area === a.key),
        fixtures: (layout.fixtures || []).filter((f) => f.area === a.key),
        cols,
        rows,
      };
      if (a.mode === "list") {
        area.capacity = a.list_capacity || 0;
        area.inside = sessions.filter((s) => s.area_code === a.key).reduce((n, s) => n + s.people, 0);
        area.groups = sessions.filter((s) => s.area_code === a.key).map((s) => ({ session: s, reservation: byId.get(s.reservation_id) }));
      }
      return area;
    });
  return { areas, tables, rules };
}

/** A próxima reserva (ou mesa oferecida pela fila de espera) de uma mesa que ainda não sentou. */
function upcoming(floor, code, now) {
  // uma mesa que o servidor diz que está segura (pedido pendente ou oferta no prazo) fica reservada mesmo depois do horário
  const held = new Set((floor.holds || []).filter((h) => h.table_codes?.includes(code)).map((h) => h.reservation_id));
  return (floor.reservations || [])
    .filter((r) => r.table_codes?.includes(code))
    .filter((r) => held.has(r.id) || (waiting(r) && new Date(r.starts_at) > now) || (r.status === "offered" && new Date(r.offer_expires_at) > now))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
}

/** Reservas da noite que ainda podem chegar, para "Quem chegou?". */
export function arriving(floor, now) {
  return (floor.reservations || [])
    .filter((r) => waiting(r))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((r) => ({ ...r, late: new Date(r.starts_at) <= now }));
}

/** Nome, código TR ou os 4 últimos dígitos do telefone. */
export function matches(r, query) {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const digits = q.replace(/\D/g, "");
  if (digits.length === 4 && /^\d{4}$/.test(q) && (r.customer?.phone_masked || "").endsWith(digits)) return true;
  const plain = (s) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const byCode = /\d/.test(q) && (r.code || "").toLowerCase().includes(q.replace(/^tr-?/, ""));
  return plain(r.customer?.name || "").includes(plain(q)) || byCode;
}

/** Mesas livres agora, para sentar, mudar, juntar e oferecer. */
export const freeTables = (read) => [...read.tables.values()].filter((t) => t.state === "free");

/** Um resumo curto do salão, para a linha de cima e o leitor de tela. */
export function counts(read) {
  const c = { free: 0, reserved: 0, seated: 0, late: 0, release: 0 };
  for (const t of read.tables.values()) c[t.state] += 1;
  return c;
}

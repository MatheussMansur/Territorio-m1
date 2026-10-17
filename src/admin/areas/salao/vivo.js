// As atualizações ao vivo das telas da noite (Hoje, Salão, Espera e a gaveta da reserva,
// histórias 5.3 e 6.1). A tela escuta a transmissão (GET /staff/stream): um "invalidate"
// faz ler de novo em até 2 s, um "ping" diz que a linha está viva. Quando a transmissão acaba, falha
// ou fica 40 s sem ping nem aviso, a tela mostra "Atualização ao vivo pausada"
// (realtime_lost), lê a cada 20 s com ETag e continua tentando reabrir a transmissão. Voltar
// do segundo plano (visibilitychange) ou a rede voltar faz ler na hora,
// antes de qualquer ação, e reabre a transmissão.
import { stream } from "../../../services/api/staff-hoje.js";

const SILENCE_MS = 40_000;
const POLL_MS = 20_000;
const REOPEN_MS = 5_000;
const DEBOUNCE_MS = 250;

/**
 * `skip`: assuntos que esta tela não mostra (uma tela da noite pula "alerts", que só
 * a central de avisos e o Hoje leem); um aviso só com esses assuntos é apenas sinal de vida.
 * @param {{refresh: (why: {reason: string, topics?: string[]}) => any, onState?: (state: {lost: boolean}) => void, skip?: string[]}} options
 * @returns {{stop: () => void, readonly lost: boolean, now: () => any}}
 */
export function startLive({ refresh, onState, skip = [] }) {
  let stopped = false;
  let lost = false;
  let controller = null;
  let lastBeat = Date.now();
  let pending = null;
  let topics = new Set();
  let reopenTimer = null;
  let pollTimer = null;
  let failures = 0;

  const setLost = (value) => {
    if (lost === value) return;
    lost = value;
    clearInterval(pollTimer);
    // com a transmissão caída, a tela lê a cada 20 s até ela voltar
    if (lost) pollTimer = setInterval(() => !stopped && refresh({ reason: "poll" }), POLL_MS);
    onState?.({ lost });
  };

  const schedule = (extra = []) => {
    extra.forEach((t) => topics.add(t));
    clearTimeout(pending);
    pending = setTimeout(() => {
      const list = [...topics];
      topics = new Set();
      if (!stopped) refresh({ reason: "live", topics: list });
    }, DEBOUNCE_MS);
  };

  async function open() {
    if (stopped) return;
    clearTimeout(reopenTimer);
    controller?.abort();
    controller = new AbortController();
    const mine = controller;
    lastBeat = Date.now();
    try {
      await stream({
        signal: mine.signal,
        onEvent: ({ event, data }) => {
          lastBeat = Date.now();
          failures = 0;
          if (event === "hello" || event === "ping") {
            if (lost) {
              setLost(false);
              schedule(); // o que mudou enquanto a linha estava caída
            }
          } else if (event === "invalidate") {
            if (lost) setLost(false);
            const topics = data?.topics || [];
            if (topics.length && topics.every((t) => skip.includes(t))) return;
            schedule(topics);
          }
        },
      });
    } catch (error) {
      if (mine.signal.aborted || stopped) return;
      console.warn("stream", error?.type || error);
    }
    if (mine !== controller || stopped) return;
    // a transmissão acabou: tratar como caída e tentar de novo
    setLost(true);
    reopenTimer = setTimeout(open, failures++ ? POLL_MS : REOPEN_MS);
  }

  // 40 s sem ping nem aviso: a linha está morta mesmo que não tenha dito
  const watchdog = setInterval(() => {
    if (stopped || lost) return;
    if (Date.now() - lastBeat > SILENCE_MS) {
      setLost(true);
      open();
    }
  }, 5_000);

  const wake = () => {
    if (stopped || document.visibilityState !== "visible") return;
    refresh({ reason: "wake" });
    if (lost || Date.now() - lastBeat > SILENCE_MS) open();
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);
  window.addEventListener("pageshow", wake);

  open();

  return {
    get lost() {
      return lost;
    },
    stop() {
      stopped = true;
      controller?.abort();
      clearInterval(watchdog);
      clearInterval(pollTimer);
      clearTimeout(pending);
      clearTimeout(reopenTimer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("pageshow", wake);
    },
  };
}

/** "2 reservas mudaram", "1 mesa mudou": um resumo para o aria-live, nunca uma por uma. */
export function changeSummary(count, one, many) {
  if (!count) return "";
  return `${count} ${count === 1 ? `${one} mudou` : `${many} mudaram`}`;
}

/** Quantos itens mudaram entre duas listas, pelo id e por uma assinatura de cada item. */
export function countChanges(before, after, sign) {
  if (!before) return 0;
  const old = new Map(before.map((x) => [x.id, sign(x)]));
  let n = 0;
  for (const x of after) if (old.get(x.id) !== sign(x)) n += 1;
  for (const id of old.keys()) if (!after.some((x) => x.id === id)) n += 1;
  return n;
}

export const realtimeLostNotice = "Atualização ao vivo pausada. A tela segue se atualizando a cada 20 segundos até a conexão voltar.";

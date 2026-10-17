// As chamadas de amostra do teste do contrato (história 1.4): todo serviço de
// src/services/api chamado do jeito que as telas chamam, contra o mock, como o dono, o
// gerente e a recepção, e também o cenário vazio. Cada troca é depois conferida contra
// o contrato por contract-harness.mjs. Uma chamada que falha também faz parte do teste (o
// problem+json dela tem que estar no contrato); aqui só importa a sequência, não o resultado.

const day = (offset = 0) => {
  const d = new Date(Date.now() - 3 * 3_600_000 + offset * 86_400_000);
  return d.toISOString().slice(0, 10);
};
const listOf = (x) => (Array.isArray(x) ? x : x?.items || x?.groups || x?.events || x?.users || x?.layouts || x?.areas || []);
const uuid = () => crypto.randomUUID();

/** Roda todas as chamadas; `mock` é a máquina do teste (as, load, state), `log` junta o que deu erro fora de ApiError. */
export async function runScenario(mock, log = []) {
  const load = (name) => mock.load(`/src/services/api/${name}.js`);
  const client = await load("client");
  const api = {
    auth: await load("auth"),
    availability: await load("availability"),
    consents: await load("consents"),
    house: await load("house"),
    links: await load("links"),
    measure: await load("measure"),
    reservations: await load("reservations"),
    staff: await load("staff"),
  };
  const s = {};
  for (const area of ["agenda", "auth", "avisos", "cardapio", "clientes", "configuracoes", "equipe", "espera", "eventos", "galeria", "google", "hoje", "plantas", "registro", "reservas", "salao", "sistema", "site"]) {
    s[area] = await load(`staff-${area}`);
  }
  const { getState } = await mock.load("/src/mocks/db.js");
  const { tokensOf } = await mock.load("/src/mocks/handlers/customer.js");
  const state = () => getState(new Date());

  const call = async (label, fn) => {
    const started = Date.now();
    let timer;
    // uma chamada que nunca responde falha aqui com o nome dela, em vez de travar o teste
    const stuck = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("sem resposta em 20 s")), 20_000);
    });
    try {
      return await Promise.race([fn(), stuck]);
    } catch (error) {
      if (error?.name !== "ApiError" || ["network", "timeout", "bad_response"].includes(error.type)) log.push(`${label}: ${error?.type || ""} ${error?.stack || error}`);
      return null;
    } finally {
      clearTimeout(timer);
      if (process.env.CONTRACT_DEBUG) console.log("→", label, Date.now() - started, "ms");
    }
  };
  const asStaff = (role, extra) => {
    mock.as(role, extra);
    client.setCsrfToken(null);
  };
  const reauth = () => call("reauth", () => s.auth.reauth({ password: "admin", code: "123456" }));

  // ---- o site público --------------------------------------------------------------------
  asStaff(null);
  await call("house", () => api.house.getHouse());
  await call("content", () => api.house.getContent());
  await call("menu", () => api.house.getMenu());
  await call("days", () => api.availability.getDays({ from: day(), to: day(29), partySize: 2 }));
  await call("days 422", () => api.availability.getDays({ from: day(), to: day(3), partySize: 0 }));
  await call("slots", () => api.availability.getSlots({ date: day(), partySize: 2 }));
  await call("slots future", () => api.availability.getSlots({ date: day(2), partySize: 4 }));
  await call("consents", () => api.consents.send({ consent_id: uuid(), banner_version: "2026-10-01", remember: true, measurement: false, locale: "pt" }));
  await call("measure", () => api.measure.send({ visitor: uuid(), visit: uuid(), events: [{ name: "page_view", at: new Date().toISOString(), page: "/" }] }));

  // ---- o cliente --------------------------------------------------------------------------
  const phone = "+5545999123456";
  await call("me 401", () => api.auth.me());
  await call("otp", () => api.auth.sendOtp(phone, { turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" }));
  await call("verify wrong", () => api.auth.verifyOtp({ phone, code: "000000", name: "Joana Prado", rememberDevice: true, locale: "pt" }));
  await call("verify", () => api.auth.verifyOtp({ phone, code: "123456", name: "Joana Prado", rememberDevice: true, locale: "pt" }));
  await call("me", () => api.auth.me());
  await call("update me", () => api.auth.updateMe({ name: "Joana Prado", email: "joana@example.com", locale: "pt", marketing_opt_in: false }));
  await call("my data", () => api.auth.myData());
  const window = await call("days for booking", () => api.availability.getDays({ from: day(1), to: day(20), partySize: 2 }));
  const openDays = (window?.days || []).filter((d) => d.open && ["available", "few_left"].includes(d.state)).map((d) => d.date);
  const bookDay = openDays[0] || day(3);
  const slots = await call("slots for booking", () => api.availability.getSlots({ date: bookDay, partySize: 2 }));
  const slot = (slots?.slots || []).find((x) => ["available", "few_left"].includes(x.state)) || slots?.slots?.[0];
  const terms = await call("terms", () => api.house.getHouse());
  const booking = await call("create", () =>
    api.reservations.create(
      {
        party_size: 2,
        date: bookDay,
        time: slot?.time || "20:00",
        name: "Joana Prado",
        notes: "Aniversário da minha mãe",
        flags: ["birthday"],
        terms_version: terms?.terms?.version,
        locale: "pt",
        started_at: new Date(Date.now() - 60_000).toISOString(),
        turnstile_token: "XXXX.DUMMY.TOKEN.XXXX",
      },
      uuid(),
    ),
  );
  await call("create 422", () => api.reservations.create({ date: day(2), party_size: 0 }, uuid()));
  await call("mine", () => api.reservations.mine());
  if (booking?.code) {
    await call("get mine", () => api.reservations.getMine(booking.code));
    await call("late", () => api.reservations.late(booking.code));
    await call("reschedule", () => api.reservations.reschedule(booking.code, { date: openDays[1] || bookDay, time: slot?.time || "20:00", party_size: 3 }, uuid()));
    await call("cancel mine", () => api.reservations.cancel(booking.code, "Mudou o plano"));
  }
  await call("google sample", () => api.auth.googleSampleReturn({ choice: "nova", returnTo: "/minhas-reservas/" }));
  await call("change phone", () => api.auth.changePhone({ phone: "+5545999654321", code: "123456" }));
  await call("forget me", () => api.auth.forgetMe());
  await call("logout", () => api.auth.logout());

  // ---- links mandados ao cliente -------------------------------------------------------------
  const linked = state()
    .reservations.filter((r) => r.public_token && ["confirmed", "pending"].includes(r.status) && r.date >= day())
    .slice(0, 3);
  for (const [i, r] of linked.entries()) {
    const t = tokensOf(r);
    await call("link view", () => api.links.view(t.view));
    await call("link action view", () => api.links.view(t.action));
    await call("link calendar", () => api.links.calendar(t.view));
    if (i === 0) await call("link yes", () => api.links.answer(t.action, "yes"));
    if (i === 1) await call("link late", () => api.links.answer(t.action, "late"));
    if (i === 1) await call("link late again", () => api.links.answer(t.action, "late"));
    if (i === 2) await call("link cancel", () => api.links.cancel(t.action));
    await call("link read only", () => api.links.answer(t.view, "yes"));
  }
  const offered = state().reservations.find((r) => r.status === "offered" && r.public_token);
  if (offered) {
    await call("offer view", () => api.links.view(tokensOf(offered).waitlist));
    await call("offer decline", () => api.links.declineOffer(tokensOf(offered).waitlist));
  }
  await call("link 404", () => api.links.view("nao-existe-esse-link-de-jeito-nenhum"));

  // ---- a equipe: a entrada -----------------------------------------------------------------
  asStaff(null);
  await call("session 401", () => s.auth.session());
  await call("staff me 401", () => api.staff.me());
  mock.as(undefined); // daqui em diante, quem entrar
  await call("login wrong", () => s.auth.login({ email: "marcus@territorio.com.br", password: "errada", remember: false, turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" }));
  const owner = state().users.find((u) => u.role === "owner" && u.status === "active");
  const login = await call("login", () => s.auth.login({ email: owner?.email, password: "admin", remember: true, turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" }));
  if (login?.challenge_id) await call("mfa", () => s.auth.mfa({ challengeId: login.challenge_id, code: "123456" }));
  await call("session", () => s.auth.session());
  await call("staff me", () => api.staff.me());
  await call("sessions", () => s.auth.sessions());
  await call("reauth wrong", () => s.auth.reauth({ password: "x", code: "000000" }));
  await call("forgot", () => s.auth.forgot("alguem@example.com"));
  for (const tk of (state().auth?.tokens || []).slice(0, 4)) await call("token", () => s.auth.token(tk.token || tk.value || tk.id));
  await call("token 404", () => s.auth.token("nao-existe"));
  await call("setup bad", () => s.auth.setup({ token: "nao-existe", name: "X", email: "x@x.com", password: "curta" }));
  await call("accept bad", () => s.auth.acceptInvite({ token: "nao-existe", name: "X", password: "curta" }));
  await call("reset bad", () => s.auth.reset({ token: "nao-existe", password: "curta" }));
  await call("start mfa", () => s.auth.startMfa());
  await call("confirm mfa", () => s.auth.confirmMfa("000000"));
  const otherSession = (await call("sessions again", () => s.auth.sessions()))?.find?.((x) => !x.current);
  if (otherSession) await call("end session", () => s.auth.endSession(otherSession.id));
  await call("pair", () => s.auth.devices.pair({ label: "Tablet da recepção", user_agent: "Mozilla/5.0 (Linux; Android 14)", public_key: { kty: "EC", crv: "P-256", x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU", y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0" } }));
  const pairings = (state().devices || []).filter((d) => d.status === "pending");
  for (const d of pairings.slice(0, 1)) await call("pairing", () => s.auth.devices.pairing(d.id));
  await call("challenge", () => s.auth.devices.challenge(pairings[0]?.id || uuid()));
  await call("device open bad", () => s.auth.devices.open({ device_id: pairings[0]?.id || uuid(), challenge_id: uuid(), signature: "AAAA", device_time: new Date().toISOString() }));
  await call("device people", () => s.auth.devices.people());
  await call("pin bad", () => s.auth.pinLogin({ userId: uuid(), pin: "0000" }));
  await call("pin logout", () => s.auth.pinLogout());
  await call("staff logout", () => s.auth.logout());

  // ---- o dono, área por área ---------------------------------------------------------------
  asStaff("dono");
  await call("me owner", () => api.staff.me());
  await call("session owner", () => s.auth.session());

  // Hoje
  const dash = await call("dashboard", () => s.hoje.dashboard(day()));
  // a central de avisos (FR-87): o Hoje lê a mesma lista
  const central = await call("alerts", () => s.avisos.list());
  const notices = central?.items || dash?.alerts || [];
  await call("alerts read", () => s.avisos.markRead(notices.slice(0, 2).map((n) => n.id)));
  await call("alerts read all", () => s.avisos.markRead());
  const info = notices.find((n) => n.can_dismiss);
  if (info) await call("alert dismiss", () => s.avisos.dismiss(info.id));
  const critical = notices.find((n) => n.level === "critical");
  if (critical) await call("alert dismiss 409", () => s.avisos.dismiss(critical.id));
  const manual = notices.find((n) => n.can_resolve);
  if (manual) await call("alert resolve", () => s.avisos.resolve(manual.id));
  await call("alert resolve 404", () => s.avisos.resolve("birthday:nao-existe"));
  const prefs = await call("alert preferences", () => s.avisos.preferences());
  await call("save alert preferences", () => s.avisos.savePreferences((prefs?.items || []).filter((i) => i.level === "info").map((i) => i.code)));
  await call("save alert preferences 422", () => s.avisos.savePreferences(["pin_locked"]));
  await call("fresh floor", () => s.hoje.readFresh("/staff/floor", {}));

  // Reservas
  const list = await call("reservations", () => s.reservas.list({}));
  await call("reservations filtered", () => s.reservas.list({ from: day(), to: day(7), status: ["confirmed", "pending"], source: "site", q: "a", limit: 20 }));
  await call("reservations page 2", () => s.reservas.list({ cursor: "20", limit: 20 }));
  const items = listOf(list);
  const today = items.filter((r) => r.date === day());
  const pick = (status) => items.find((r) => r.status === status);
  for (const r of items.slice(0, 3)) await call("detail", () => s.reservas.detail(r.id));
  await call("detail 404", () => s.reservas.detail(uuid()));
  await call("staff availability", () => s.reservas.availability({ date: day(), time: "20:00", partySize: 4 }));
  // o idioma guardado de um telefone conhecido e de um desconhecido (5.6)
  await call("customer language", () => s.reservas.customerLanguage("+5493757412233"));
  await call("customer language unknown", () => s.reservas.customerLanguage("+5545999990001"));
  // a próxima noite aberta com mesa (amanhã pode ser dia fechado)
  let open = 1;
  let avail = null;
  for (; open <= 7; open++) {
    avail = await call("staff availability 2", () => s.reservas.availability({ date: day(open), time: "20:30", partySize: 2, ignore: items[0]?.id }));
    if (listOf(avail).length) break;
  }
  const created = await call("staff create", () =>
    s.reservas.create(
      { date: day(open), time: "20:30", party_size: 2, name: "Rafael Souza", phone: "+5545998887766", source: "phone", notes: "Mesa perto da janela", flags: ["birthday"], table_codes: listOf(avail)?.[0]?.table_codes, phone_verified: false, locale: "pt" },
      uuid(),
    ),
  );
  await call("staff create 422", () => s.reservas.create({ date: day(1), party_size: 0 }, uuid()));
  if (created?.id) {
    await call("note", () => s.reservas.action(created.id, { action: "note", note: "Cliente pediu cadeira alta" }, uuid()));
    await call("move tables", () => s.reservas.action(created.id, { action: "move_tables", table_codes: listOf(avail)?.[1]?.table_codes || [] }, uuid()));
    await call("reschedule", () => s.reservas.action(created.id, { action: "reschedule", date: day(open + 1), time: "21:00", party_size: 3 }, uuid()));
    await call("call answer", () => s.reservas.action(created.id, { action: "call_answer", answer: "yes" }, uuid()));
    await call("resend", () => s.reservas.action(created.id, { action: "resend_confirmation" }, uuid()));
    await call("notify", () => s.reservas.notify(created.id, "table_waiting", uuid()));
    await call("cancel", () => s.reservas.action(created.id, { action: "cancel", reason: "Cliente ligou", notify: true }, uuid()));
    await call("cancel again", () => s.reservas.action(created.id, { action: "cancel", reason: "De novo" }, uuid()));
  }
  const pending = pick("pending");
  if (pending) await call("approve", () => s.reservas.action(pending.id, { action: "approve", table_codes: pending.table_codes }, uuid()));
  const pending2 = items.filter((r) => r.status === "pending")[1];
  if (pending2) await call("decline", () => s.reservas.action(pending2.id, { action: "decline", reason: "Casa cheia" }, uuid()));
  const noShow = pick("no_show");
  if (noShow) {
    await call("forgive", () => s.reservas.action(noShow.id, { action: "forgive_no_show", reason: "Avisou depois" }, uuid()));
    await call("undo no show", () => s.reservas.action(noShow.id, { action: "undo_no_show", reason: "Chegou atrasado" }, uuid()));
  }
  const tonight = today.find((r) => r.status === "confirmed");
  if (tonight) {
    await call("notify running late", () => s.reservas.notify(tonight.id, "running_late", uuid(), { repeat: true }));
    await call("check in", () => s.salao.reservationAction(tonight.id, { action: "check_in", occurred_at: new Date().toISOString(), people: tonight.party_size }, uuid()));
    await call("undo check in", () => s.salao.reservationAction(tonight.id, { action: "undo_check_in", occurred_at: new Date().toISOString() }, uuid()));
    await call("extra tolerance", () => s.salao.reservationAction(tonight.id, { action: "extra_tolerance" }, uuid()));
    await call("no show early", () => s.salao.reservationAction(tonight.id, { action: "no_show" }, uuid()));
    await call("release table", () => s.salao.reservationAction(tonight.id, { action: "release_table" }, uuid()));
  }
  await reauth();
  await call("export", () => s.reservas.exportCsv({ from: day(-30), to: day() }));
  await call("export filtered", () => s.reservas.exportFiltered({ from: day(-30), to: day(), status: ["confirmed"], source: "phone", q: "a" }));
  await call("floor (reservas)", () => s.reservas.floor(day()));
  await call("day (reservas)", () => s.reservas.day(day(1)));
  await call("calendar (reservas)", () => s.reservas.calendar(day().slice(0, 7)));

  // Salão
  const floor = await call("floor", () => s.salao.floor());
  await call("floor fresh", () => s.salao.floorFresh(null));
  const freeTables = (floor?.day?.layout?.tables || []).filter((t) => !(floor.sessions || []).some((x) => x.status === "open" && x.table_codes?.includes(t.code)));
  const walk = await call("walk in", () => s.salao.walkIn({ table_codes: [freeTables[0]?.code].filter(Boolean), party_size: 2, name: "Casal da porta", occurred_at: new Date().toISOString() }, uuid()));
  const sessions = ((await call("floor again", () => s.salao.floor()))?.sessions || []).filter((x) => x.status === "open");
  const sess = walk?.session || walk?.table_session || sessions[0];
  if (sess?.id) {
    const full = await call("session", () => s.salao.getSession(sess.id));
    await call("people", () => s.salao.setPeople(sess.id, 3, full?.version ?? sess.version, uuid()));
    await call("people stale", () => s.salao.setPeople(sess.id, 4, "velha", uuid()));
    await call("extend", () => s.salao.extend(sess.id, uuid()));
    if (freeTables[1]) await call("move", () => s.salao.move(sess.id, [freeTables[1].code], uuid()));
    if (sessions[1]) await call("merge", () => s.salao.merge(sess.id, sessions[1].id, uuid()));
    await call("split", () => s.salao.split(sess.id, [freeTables[1]?.code || "x"], 1, uuid()));
    await call("release", () => s.salao.release(sess.id, uuid()));
    await call("reopen", () => s.salao.reopen(sess.id));
  }
  await call("snapshot", () => s.salao.nightSnapshot());
  await call("snapshot since", () => s.salao.nightSnapshot({ since: new Date(Date.now() - 3_600_000).toISOString() }));
  await call("sheet printed", () => s.salao.sheetPrinted("full"));
  await call("postpone", () => s.salao.postponeClose());
  await call("close night", () => s.salao.closeNight(day(-1)));
  const corr = await call("corrections", () => s.salao.sendCorrections([{ kind: "check_in", reservation_id: items[0]?.id, occurred_at: new Date().toISOString(), note: "Anotado no papel" }]));
  const corrId = listOf(corr)?.[0]?.id || (state().corrections || [])[0]?.id;
  if (corrId) {
    await call("apply correction", () => s.salao.applyCorrection(corrId));
    await call("dismiss correction", () => s.salao.dismissCorrection(corrId));
  }

  // Espera
  const waiting = await call("waitlist", () => s.espera.list());
  await call("waitlist fresh", () => s.espera.listFresh(null));
  const door = await call("add at door", () => s.espera.addAtDoor({ name: "Grupo do Lucas", party_size: 3, time: (waiting?.slots || waiting?.times || [])[0]?.time || "21:00", phone: "+5545997776655" }, uuid()));
  const entries = listOf(waiting).length ? listOf(waiting) : waiting?.entries || [];
  const entry = entries.find((e) => e.status === "waitlisted") || entries[0];
  if (entry) await call("offer", () => s.espera.offer(entry.id, [freeTables[0]?.code].filter(Boolean), uuid()));
  const doorId = door?.id || door?.entry?.id;
  if (doorId) {
    await call("notify ready", () => s.espera.notifyReady(doorId));
    await call("notify ready repeat", () => s.espera.notifyReady(doorId, { repeat: true }));
  }

  // Agenda
  await call("calendar", () => s.agenda.calendar(day().slice(0, 7)));
  await call("day plans", () => s.agenda.dayPlans(day(), day(30)));
  const dayInfo = await call("day", () => s.agenda.day(day(5)));
  const layouts = await call("layouts", () => s.plantas.layouts());
  const layoutId = listOf(layouts)[0]?.id;
  const plan = { open: true, opens_at: "19:00", closes_at: "23:30", layout_id: layoutId, reason_label: null, note: "Teste" };
  await call("plan dry", () => s.agenda.setPlan(day(5), plan, { dryRun: true }));
  await call("plan", () => s.agenda.setPlan(day(5), plan, { version: dayInfo?.version ?? dayInfo?.plan?.version ?? "semana" }));
  await call("plan stale", () => s.agenda.setPlan(day(5), plan, { version: "velha" }));
  await call("plans dry", () => s.agenda.setPlans([day(8), day(9)], { open: false, reason: "holiday", reason_label: "Feriado" }, { dryRun: true }));
  await call("plans", () => s.agenda.setPlans([day(8), day(9)], { open: false, reason: "holiday", reason_label: "Feriado" }, { confirm: true, resolutions: [] }));
  await call("reset dry", () => s.agenda.resetPlan(day(5), { dryRun: true }));
  const after = await call("day after", () => s.agenda.day(day(5)));
  await call("reset", () => s.agenda.resetPlan(day(5), { confirm: true, resolutions: [], version: after?.version ?? after?.plan?.version }));

  // Plantas
  const areas = await call("areas", () => s.plantas.areas());
  const area = await call("create area", () => s.plantas.createArea({ name: "Varanda", default_mode: "tables", width_m: 8, depth_m: 4 }));
  const areaId = area?.id || listOf(areas)[0]?.id;
  if (areaId) await call("update area", () => s.plantas.updateArea(areaId, { name: "Varanda coberta" }));
  const layout = await call("layout", () => s.plantas.layout(layoutId));
  if (layout) {
    await call("layout dry", () => s.plantas.updateLayout(layoutId, { name: layout.name, tables: layout.tables, combos: layout.combos, areas: layout.areas }, { dryRun: true }));
    await call("layout save", () => s.plantas.updateLayout(layoutId, { name: layout.name, tables: layout.tables, combos: layout.combos, areas: layout.areas, ...(layout.fixtures ? { fixtures: layout.fixtures } : {}) }, { version: layout.version }));
    await call("layout stale", () => s.plantas.updateLayout(layoutId, { name: layout.name, tables: layout.tables, combos: layout.combos, areas: layout.areas }, { version: "velha" }));
  }
  const copy = await call("duplicate layout", () => s.plantas.duplicateLayout(layoutId, "Planta de evento"));
  await call("create layout", () => s.plantas.createLayout({ name: "Planta nova", areas: [{ key: "salao" }], tables: [], combos: [] }));
  if (copy?.id) await call("archive layout", () => s.plantas.archiveLayout(copy.id));
  if (area?.id) await call("delete area", () => s.plantas.deleteArea(area.id));
  if (listOf(areas)[0]?.id) await call("delete area in use", () => s.plantas.deleteArea(listOf(areas)[0].id));

  // Eventos
  const events = await call("events", () => s.eventos.events({ from: day(-60), to: day(90) }));
  const evList = listOf(events);
  const ev = evList.find((e) => e.date >= day()) || evList[0];
  if (ev) {
    const one = await call("event", () => s.eventos.event(ev.id));
    await call("event dry", () => s.eventos.updateEvent(ev.id, { title: one?.title || ev.title }, { dryRun: true }));
    await call("event save", () => s.eventos.updateEvent(ev.id, { title: one?.title || ev.title }, { version: one?.version ?? ev.version }));
    await call("event stale", () => s.eventos.updateEvent(ev.id, { title: "x" }, { version: "velha" }));
    await call("guests", () => s.eventos.guests(ev.id));
    const guest = await call("add guest", () => s.eventos.addGuest(ev.id, { name: "Bruna Kato", party_size: 2, note: "Lista do aniversário", at_door: false }));
    const gid = guest?.id || guest?.reservation?.id;
    if (gid) {
      await call("check in guest", () => s.eventos.checkIn(ev.id, gid, { people: 2, occurred_at: new Date().toISOString() }));
      await call("undo check in guest", () => s.eventos.undoCheckIn(ev.id, gid));
      await call("remove guest", () => s.eventos.removeGuest(ev.id, gid));
    }
    await call("export guests", () => s.reservas.exportGuests(ev.id));
    const dup = await call("duplicate event", () => s.eventos.duplicateEvent(ev.id, day(40)));
    if (dup?.id) await call("remove event", () => s.eventos.removeEvent(dup.id, { confirm: true }));
    await call("remove event dry", () => s.eventos.removeEvent(ev.id, { dryRun: true }));
  }
  const eventBody = (date) => ({
    title: "Noite de karaokê",
    date,
    starts_at: "20:00",
    ends_at: null,
    description: "Microfone aberto a noite toda.",
    booking_mode: "tables",
    list_capacity: null,
    entry_times: [],
    party_max: null,
    requires_approval: false,
    layout_id: null,
    day_plan: { opens_at: null, closes_at: null },
    internal_note: "",
    tables_limit: null,
    private_label: null,
    image_id: null,
    translations: { es: { title: "Noche de karaoke", description: "" }, en: { title: "Karaoke night", description: "" } },
  });
  await call("create event dry", () => s.eventos.createEvent({ ...eventBody(day(20)), published: true }, { dryRun: true }));
  await call("create event", () => s.eventos.createEvent({ ...eventBody(day(21)), published: false }));
  await call("event photos", () => s.eventos.photos());
  await call("event settings", () => s.eventos.eventSettings());

  // Clientes
  const customers = await call("customers", () => s.clientes.list({ q: "", limit: 20 }));
  await call("customers search", () => s.clientes.list({ q: "9999", limit: 5 }));
  const cust = listOf(customers)[0];
  if (cust) {
    const card = await call("customer", () => s.clientes.getOne(cust.id));
    await call("customer update", () => s.clientes.update(cust.id, { internal_notes: "Prefere o balcão", tags: ["regular"] }, card?.version));
    await call("customer stale", () => s.clientes.update(cust.id, { internal_notes: "x" }, "velha"));
    await call("reveal", () => s.clientes.revealPhone(cust.id));
    await call("export customer", () => s.clientes.exportData(cust.id));
  }
  const last = listOf(customers).at(-1);
  if (last && last !== cust) await call("anonymize", () => s.clientes.anonymize(last.id));
  await call("privacy", () => s.clientes.privacyRequests({}));
  const pr = await call("privacy create", () => s.clientes.createPrivacyRequest({ customer_id: cust?.id, kind: "access", channel: "whatsapp", note: "Pediu pelo WhatsApp" }));
  if (pr?.id) await call("privacy resolve", () => s.clientes.resolvePrivacyRequest(pr.id, { status: "done", note: "Enviado" }));

  // Site, cardápio e galeria
  const menu = await call("staff menu", () => s.cardapio.menu());
  const cat = await call("create category", () =>
    s.cardapio.createCategory({ name: "Sobremesas", subtitle: "Para fechar a noite", sheet_style: "default", footer: "", photo: null, image_id: null, photo_alt: null, i18n: { es: { name: "Postres", subtitle: null }, en: { name: "Desserts", subtitle: null } } }),
  );
  const firstCat = (menu?.categories || [])[0];
  if (firstCat) await call("update category", () => s.cardapio.updateCategory(firstCat.id, { name: firstCat.name, subtitle: firstCat.subtitle || "", sheet_style: firstCat.sheet_style, footer: firstCat.footer || "", photo: firstCat.photo ?? null, image_id: firstCat.image_id ?? null, photo_alt: firstCat.photo_alt ?? null, i18n: firstCat.i18n }, firstCat.version));
  const item = await call("create item", () =>
    s.cardapio.createItem({ name: "Mochi", group: null, price_cents: 1800, description: "Doce de arroz", i18n: { es: { description: null }, en: { description: null } }, badges: [], featured: false, category_id: cat?.id || firstCat?.id, image_id: null }),
  );
  const firstItem = (firstCat?.items || [])[0];
  if (firstItem) {
    await call("update item", () => s.cardapio.updateItem(firstItem.id, { price_cents: firstItem.price_cents ?? 2000 }, firstItem.version));
    await call("item stale", () => s.cardapio.updateItem(firstItem.id, { price_cents: 1 }, "velha"));
    await call("acabou", () => s.cardapio.setAvailable(firstItem.id, false));
    await call("voltou", () => s.cardapio.setAvailable(firstItem.id, true));
  }
  if (menu?.categories?.length) await call("order", () => s.cardapio.order({ categories: menu.categories.map((c) => c.id) }));
  if (firstCat?.items?.length) await call("order items", () => s.cardapio.order({ category_id: firstCat.id, items: firstCat.items.map((i) => i.id) }));
  if (item?.id) await call("remove item", () => s.cardapio.removeItem(item.id));
  if (cat?.id) await call("remove category", () => s.cardapio.removeCategory(cat.id));
  await call("publish menu", () => s.cardapio.publish());

  const blocks = await call("blocks", () => s.site.blocks());
  const block = listOf(blocks)[0];
  if (block) {
    await call("save block", () => s.site.saveBlock(block.block, block.fields, block.etag));
    await call("save block stale", () => s.site.saveBlock(block.block, block.fields, "velha"));
    await call("publish block", () => s.site.publishBlock(block.block));
    const versions = await call("versions", () => s.site.versions(block.block));
    const v = listOf(versions).at(-1);
    if (v) await call("restore", () => s.site.restore(block.block, v.version));
  }
  await call("builds", () => s.site.builds(10));
  await call("stats", () => s.site.stats());

  const images = await call("images", () => s.galeria.images());
  const img = listOf(images)[0];
  if (img) await call("update image", () => s.galeria.update(img.id, { alt: img.alt || "Mesa do salão", credit: "Foto: casa", area: "" }));
  await call("upload", () => s.galeria.upload(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), { alt: "Prato de lámen", credit: "", area: "" }));
  if (img) await call("replace file", () => s.galeria.replaceFile(img.id, new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })));
  const unused = listOf(await call("images again", () => s.galeria.images())).find((i) => !(i.used_in || i.uses || []).length);
  if (unused) await call("remove image", () => s.galeria.remove(unused.id));

  // Configurações
  const index = await call("settings", () => s.configuracoes.index());
  for (const g of index?.groups || []) {
    const doc = await call(`group ${g.group}`, () => s.configuracoes.group(g.group));
    if (!doc) continue;
    await call(`preview ${g.group}`, () => s.configuracoes.preview(g.group, { data: doc.data }));
    await call(`save ${g.group}`, () => s.configuracoes.save(g.group, { data: doc.data }, doc.version, { idempotencyKey: uuid() }));
  }
  await call("save stale", () => s.configuracoes.save("booking", { data: { window_days: 30 } }, "0"));
  await call("history", () => s.configuracoes.history("booking"));
  await call("exceptions", () => s.configuracoes.exceptions(day(), day(60)));
  const templates = await call("templates", () => s.configuracoes.templates());
  const tpl = listOf(templates)[0] || (templates?.templates || [])[0];
  if (tpl) await call("revise template", () => s.configuracoes.reviseTemplate(tpl.id, { pt: "Oi {nome}, sua mesa está confirmada.", es: "Hola {nome}, tu mesa está confirmada.", en: "Hi {nome}, your table is confirmed." }));
  for (const key of ["whatsapp", "google", "turnstile", "email"]) await call(`test ${key}`, () => s.configuracoes.testIntegration(key));
  await call("republish", () => s.configuracoes.republish("A publicação falhou"));
  const devices = await call("devices", () => s.configuracoes.devices.list());
  const dev = listOf(devices).find((d) => d.status === "pending");
  if (dev) await call("approve device", () => s.configuracoes.devices.approve(dev.id, { code: dev.code || "ABCD1234", name: "Tablet da porta", role: "floor", kind: "tablet", location: "Recepção", idle_min: 15 }));
  const approved = listOf(devices).find((d) => d.status === "approved");
  if (approved) {
    await call("rename device", () => s.configuracoes.devices.update(approved.id, { name: approved.name, idle_min: approved.idle_min ?? 15 }, approved.version));
    await reauth();
    await call("revoke device", () => s.configuracoes.devices.revoke(approved.id, "Aparelho perdido"));
  }
  const onboarding = await call("onboarding", () => s.configuracoes.onboarding.get());
  await call("onboarding save", () => s.configuracoes.onboarding.update({ current_step: "hours", skipped: [] }, { version: onboarding?.version }));
  await call("onboarding stale", () => s.configuracoes.onboarding.update({ dismissed: true }, { version: "0" }));

  // Google
  await call("google status", () => s.google.status());
  await call("google connect", () => s.google.update({ account_email: "casa@territorio.com.br", account_name: "Território", scopes: ["calendar", "drive.file"] }));
  await call("google status 2", () => s.google.status());
  await call("calendars", () => s.google.calendars());
  await call("folders", () => s.google.folders());
  await call("google events", () => s.google.events());
  await call("google update", () => s.google.update({ calendar: { create: true, name: "Reservas do Território" }, folder: { create: true, name: "Território" }, calendar_sync: true, drive_sync: true }));
  await reauth();
  await call("google off", () => s.google.update({ calendar_sync: false, delete_events: false }));
  await call("google disconnect", () => s.google.disconnect(false));

  // Equipe
  const users = await call("users", () => s.equipe.users());
  await call("pin user", () => s.equipe.createPinUser({ name: "Kauã Lima", role: "floor", phone: "+5545991112233" }));
  await call("invite", () => s.equipe.invite({ email: "nova@territorio.com.br", role: "manager" }));
  const floorUser = listOf(users).find((u) => u.role === "floor");
  const invited = listOf(users).find((u) => u.status === "invited");
  if (floorUser) {
    await call("rename user", () => s.equipe.update(floorUser.id, { name: floorUser.name }));
    await reauth();
    await call("change role", () => s.equipe.update(floorUser.id, { role: "manager", password: "admin" }));
    await call("change role back", () => s.equipe.update(floorUser.id, { role: "floor", password: "admin" }));
    await call("revoke sessions", () => s.equipe.revokeSessions(floorUser.id));
  }
  const manager = listOf(users).find((u) => u.role === "manager");
  if (manager) await call("reset mfa", () => s.equipe.resetMfa(manager.id, "admin"));
  if (invited) await call("resend invite", () => s.equipe.resendInvite(invited.id));
  const perms = await call("permissions", () => s.equipe.permissions());
  await reauth();
  await call("save permissions", () => s.equipe.savePermissions({ allowed: perms?.allowed || {}, password: "admin" }));

  // Registro e Sistema
  await call("audit", () => s.registro.list({ limit: 20 }));
  await call("audit filtered", () => s.registro.list({ action: "settings.update", from: day(-30), to: day() }));
  await reauth();
  await call("audit export", () => s.registro.exportCsv({ actor: "", action: "", device: "", from: day(-30), to: day() }));
  await call("system", () => s.sistema.status());
  await call("system devices", () => s.sistema.devices());

  // ---- o cliente responde à mesa oferecida pela fila de espera --------------------------------
  asStaff(null);
  const offers = state().reservations.filter((x) => x.status === "offered").slice(0, 2);
  // uma entrada da porta ou dos dados iniciais pode ainda não ter link: dá um, como a mensagem da oferta daria
  for (const r of offers) r.public_token ??= uuid().replace(/-/g, "") + uuid().replace(/-/g, "");
  for (const [i, r] of offers.entries()) {
    const t = tokensOf(r).waitlist;
    await call("offer view", () => api.links.view(t));
    await call(i === 0 ? "offer accept" : "offer decline", () => (i === 0 ? api.links.acceptOffer(t) : api.links.declineOffer(t)));
  }

  // ---- o gerente e a recepção --------------------------------------------------------------
  for (const role of ["gerente", "recepcao"]) {
    asStaff(role);
    await call(`${role} me`, () => api.staff.me());
    await call(`${role} dashboard`, () => s.hoje.dashboard(day()));
    await call(`${role} alerts`, () => s.avisos.list());
    await call(`${role} reservations`, () => s.reservas.list({}));
    await call(`${role} floor`, () => s.salao.floor());
    await call(`${role} waitlist`, () => s.espera.list());
    await call(`${role} menu`, () => s.cardapio.menu());
    await call(`${role} settings`, () => s.configuracoes.index());
    await call(`${role} settings booking`, () => s.configuracoes.group("booking"));
    await call(`${role} calendar`, () => s.agenda.calendar(day().slice(0, 7)));
    await call(`${role} users`, () => s.equipe.users());
    await call(`${role} audit`, () => s.registro.list({}));
    await call(`${role} system`, () => s.sistema.status());
    await call(`${role} customers`, () => s.clientes.list({}));
    await call(`${role} images`, () => s.galeria.images());
    await call(`${role} save settings`, () => s.configuracoes.save("booking", { data: { window_days: 30 } }, "1"));
  }

  // ---- o cenário vazio --------------------------------------------------------------------
  asStaff("dono", { mock: "vazio" });
  for (const [label, fn] of Object.entries({
    dashboard: () => s.hoje.dashboard(day()),
    reservations: () => s.reservas.list({}),
    floor: () => s.salao.floor(),
    waitlist: () => s.espera.list(),
    events: () => s.eventos.events({}),
    customers: () => s.clientes.list({}),
    privacy: () => s.clientes.privacyRequests({}),
    menu: () => s.cardapio.menu(),
    blocks: () => s.site.blocks(),
    builds: () => s.site.builds(),
    stats: () => s.site.stats(),
    images: () => s.galeria.images(),
    settings: () => s.configuracoes.index(),
    templates: () => s.configuracoes.templates(),
    onboarding: () => s.configuracoes.onboarding.get(),
    devices: () => s.configuracoes.devices.list(),
    users: () => s.equipe.users(),
    audit: () => s.registro.list({}),
    system: () => s.sistema.status(),
    google: () => s.google.status(),
    layouts: () => s.plantas.layouts(),
    areas: () => s.plantas.areas(),
    calendar: () => s.agenda.calendar(day().slice(0, 7)),
    snapshot: () => s.salao.nightSnapshot(),
    days: () => api.availability.getDays({ from: day(), to: day(29), partySize: 2 }),
    slots: () => api.availability.getSlots({ date: day(1), partySize: 2 }),
  })) {
    await call(`vazio ${label}`, fn);
  }
  // e o cenário de erro: toda chamada responde o problema que o catálogo descreve
  asStaff("dono", { mock: "erro" });
  await call("erro dashboard", () => s.hoje.dashboard(day()));
  asStaff("dono", { mock: "fora" });
  await call("fora floor", () => s.salao.floor());
  asStaff("dono");
  return log;
}

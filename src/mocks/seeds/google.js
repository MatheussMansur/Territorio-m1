// A conta Google da casa (história 2.22): ainda não conectada, então a demonstração leva o dono
// por "Ligar conta Google". O que a conta simulada já tem (suas agendas e
// suas pastas do Drive) está aqui, para "usar uma que já existe" ter algo real para escolher.
export function extend(state) {
  state.google = blankGoogle();
}

/** Uma casa que nunca conectou uma conta Google. */
export function blankGoogle() {
  return {
    connected: false,
    account_email: null,
    account_name: null,
    scopes: [],
    connected_at: null,
    connected_by: null,
    calendar: null,
    folder: null,
    calendar_sync: false,
    drive_sync: false,
    last_sync_at: null,
    problem: null,
    events: [],
    files: [],
    // o que a conta já tem antes de o sistema da casa mexer nela
    account_calendars: [
      { id: "cal-principal", name: "Marcus Norberto", primary: true },
      { id: "cal-eventos", name: "Território · Eventos fechados", primary: false },
      { id: "cal-fornecedores", name: "Entregas e fornecedores", primary: false },
    ],
    account_folders: [
      { id: "pasta-territorio", name: "Território" },
      { id: "pasta-contabilidade", name: "Contabilidade 2026" },
      { id: "pasta-fotos", name: "Fotos da casa" },
    ],
  };
}

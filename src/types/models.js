// Formatos usados pelas telas, pela API simulada e pelo contrato da API (docs/api/openapi.yaml).
// Só JSDoc: os editores checam os tipos com `// @ts-check`, nada sai no código que roda.

/** @typedef {'pending'|'confirmed'|'waitlisted'|'offered'|'declined'|'expired'|'canceled'|'completed'|'no_show'} ReservationStatus */
/** @typedef {'site'|'staff'|'whatsapp'|'phone'|'walk_in'} ReservationSource */
/** @typedef {'not_sent'|'sent'|'yes'|'no'|'no_reply'} CustomerConfirmation */
/** @typedef {'salao'|'quintal'|'balcao'} AreaKey */
/** @typedef {'birthday'|'high_chair'|'accessibility'|'dietary'} Flag */
/** @typedef {'owner'|'manager'|'floor'} Role */
/** @typedef {'available'|'few_left'|'full'|'past'} SlotState */
/** @typedef {'available'|'few_left'|'full'|'closed'|'no_booking'} DayState no_booking: aberto, sem reservas (evento de entrada livre) */
/** @typedef {'production'|'closed'|'event'|'holiday'|'maintenance'|'outside_window'|'past'} ClosedReason */
/** @typedef {'tables'|'list'|'closed'} AreaMode */
/** @typedef {'tables'|'list'|'mixed'|'private'|'none'} EventBookingMode */

/**
 * @typedef {object} Problem
 * @property {string} type ex.: validation, slot_full, duplicate_reservation, invalid_transition, rate_limited
 * @property {string} title
 * @property {number} status
 * @property {string} [detail]
 * @property {{field: string, message: string}[]} [errors]
 * @property {string} [request_id]
 */

/**
 * @typedef {object} OpeningHours
 * @property {number} weekday 0 = domingo
 * @property {boolean} open
 * @property {string} [label] mostrado quando fechado, ex.: "produção"
 * @property {string} [opens_at]
 * @property {string} [closes_at]
 * @property {string[]} [slots]
 * @property {string|null} [layout_id] a montagem padrão deste dia da semana
 * @property {{opens_at: string, closes_at: string}|null} [second_shift] o outro turno do dia (2.8)
 */

/**
 * @typedef {object} HousePublic
 * @property {string} server_time
 * @property {string} name
 * @property {string} tagline
 * @property {{street: string, number: string, district: string, city: string, state: string, zip?: string, lat?: number, lng?: number}} address
 * @property {string} whatsapp E.164
 * @property {string} instagram
 * @property {string} timezone
 * @property {OpeningHours[]} hours
 * @property {boolean} hours_confirmed
 * @property {{window_days: number, min_lead_min: number, party_max_online: number, large_group_action: 'request'|'whatsapp', tolerance_min: number, duration_min: number, cancel_until_hours: number, waitlist_enabled: boolean, google_login: boolean}} booking
 * @property {{version: string, items: {title: string, text: string}[]}} terms
 * @property {{key: AreaKey, name: string}[]} areas
 * @property {DayStatus[]} days ontem, hoje e os próximos 14 dias, já resolvidos
 */

/**
 * @typedef {object} DayStatus Um dia como o site mostra (plano do dia e evento aplicados)
 * @property {string} date
 * @property {boolean} open
 * @property {string|null} opens_at
 * @property {string|null} closes_at pode ser depois da meia-noite, ex.: "01:00"
 * @property {{opens_at: string, closes_at: string}|null} [second_shift] o outro turno do dia (2.8)
 * @property {string|null} reason_label
 * @property {string|null} event_title
 * @property {boolean} exception difere da semana padrão
 */

/**
 * @typedef {object} SlotAvailability
 * @property {string} time HH:MM
 * @property {SlotState} state
 * @property {boolean} waitlist_open
 */

/**
 * @typedef {object} DayAvailability
 * @property {string} date YYYY-MM-DD
 * @property {boolean} open
 * @property {ClosedReason} [reason]
 * @property {string} [reason_label]
 * @property {DayState} state
 * @property {SlotAvailability[]} [slots]
 * @property {{key: AreaKey, name: string, mode: 'tables'|'list'}[]} [areas] abertas naquele dia, para a preferência de área
 * @property {ListAvailability|null} [list]
 * @property {EventSummary|null} [event]
 * @property {number} [party_max_online] o máximo on-line do dia
 * @property {boolean} [party_too_large] as pessoas passam dele: seguir large_group_action
 * @property {number} [duration_min] tempo de mesa para este dia e estas pessoas, mostrado nos combinados
 * @property {number} [tolerance_min]
 * @property {number} [cancel_until_hours]
 */

/**
 * @typedef {object} ListAvailability Pessoas na lista da noite (evento com lista)
 * @property {number} capacity
 * @property {number} remaining
 * @property {'available'|'few_left'|'full'} state
 * @property {string[]} entry_times
 * @property {boolean} waitlist_open
 */

/**
 * @typedef {object} EventSummary
 * @property {string} id
 * @property {string} title
 * @property {string} starts_at
 * @property {EventBookingMode} booking_mode
 * @property {number|null} party_max
 * @property {boolean} requires_approval
 */

/**
 * @typedef {object} ReservationPublic
 * @property {string} code
 * @property {string} date
 * @property {string} time
 * @property {number} party_size
 * @property {ReservationStatus} status
 * @property {string} first_name
 * @property {AreaKey} [area_preference]
 * @property {AreaKey} [area_key]
 * @property {string|null} [event_title]
 * @property {string} tolerance_until HH:MM
 * @property {number|null} [waitlist_position]
 * @property {string|null} [pending_until]
 * @property {string|null} [offer_expires_at]
 * @property {string} can_cancel_until
 * @property {string} receipt_url
 */

/**
 * @typedef {object} ReservationStaff
 * @property {string} id
 * @property {string} code
 * @property {string} date
 * @property {string} time
 * @property {number} party_size
 * @property {ReservationStatus} status
 * @property {ReservationSource} source
 * @property {{id: string, name: string, phone_masked: string, visits: number, no_shows: number}} customer
 * @property {string[]} table_codes códigos na montagem daquele dia; vazio enquanto pendente, na lista de espera ou numa lista
 * @property {AreaKey} [area_key]
 * @property {string|null} [event_id]
 * @property {AreaKey} [area_preference]
 * @property {CustomerConfirmation} customer_confirmation
 * @property {string} [notes]
 * @property {string} [internal_notes]
 * @property {Flag[]} flags
 * @property {number} tolerance_min
 * @property {number} extra_tolerance_min
 * @property {string|null} arrived_at
 * @property {string|null} seated_at
 * @property {string|null} left_at
 * @property {number|null} [waitlist_position]
 * @property {string|null} [offer_expires_at]
 * @property {string|null} [pending_until]
 * @property {string} [starts_at]
 * @property {string} [ends_at]
 * @property {number} [duration_min] congelado quando a reserva foi feita
 * @property {number|null} [arrived_people]
 * @property {'customer'|'staff'|'system'|null} [canceled_by]
 * @property {string|null} [cancel_reason]
 * @property {string|null} [decline_reason]
 * @property {string|null} [terms_version]
 * @property {string} created_at
 */

/**
 * @typedef {object} LayoutTable
 * @property {string} code único dentro da montagem; é o que as reservas guardam
 * @property {AreaKey} area
 * @property {number} min_seats
 * @property {number} max_seats
 * @property {'square'|'round'|'stool'|'long'} shape
 * @property {number} x
 * @property {number} y
 * @property {boolean} bookable_online
 * @property {number} priority
 */

/**
 * @typedef {object} Layout Um jeito de montar a casa: "Padrão", "Sem quintal", um evento
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {boolean} archived
 * @property {{key: AreaKey, mode: AreaMode, list_capacity: number|null, bookable_online: boolean}[]} areas
 * @property {LayoutTable[]} tables
 * @property {{codes: string[], max_seats: number|null, label: string|null}[]} combos
 */

/**
 * @typedef {object} DayPlan Tudo o que muda numa data; null herda da semana
 * @property {string} date
 * @property {boolean|null} [open]
 * @property {'closed'|'holiday'|'event'|'maintenance'|null} [closed_reason]
 * @property {string|null} [public_label]
 * @property {string|null} [opens_at]
 * @property {string|null} [closes_at]
 * @property {string[]|null} [slots]
 * @property {string|null} [layout_id]
 * @property {number|null} [duration_min]
 * @property {number|null} [max_covers_per_slot] pessoas chegando ao mesmo tempo
 * @property {number|null} [max_covers_night]
 * @property {string[]} [held_tables] guardadas fora do site para quem chega sem reserva
 * @property {AreaKey[]} [closed_areas]
 * @property {number|null} [party_max_online]
 * @property {string|null} [event_id]
 * @property {string} [internal_note]
 */

/**
 * @typedef {object} HouseEvent
 * @property {string} id
 * @property {string} title
 * @property {string} date
 * @property {string} starts_at
 * @property {string|null} [ends_at]
 * @property {string} [description]
 * @property {boolean} published
 * @property {EventBookingMode} booking_mode
 * @property {number|null} [list_capacity]
 * @property {string[]} [entry_times]
 * @property {number|null} [party_max]
 * @property {boolean} requires_approval
 * @property {number|null} [price_cents] vazio na v1
 * @property {string|null} [layout_id]
 */

/**
 * @typedef {object} User
 * @property {string} id
 * @property {string} name
 * @property {string} email
 * @property {Role} role
 * @property {'invited'|'active'|'disabled'} status
 * @property {boolean} mfa_enabled
 * @property {string|null} last_login_at
 */

/**
 * @typedef {object} MenuItem
 * @property {string} id
 * @property {string} category_id
 * @property {string} name
 * @property {string} [description]
 * @property {number|null} price_cents
 * @property {string|null} [price_label]
 * @property {('vegetarian'|'gluten_free'|'spicy')[]} badges
 * @property {boolean} available
 * @property {boolean} [featured]
 * @property {number} sort
 */

/**
 * @typedef {object} MenuCategory
 * @property {string} id
 * @property {string} name
 * @property {string} [subtitle]
 * @property {'dark'|'light'|'handmade'|'default'} sheet_style os cardápios impressos da casa: dark = ramen, handmade = cartão de bebidas
 * @property {string} [footer]
 * @property {string|null} [image_id]
 * @property {ImageRef} [image] a foto pronta para a tela
 * @property {number} sort
 * @property {MenuItem[]} items
 */

/**
 * @typedef {object|null} ImageRef Uma foto com os tamanhos gerados
 * @property {string|null} id
 * @property {string} alt
 * @property {number} width
 * @property {number} height
 * @property {string} placeholder
 * @property {number} focal_x
 * @property {number} focal_y
 * @property {{format: 'avif'|'webp'|'jpeg', width: number, url: string}[]} sources
 */

/**
 * @typedef {object} EventPublic O que o site mostra de um evento: nunca a nota interna, as contagens ou a montagem
 * @property {string} id
 * @property {string} title
 * @property {string} date
 * @property {string} starts_at
 * @property {string|null} ends_at
 * @property {string} [description]
 * @property {ImageRef} image
 * @property {EventBookingMode} booking_mode
 * @property {number|null} party_max
 * @property {boolean} requires_approval
 * @property {boolean} past uma edição passada, mostrada com a foto
 */

/**
 * @typedef {object} BookingDraft
 * @property {number} step
 * @property {number} party_size
 * @property {string|null} date
 * @property {string|null} time
 * @property {AreaKey|null} area_preference
 * @property {string} name
 * @property {string} phone E.164
 * @property {string} notes
 * @property {Flag[]} flags
 * @property {boolean} terms_accepted
 * @property {string|null} idempotency_key
 */

export {};

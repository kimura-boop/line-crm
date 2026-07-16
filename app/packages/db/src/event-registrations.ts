import { jstNow } from './utils.js';

// =============================================================================
// Event Registrations — イベント申し込みシステム
// =============================================================================

export interface Event {
  id: string;
  line_account_id: string;
  title: string;
  completion_message: string;
  bank_info: string;
  is_active: number;
  created_at: string;
}

export interface EventSlot {
  id: string;
  event_id: string;
  event_date: string;
  time_slot: string;
  capacity: number;
  sort_order: number;
  is_active: number;
  created_at: string;
}

export interface EventSlotWithCount extends EventSlot {
  registered_count: number;
  remaining: number;
  is_full: boolean;
}

export interface EventRegistration {
  id: string;
  event_slot_id: string;
  friend_id: string | null;
  line_user_id: string;
  display_name: string;
  participant_type: string;
  status: string;
  created_at: string;
}

// ── Events ────────────────────────────────────────────────────────────────────

export async function getEvents(db: D1Database, lineAccountId?: string): Promise<Event[]> {
  if (lineAccountId) {
    const result = await db
      .prepare('SELECT * FROM events WHERE line_account_id = ? ORDER BY created_at DESC')
      .bind(lineAccountId)
      .all<Event>();
    return result.results;
  }
  const result = await db
    .prepare('SELECT * FROM events ORDER BY created_at DESC')
    .all<Event>();
  return result.results;
}

export async function getEventById(db: D1Database, id: string): Promise<Event | null> {
  return db.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<Event>();
}

export async function getEventWithSlots(
  db: D1Database,
  eventId: string,
): Promise<{ event: Event; slots: EventSlotWithCount[] } | null> {
  const event = await getEventById(db, eventId);
  if (!event) return null;

  const result = await db
    .prepare(
      `SELECT s.*,
         COALESCE(
           (SELECT COALESCE(SUM(r.participant_count), 0) FROM event_registrations r
            WHERE r.event_slot_id = s.id AND r.status = 'confirmed'),
           0
         ) AS registered_count
       FROM event_slots s
       WHERE s.event_id = ? AND s.is_active = 1
       ORDER BY s.event_date ASC, s.sort_order ASC, s.time_slot ASC`,
    )
    .bind(eventId)
    .all<EventSlot & { registered_count: number }>();

  const slots: EventSlotWithCount[] = result.results.map((s) => ({
    ...s,
    remaining: Math.max(0, s.capacity - s.registered_count),
    is_full: s.registered_count >= s.capacity,
  }));

  return { event, slots };
}

export interface CreateEventInput {
  lineAccountId: string;
  title: string;
  completionMessage: string;
  bankInfo: string;
}

export async function createEvent(db: D1Database, input: CreateEventInput): Promise<Event> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO events (id, line_account_id, title, completion_message, bank_info, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    )
    .bind(id, input.lineAccountId, input.title, input.completionMessage, input.bankInfo, now)
    .run();
  return (await getEventById(db, id))!;
}

export interface UpdateEventInput {
  title?: string;
  completionMessage?: string;
  bankInfo?: string;
  isActive?: boolean;
}

export async function updateEvent(
  db: D1Database,
  id: string,
  input: UpdateEventInput,
): Promise<Event | null> {
  const existing = await getEventById(db, id);
  if (!existing) return null;
  await db
    .prepare(
      `UPDATE events SET title = ?, completion_message = ?, bank_info = ?, is_active = ? WHERE id = ?`,
    )
    .bind(
      input.title ?? existing.title,
      input.completionMessage ?? existing.completion_message,
      input.bankInfo ?? existing.bank_info,
      'isActive' in input ? (input.isActive ? 1 : 0) : existing.is_active,
      id,
    )
    .run();
  return getEventById(db, id);
}

// ── Event Slots ───────────────────────────────────────────────────────────────

export async function getEventSlotById(
  db: D1Database,
  id: string,
): Promise<EventSlotWithCount | null> {
  const row = await db
    .prepare(
      `SELECT s.*,
         COALESCE(
           (SELECT COALESCE(SUM(r.participant_count), 0) FROM event_registrations r
            WHERE r.event_slot_id = s.id AND r.status = 'confirmed'),
           0
         ) AS registered_count
       FROM event_slots s
       WHERE s.id = ? AND s.is_active = 1`,
    )
    .bind(id)
    .first<EventSlot & { registered_count: number }>();
  if (!row) return null;
  return {
    ...row,
    remaining: Math.max(0, row.capacity - row.registered_count),
    is_full: row.registered_count >= row.capacity,
  };
}

export interface CreateEventSlotInput {
  eventId: string;
  eventDate: string;
  timeSlot: string;
  capacity: number;
  sortOrder?: number;
}

export async function createEventSlot(
  db: D1Database,
  input: CreateEventSlotInput,
): Promise<EventSlot> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO event_slots (id, event_id, event_date, time_slot, capacity, sort_order, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .bind(id, input.eventId, input.eventDate, input.timeSlot, input.capacity, input.sortOrder ?? 0, now)
    .run();
  return (await db.prepare('SELECT * FROM event_slots WHERE id = ?').bind(id).first<EventSlot>())!;
}

export async function deleteEventSlot(db: D1Database, id: string): Promise<void> {
  await db
    .prepare('UPDATE event_slots SET is_active = 0 WHERE id = ?')
    .bind(id)
    .run();
}

// ── Event Registrations ───────────────────────────────────────────────────────

export interface CreateRegistrationInput {
  eventSlotId: string;
  friendId?: string | null;
  lineUserId: string;
  displayName: string;
  participantType?: string;
  isFirstVisit?: boolean;
  participantCount?: number;
}

export interface CreateRegistrationResult {
  success: boolean;
  error?: 'capacity_exceeded' | 'already_registered' | 'slot_not_found';
  registration?: EventRegistration;
}

export async function createEventRegistration(
  db: D1Database,
  input: CreateRegistrationInput,
): Promise<CreateRegistrationResult> {
  const slot = await getEventSlotById(db, input.eventSlotId);
  if (!slot) return { success: false, error: 'slot_not_found' };
  const count = input.participantCount ?? 1;
  if (slot.remaining < count) return { success: false, error: 'capacity_exceeded' };

  const id = crypto.randomUUID();
  const now = jstNow();

  try {
    await db
      .prepare(
        `INSERT INTO event_registrations
           (id, event_slot_id, friend_id, line_user_id, display_name, participant_type, status, is_first_visit, participant_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
      )
      .bind(id, input.eventSlotId, input.friendId ?? null, input.lineUserId, input.displayName, input.participantType ?? 'school', input.isFirstVisit ? 1 : 0, input.participantCount ?? 1, now)
      .run();
  } catch (e) {
    const msg = String((e as Error).message ?? '');
    if (msg.toLowerCase().includes('unique')) {
      return { success: false, error: 'already_registered' };
    }
    throw e;
  }

  const reg = await db
    .prepare('SELECT * FROM event_registrations WHERE id = ?')
    .bind(id)
    .first<EventRegistration>();
  return { success: true, registration: reg! };
}

export async function getEventRegistrations(
  db: D1Database,
  eventId: string,
): Promise<(EventRegistration & { event_date: string; time_slot: string })[]> {
  const result = await db
    .prepare(
      `SELECT r.*, s.event_date, s.time_slot, r.participant_count
       FROM event_registrations r
       JOIN event_slots s ON s.id = r.event_slot_id
       WHERE s.event_id = ? AND r.status = 'confirmed' AND s.event_date >= date('now', '+9 hours')
       ORDER BY s.event_date ASC, s.time_slot ASC, r.created_at ASC`,
    )
    .bind(eventId)
    .all<EventRegistration & { event_date: string; time_slot: string }>();
  return result.results;
}

export async function cancelEventRegistration(
  db: D1Database,
  registrationId: string,
): Promise<void> {
  await db
    .prepare(`UPDATE event_registrations SET status = 'cancelled' WHERE id = ?`)
    .bind(registrationId)
    .run();
}

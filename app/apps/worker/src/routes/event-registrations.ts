import { Hono } from 'hono';
import {
  getEvents,
  getEventById,
  getEventWithSlots,
  createEvent,
  updateEvent,
  createEventSlot,
  deleteEventSlot,
  getEventSlotById,
  createEventRegistration,
  getEventRegistrations,
  getFriendByLineUserId,
} from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import type { Env } from '../index.js';

const eventRegistrations = new Hono<Env>();

const PRICES: Record<string, number> = {
  school: 1980,
  external: 2200,
};

// LINE IDトークンを検証して { sub, name } を返す
async function verifyLineIdToken(
  idToken: string,
  clientId: string,
): Promise<{ sub: string; name: string } | null> {
  try {
    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
    });
    if (!res.ok) return null;
    return await res.json() as { sub: string; name: string };
  } catch {
    return null;
  }
}

// ── 公開エンドポイント（認証不要）────────────────────────────────────────────

// イベント情報 + スロット一覧（残席数含む）を返す
eventRegistrations.get('/api/events/:id', async (c) => {
  const id = c.req.param('id');
  const result = await getEventWithSlots(c.env.DB, id);
  if (!result) return c.json({ success: false, error: 'Event not found' }, 404);

  return c.json({
    id: result.event.id,
    title: result.event.title,
    is_active: Boolean(result.event.is_active),
    slots: result.slots.map((s) => ({
      id: s.id,
      event_date: s.event_date,
      time_slot: s.time_slot,
      capacity: s.capacity,
      registered_count: s.registered_count,
      remaining: s.remaining,
      is_full: s.is_full,
    })),
  });
});

// 申し込み登録（複数スロット対応）
eventRegistrations.post('/api/events/:id/register', async (c) => {
  const eventId = c.req.param('id');
  const body = await c.req.json<{
    idToken?: string;
    slotIds?: string[];
    participantType?: string;
  }>();

  if (!body.idToken || !body.slotIds?.length || !body.participantType) {
    return c.json({ success: false, error: 'idToken, slotIds, and participantType are required' }, 400);
  }

  if (!PRICES[body.participantType]) {
    return c.json({ success: false, error: 'Invalid participantType' }, 400);
  }

  // LINEのIDトークンを検証
  const verified = await verifyLineIdToken(body.idToken, c.env.LINE_LOGIN_CHANNEL_ID);
  if (!verified) {
    return c.json({ success: false, error: 'Invalid ID token' }, 400);
  }

  const lineUserId = verified.sub;
  const displayName = verified.name;

  // イベントの存在確認
  const event = await getEventById(c.env.DB, eventId);
  if (!event || !event.is_active) {
    return c.json({ success: false, error: 'Event not found or closed' }, 404);
  }

  // friendsテーブルからfriend_idを取得（任意）
  const friend = await getFriendByLineUserId(c.env.DB, lineUserId);

  // 各スロットを登録（already_registered はスキップ、capacity_exceeded はエラー）
  const registeredSlots: { event_date: string; time_slot: string }[] = [];

  for (const slotId of body.slotIds) {
    const slot = await getEventSlotById(c.env.DB, slotId);
    if (!slot || slot.event_id !== eventId) {
      return c.json({ success: false, error: 'Slot not found' }, 404);
    }

    const result = await createEventRegistration(c.env.DB, {
      eventSlotId: slotId,
      friendId: friend?.id ?? null,
      lineUserId,
      displayName,
      participantType: body.participantType,
    });

    if (!result.success) {
      if (result.error === 'already_registered') continue; // 申込済みはスキップ
      if (result.error === 'capacity_exceeded') {
        return c.json({ success: false, error: 'capacity_exceeded', slotId }, 409);
      }
      return c.json({ success: false, error: result.error }, 409);
    }

    registeredSlots.push({ event_date: slot.event_date, time_slot: slot.time_slot });
  }

  // 1件も新規登録がなければ（全て申込済み）
  if (registeredSlots.length === 0) {
    return c.json({ success: false, error: 'already_registered' }, 409);
  }

  // LINE Push: 確認メッセージ送信
  c.executionCtx.waitUntil(
    sendConfirmationMessage(
      c.env.DB,
      event.line_account_id,
      lineUserId,
      displayName,
      registeredSlots,
      body.participantType,
      event.bank_info,
    ),
  );

  return c.json({ success: true, count: registeredSlots.length });
});

// 申し込み完了メッセージをLINE Pushで送信
async function sendConfirmationMessage(
  db: D1Database,
  lineAccountId: string,
  lineUserId: string,
  displayName: string,
  slots: { event_date: string; time_slot: string }[],
  participantType: string,
  bankInfo: string,
): Promise<void> {
  try {
    const account = await db
      .prepare('SELECT channel_access_token FROM line_accounts WHERE id = ? AND is_active = 1')
      .bind(lineAccountId)
      .first<{ channel_access_token: string }>();
    if (!account) return;

    const lineClient = new LineClient(account.channel_access_token);

    const DAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

    // 日程一覧（日付順）
    const sortedSlots = [...slots].sort((a, b) => a.event_date.localeCompare(b.event_date));
    const dateList = sortedSlots.map((s) => {
      const d = new Date(s.event_date + 'T00:00:00+09:00');
      return `・${d.getMonth() + 1}月${d.getDate()}日（${DAYS_JA[d.getDay()]}）${s.time_slot}`;
    }).join('\n');

    const count = sortedSlots.length;
    const pricePerDay = PRICES[participantType] ?? 1980;
    const total = pricePerDay * count;
    const typeLabel = participantType === 'external' ? '外部生' : 'スクール生';

    const confirmText =
      `✅ お申し込みありがとうございます！\n\n` +
      `${displayName}さんの申し込みを受け付けました。\n\n` +
      `【申し込み日程（${count}日）】\n${dateList}\n\n` +
      `【参加費】${typeLabel}\n` +
      `${pricePerDay.toLocaleString()}円 × ${count}日 = ${total.toLocaleString()}円`;

    const bankText = `💳 振込先情報\n\n${bankInfo}`;

    await lineClient.pushMessage(lineUserId, [
      { type: 'text', text: confirmText },
      { type: 'text', text: bankText },
    ]);
  } catch (e) {
    console.error('[event-registrations] Failed to send confirmation message:', e);
  }
}

// ── 管理者エンドポイント（認証必要）────────────────────────────────────────────

// イベント一覧
eventRegistrations.get('/api/events', async (c) => {
  const events = await getEvents(c.env.DB);
  return c.json(events.map((e) => ({
    id: e.id,
    lineAccountId: e.line_account_id,
    title: e.title,
    isActive: Boolean(e.is_active),
    createdAt: e.created_at,
  })));
});

// イベント作成
eventRegistrations.post('/api/events', async (c) => {
  const body = await c.req.json<{
    lineAccountId?: string;
    title?: string;
    completionMessage?: string;
    bankInfo?: string;
  }>();

  if (!body.lineAccountId || !body.title || !body.completionMessage || !body.bankInfo) {
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }

  const event = await createEvent(c.env.DB, {
    lineAccountId: body.lineAccountId,
    title: body.title,
    completionMessage: body.completionMessage,
    bankInfo: body.bankInfo,
  });

  return c.json({ success: true, event }, 201);
});

// イベント更新
eventRegistrations.put('/api/events/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    title?: string;
    completionMessage?: string;
    bankInfo?: string;
    isActive?: boolean;
  }>();

  const event = await updateEvent(c.env.DB, id, body);
  if (!event) return c.json({ success: false, error: 'Event not found' }, 404);
  return c.json({ success: true, event });
});

// スロット追加
eventRegistrations.post('/api/events/:id/slots', async (c) => {
  const eventId = c.req.param('id');
  const body = await c.req.json<{
    eventDate?: string;
    timeSlot?: string;
    capacity?: number;
    sortOrder?: number;
  }>();

  if (!body.eventDate || !body.timeSlot || !body.capacity) {
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }

  const slot = await createEventSlot(c.env.DB, {
    eventId,
    eventDate: body.eventDate,
    timeSlot: body.timeSlot,
    capacity: body.capacity,
    sortOrder: body.sortOrder,
  });

  return c.json({ success: true, slot }, 201);
});

// スロット削除（無効化）
eventRegistrations.delete('/api/events/:eventId/slots/:slotId', async (c) => {
  await deleteEventSlot(c.env.DB, c.req.param('slotId'));
  return c.json({ success: true });
});

// 申し込み一覧（管理者用）
eventRegistrations.get('/api/events/:id/registrations', async (c) => {
  const eventId = c.req.param('id');
  const registrations = await getEventRegistrations(c.env.DB, eventId);
  return c.json(registrations.map((r) => ({
    id: r.id,
    lineUserId: r.line_user_id,
    displayName: r.display_name,
    participantType: r.participant_type,
    eventDate: r.event_date,
    timeSlot: r.time_slot,
    status: r.status,
    createdAt: r.created_at,
  })));
});

export { eventRegistrations };

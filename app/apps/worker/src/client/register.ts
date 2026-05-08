/**
 * LIFF Event Registration Page — イベント申し込みフォーム（複数日程対応）
 *
 * Flow:
 * 1. LINEプロフィール取得 → お名前を自動表示
 * 2. 参加種別を選択（スクール生 / 外部生）
 * 3. 参加日程をチェックボックスで複数選択
 * 4. 日曜日を選んだ場合は時間帯を選択（平日は17:00-18:30 固定）
 * 5. 申し込みボタン → APIへ送信
 * 6. 完了画面表示（LINEにメッセージが届く）
 */

declare const liff: {
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>;
  getIDToken(): string | null;
  getDecodedIDToken(): { sub: string; name?: string; picture?: string } | null;
  isInClient(): boolean;
  closeWindow(): void;
};

interface EventSlot {
  id: string;
  event_date: string;
  time_slot: string;
  capacity: number;
  registered_count: number;
  remaining: number;
  is_full: boolean;
}

interface EventData {
  id: string;
  title: string;
  is_active: boolean;
  slots: EventSlot[];
}

interface RegisterState {
  profile: { displayName: string; pictureUrl?: string } | null;
  idToken: string | null;
  event: EventData | null;
  selectedDates: Set<string>;
  sundaySlots: Map<string, string>;  // Sunday date → chosen slotId
  participantType: 'school' | 'external' | null;
  submitting: boolean;
}

const state: RegisterState = {
  profile: null,
  idToken: null,
  event: null,
  selectedDates: new Set(),
  sundaySlots: new Map(),
  participantType: null,
  submitting: false,
};

const PRICES = { school: 1980, external: 2200 } as const;
const DAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDateJa(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  return `${d.getMonth() + 1}月${d.getDate()}日（${DAYS_JA[d.getDay()]}）`;
}

function isSunday(dateStr: string): boolean {
  return new Date(dateStr + 'T00:00:00+09:00').getDay() === 0;
}

function getApp(): HTMLElement {
  return document.getElementById('app')!;
}

// 選択済みスロットID一覧を返す。未確定なら null
function resolveSlotIds(): string[] | null {
  const { event, selectedDates, sundaySlots } = state;
  if (!event || selectedDates.size === 0) return null;

  const ids: string[] = [];
  for (const date of selectedDates) {
    if (isSunday(date)) {
      const slotId = sundaySlots.get(date);
      if (!slotId) return null; // 日曜の時間帯未選択
      ids.push(slotId);
    } else {
      // 平日: 当日唯一の（空きのある）スロットを自動選択
      const slot = event.slots.find((s) => s.event_date === date);
      if (!slot) return null;
      ids.push(slot.id);
    }
  }
  return ids;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

export function renderLoading(message = '読み込み中...'): void {
  getApp().innerHTML = `
    <div class="reg-container">
      <div class="card" style="text-align:center;padding:48px 24px;">
        <div class="loading-spinner"></div>
        <p class="message" style="margin-top:12px;">${escapeHtml(message)}</p>
      </div>
    </div>
  `;
}

export function renderError(message: string, canRetry = false): void {
  getApp().innerHTML = `
    <div class="reg-container">
      <div class="card" style="text-align:center;padding:40px 24px;">
        <div style="width:56px;height:56px;border-radius:50%;background:#fee2e2;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
          <span style="font-size:24px;">!</span>
        </div>
        <h2 style="color:#ef4444;font-size:16px;margin-bottom:12px;">エラー</h2>
        <p class="message">${escapeHtml(message)}</p>
        ${canRetry ? `<button class="reg-submit-btn" data-action="retry" style="margin-top:20px;background:#6b7280;">フォームに戻る</button>` : ''}
      </div>
    </div>
  `;
  if (canRetry) {
    getApp().querySelector('[data-action="retry"]')?.addEventListener('click', () => render());
  }
}

function renderSuccess(count: number): void {
  getApp().innerHTML = `
    <div class="reg-container">
      <div class="card" style="text-align:center;padding:48px 24px;">
        <div style="width:64px;height:64px;border-radius:50%;background:#06C755;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">
          <span style="color:#fff;font-size:32px;line-height:1;">✓</span>
        </div>
        <h2 style="color:#06C755;font-size:18px;margin-bottom:16px;">申し込み完了</h2>
        <p class="message">
          ありがとうございます。<br>
          ${count}日分の申し込みが完了しました。<br><br>
          LINEに確認メッセージと<br>
          振込先情報をお送りしました。
        </p>
        <button class="reg-submit-btn" data-action="close" style="margin-top:24px;background:#fff;color:#06C755;border:1.5px solid #06C755;">
          閉じる
        </button>
      </div>
    </div>
  `;
  getApp().querySelector('[data-action="close"]')?.addEventListener('click', () => {
    if (liff.isInClient()) liff.closeWindow();
  });
}

function render(): void {
  const { profile, event, selectedDates, sundaySlots, participantType } = state;
  if (!profile || !event) return;

  const uniqueDates = [...new Set(event.slots.map((s) => s.event_date))].sort();
  const slotIds = resolveSlotIds();
  const count = selectedDates.size;
  const price = participantType ? PRICES[participantType] : 0;
  const canSubmit = Boolean(slotIds && participantType);

  // ── 参加種別 ──
  const typeHtml = `
    <div class="reg-section">
      <p class="reg-label">参加種別</p>
      <div style="display:flex;gap:10px;">
        <button class="type-btn ${participantType === 'school' ? 'type-btn-active' : ''}"
          data-type="school">スクール生<br><span style="font-size:11px;font-weight:400;">1,980円/日</span></button>
        <button class="type-btn ${participantType === 'external' ? 'type-btn-active' : ''}"
          data-type="external">外部生<br><span style="font-size:11px;font-weight:400;">2,200円/日</span></button>
      </div>
    </div>
  `;

  // ── 日程選択（チェックボックス）──
  const datesHtml = uniqueDates.map((date) => {
    const slotsOnDate = event.slots.filter((s) => s.event_date === date);
    const allFull = slotsOnDate.every((s) => s.is_full);
    const isChecked = selectedDates.has(date);
    const sunday = isSunday(date);
    const timeLabel = sunday ? '時間帯を下で選択' : slotsOnDate[0]?.time_slot ?? '';
    const cls = allFull
      ? 'reg-radio-label disabled'
      : isChecked
        ? 'reg-radio-label selected'
        : 'reg-radio-label';

    return `
      <label class="${cls}">
        <input type="checkbox" name="reg-date" value="${escapeHtml(date)}"
          ${isChecked ? 'checked' : ''} ${allFull ? 'disabled' : ''}>
        <span>
          ${escapeHtml(formatDateJa(date))}
          <span style="font-size:12px;color:#888;margin-left:4px;">${escapeHtml(timeLabel)}</span>
        </span>
        ${allFull ? '<span class="reg-badge full">満員</span>' : ''}
      </label>
    `;
  }).join('');

  // ── 日曜の時間帯選択 ──
  const selectedSundays = [...selectedDates].filter(isSunday).sort();
  const sundaySlotsHtml = selectedSundays.map((date) => {
    const slotsOnDate = event.slots.filter((s) => s.event_date === date);
    const chosenId = sundaySlots.get(date) ?? '';
    const slotsMarkup = slotsOnDate.map((slot) => {
      const isChosen = chosenId === slot.id;
      const cls = slot.is_full
        ? 'reg-radio-label disabled'
        : isChosen
          ? 'reg-radio-label selected'
          : 'reg-radio-label';
      const badgeCls = slot.is_full ? 'reg-badge full' : slot.remaining <= 3 ? 'reg-badge warn' : 'reg-badge ok';
      const badgeText = slot.is_full ? '満員' : `残${slot.remaining}席`;
      return `
        <label class="${cls}">
          <input type="radio" name="reg-sunday-${escapeHtml(date)}" value="${escapeHtml(slot.id)}"
            ${isChosen ? 'checked' : ''} ${slot.is_full ? 'disabled' : ''}>
          <span>${escapeHtml(slot.time_slot)}</span>
          <span class="${badgeCls}">${badgeText}</span>
        </label>
      `;
    }).join('');

    return `
      <div class="reg-section" style="border-left:3px solid #06C755;">
        <p class="reg-label">${escapeHtml(formatDateJa(date))} の時間帯</p>
        <div class="reg-options">${slotsMarkup}</div>
      </div>
    `;
  }).join('');

  // ── 料金確認 ──
  const priceHtml = (count > 0 && participantType) ? `
    <div class="reg-section" style="background:#f0faf4;border-radius:10px;padding:14px 16px;">
      <p class="reg-label" style="margin-bottom:6px;">料金確認</p>
      <p style="font-size:15px;font-weight:700;color:#06C755;">
        ${price.toLocaleString()}円 × ${count}日 = ${(price * count).toLocaleString()}円
      </p>
      <p style="font-size:11px;color:#888;margin-top:4px;">申し込み後、振込先をLINEでお知らせします</p>
    </div>
  ` : '';

  getApp().innerHTML = `
    <div class="reg-container">
      <div class="reg-header">
        <p class="reg-header-sub">イベントお申し込み</p>
        <h1 class="reg-header-title">${escapeHtml(event.title)}</h1>
      </div>

      <div class="reg-section">
        <p class="reg-label">お名前</p>
        <p class="reg-name">${escapeHtml(profile.displayName)}</p>
        <p class="reg-hint">LINEの登録名が自動表示されています</p>
      </div>

      ${typeHtml}

      <div class="reg-section">
        <p class="reg-label">参加日程（複数選択可）</p>
        <div class="reg-options">${datesHtml}</div>
      </div>

      ${sundaySlotsHtml}

      ${priceHtml}

      <button class="reg-submit-btn ${canSubmit ? '' : 'disabled'}"
        data-action="submit" ${canSubmit ? '' : 'disabled'}>
        申し込む（${count}日分）
      </button>
      <p class="reg-footer-note">申し込み完了後、LINEにメッセージが届きます</p>
    </div>
  `;

  attachEvents();
}

function attachEvents(): void {
  const app = getApp();

  // 参加種別
  app.querySelectorAll('[data-type]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.participantType = (btn as HTMLElement).dataset.type as 'school' | 'external';
      render();
    });
  });

  // 日程チェックボックス
  app.querySelectorAll('input[name="reg-date"]').forEach((input) => {
    input.addEventListener('change', () => {
      const el = input as HTMLInputElement;
      if (el.checked) {
        state.selectedDates.add(el.value);
      } else {
        state.selectedDates.delete(el.value);
        state.sundaySlots.delete(el.value); // 選択解除時に時間帯もリセット
      }
      render();
    });
  });

  // 日曜の時間帯ラジオ
  app.querySelectorAll('input[type="radio"][name^="reg-sunday-"]').forEach((input) => {
    input.addEventListener('change', () => {
      const el = input as HTMLInputElement;
      const date = el.name.replace('reg-sunday-', '');
      state.sundaySlots.set(date, el.value);
      render();
    });
  });

  // 申し込みボタン
  app.querySelector('[data-action="submit"]')?.addEventListener('click', () => submitRegistration());
}

// ── API ───────────────────────────────────────────────────────────────────────

async function submitRegistration(): Promise<void> {
  if (state.submitting) return;
  const { idToken, event, participantType } = state;
  const slotIds = resolveSlotIds();
  if (!idToken || !event || !slotIds || !participantType) return;

  state.submitting = true;
  renderLoading('申し込み中...');

  try {
    const res = await fetch(`/api/events/${event.id}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, slotIds, participantType }),
    });

    if (res.ok) {
      const data = await res.json() as { success: boolean; count: number };
      renderSuccess(data.count);
      return;
    }

    const data = await res.json() as { error: string };
    state.submitting = false;

    if (data.error === 'already_registered') {
      renderError('選択した日程はすべて申し込み済みです。', false);
    } else if (data.error === 'capacity_exceeded') {
      renderError('申し訳ありません。選択した日程が満員になりました。別の日程をお選びください。', true);
    } else {
      renderError('申し込みに失敗しました。もう一度お試しください。', true);
    }
  } catch {
    state.submitting = false;
    renderError('通信エラーが発生しました。もう一度お試しください。', true);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initRegister(eventId: string | null): Promise<void> {
  if (!eventId) {
    renderError('イベントIDが指定されていません。正しいURLからアクセスしてください。');
    return;
  }

  renderLoading('イベント情報を読み込み中...');

  let eventData: EventData;
  try {
    const eventRes = await fetch(`/api/events/${encodeURIComponent(eventId)}`);
    if (!eventRes.ok) {
      renderError('イベント情報の取得に失敗しました。');
      return;
    }
    eventData = await eventRes.json() as EventData;
    if (!eventData.is_active) {
      renderError('このイベントの申し込みは締め切られました。');
      return;
    }
  } catch {
    renderError('イベント情報の取得に失敗しました。通信エラーが発生しました。');
    return;
  }

  renderLoading('プロフィールを取得中...');

  try {
    const idToken = liff.getIDToken();
    const decodedToken = liff.getDecodedIDToken();

    let profile: { userId: string; displayName: string; pictureUrl?: string };
    try {
      profile = await liff.getProfile();
    } catch {
      if (!decodedToken) {
        renderError('プロフィールの取得に失敗しました。LINEアプリ内でもう一度お試しください。');
        return;
      }
      profile = {
        userId: decodedToken.sub,
        displayName: decodedToken.name ?? 'ユーザー',
        pictureUrl: decodedToken.picture,
      };
    }

    state.profile = profile;
    state.idToken = idToken;
    state.event = eventData;

    render();
  } catch {
    renderError('プロフィールの取得に失敗しました。LINEアプリ内でもう一度お試しください。');
  }
}

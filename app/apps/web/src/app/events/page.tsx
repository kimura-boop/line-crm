'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'

interface Event {
  id: string
  title: string
  isActive: boolean
  createdAt: string
}

interface Slot {
  id: string
  event_date: string
  time_slot: string
  capacity: number
  registered_count: number
  remaining: number
  is_full: boolean
}

interface Registration {
  id: string
  displayName: string
  participantType: string
  eventDate: string
  timeSlot: string
  status: string
  createdAt: string
}

function exportCsv(registrations: Registration[], eventTitle: string, dateFilter: string) {
  const headers = ['名前', '種別', '日程', '時間帯', '申し込み日時']
  const rows = registrations.map(r => {
    const d = new Date(r.eventDate + 'T12:00:00+09:00')
    const DAYS = ['日','月','火','水','木','金','土']
    return [r.displayName, r.participantType === 'general' ? '一般生' : r.participantType === 'coupon' ? '回数券利用' : 'スクール生', `${d.getMonth()+1}月${d.getDate()}日（${DAYS[d.getDay()]}）`, r.timeSlot, new Date(r.createdAt).toLocaleString('ja-JP')]
  })
  const csv = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${eventTitle}${dateFilter ? '_' + dateFilter : ''}_${new Date().toISOString().slice(0,10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function EventsPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'slots' | 'list' | 'add-slot'>('slots')
  const [addName, setAddName] = useState('')
  const [addSlotId, setAddSlotId] = useState('')
  const [addType, setAddType] = useState('general')
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newTimeSlot, setNewTimeSlot] = useState('')
  const [newCapacity, setNewCapacity] = useState('8')
  const [slotLoading, setSlotLoading] = useState(false)
  const [dateFilter, setDateFilter] = useState('all')

  useEffect(() => {
    fetchApi<Event[]>('/api/events')
      .then(data => { if (Array.isArray(data)) setEvents(data) })
      .finally(() => setLoading(false))
  }, [])

  const loadEventDetail = useCallback(async (event: Event) => {
    setSelectedEvent(event)
    setDetailLoading(true)
    setDateFilter('all')
    try {
      const [slotData, regData] = await Promise.all([
        fetchApi<{ slots: Slot[] }>(`/api/events/${event.id}`),
        fetchApi<Registration[]>(`/api/events/${event.id}/registrations`),
      ])
      if (slotData?.slots) setSlots(slotData.slots)
      if (Array.isArray(regData)) setRegistrations(regData)
    } catch { /* silent */ }
    setDetailLoading(false)
  }, [])

  const handleAddRegistration = async () => {
    if (!selectedEvent || !addName || !addSlotId) return
    setAddLoading(true)
    setAddError('')
    try {
      const res = await fetchApi<{ success: boolean; error?: string }>(`/api/events/${selectedEvent.id}/registrations`, {
        method: 'POST',
        body: JSON.stringify({ slotId: addSlotId, displayName: addName, participantType: addType }),
      })
      if (res.success) {
        setAddName('')
        setAddSlotId('')
        await loadEventDetail(selectedEvent)
      } else {
        setAddError(res.error === 'capacity_exceeded' ? '満席のため追加できません' : res.error || 'エラーが発生しました')
      }
    } catch {
      setAddError('エラーが発生しました')
    }
    setAddLoading(false)
  }

  const handleCancel = async (registrationId: string, name: string) => {
    if (!selectedEvent) return
    if (!confirm(`${name} の申し込みをキャンセルしますか？`)) return
    try {
      await fetchApi(`/api/events/${selectedEvent.id}/registrations/${registrationId}`, { method: 'DELETE' })
      await loadEventDetail(selectedEvent)
    } catch { /* silent */ }
  }

  const handleDeleteSlot = async (slotId: string, dateStr: string) => {
    if (!selectedEvent) return
    if (!confirm(`${formatDate(dateStr)} の日程を削除しますか？`)) return
    try {
      await fetchApi(`/api/events/${selectedEvent.id}/slots/${slotId}`, { method: 'DELETE' })
      await loadEventDetail(selectedEvent)
    } catch { /* silent */ }
  }

  const handleAddSlot = async () => {
    if (!selectedEvent || !newDate || !newTimeSlot || !newCapacity) return
    setSlotLoading(true)
    try {
      await fetchApi(`/api/events/${selectedEvent.id}/slots`, {
        method: 'POST',
        body: JSON.stringify({ eventDate: newDate, timeSlot: newTimeSlot, capacity: Number(newCapacity) }),
      })
      setNewDate('')
      setNewTimeSlot('')
      setNewCapacity('8')
      await loadEventDetail(selectedEvent)
      setActiveTab('slots')
    } catch { /* silent */ }
    setSlotLoading(false)
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00+09:00')
    const DAYS = ['日','月','火','水','木','金','土']
    return `${d.getMonth()+1}月${d.getDate()}日（${DAYS[d.getDay()]}）`
  }

  const uniqueDates = [...new Set(registrations.map(r => r.eventDate))].sort()
  const filteredRegistrations = dateFilter === 'all' ? registrations : registrations.filter(r => r.eventDate === dateFilter)
  const totalRegistrations = registrations.length
  const recentCount = registrations.filter(r => (new Date().getTime() - new Date(r.createdAt).getTime()) < 7*24*60*60*1000).length

  return (
    <div>
      <Header title="申し込み管理" description="イベント申し込みの一覧・残席確認・手動追加" />

      <div className="mb-6">
        <div className="flex flex-wrap gap-2">
          {loading ? <div className="text-sm text-gray-400">読み込み中...</div> : events.map(event => (
            <button key={event.id} onClick={() => loadEventDetail(event)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selectedEvent?.id === event.id ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              style={selectedEvent?.id === event.id ? { backgroundColor: '#06C755' } : {}}>
              {event.title}
            </button>
          ))}
        </div>
      </div>

      {selectedEvent && !detailLoading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs text-gray-400 mb-1">総申し込み数</p>
              <p className="text-2xl font-bold text-gray-900">{totalRegistrations}<span className="text-sm font-normal text-gray-400 ml-1">件</span></p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs text-gray-400 mb-1">直近7日間</p>
              <p className="text-2xl font-bold text-gray-900">{recentCount}<span className="text-sm font-normal text-gray-400 ml-1">件</span></p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs text-gray-400 mb-1">スロット数</p>
              <p className="text-2xl font-bold text-gray-900">{slots.length}<span className="text-sm font-normal text-gray-400 ml-1">枠</span></p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs text-gray-400 mb-1">満席スロット</p>
              <p className="text-2xl font-bold text-gray-900">{slots.filter(s => s.is_full).length}<span className="text-sm font-normal text-gray-400 ml-1">枠</span></p>
            </div>
          </div>

          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              <button onClick={() => setActiveTab('slots')} className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${activeTab === 'slots' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>日程別残席</button>
              <button onClick={() => setActiveTab('list')} className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${activeTab === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>申し込み一覧・手動追加</button>
              <button onClick={() => setActiveTab('add-slot')} className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${activeTab === 'add-slot' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>＋ 日程追加</button>
            </div>
            <button onClick={() => exportCsv(filteredRegistrations, selectedEvent.title, dateFilter !== 'all' ? formatDate(dateFilter) : '')}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              CSV出力{dateFilter !== 'all' ? '（絞り込み中）' : ''}
            </button>
          </div>

          {activeTab === 'slots' && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">日程</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">時間帯</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">申し込み</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">残席</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">状況</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {slots.map(slot => {
                    const pct = Math.round((slot.registered_count / slot.capacity) * 100)
                    return (
                      <tr key={slot.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatDate(slot.event_date)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{slot.time_slot}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          <div className="flex items-center gap-2">
                            <span className="font-bold">{slot.registered_count}</span>
                            <span className="text-gray-400">/ {slot.capacity}名</span>
                            <div className="w-16 bg-gray-100 rounded-full h-1.5">
                              <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: slot.is_full ? '#ef4444' : '#06C755' }} />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm font-bold" style={{ color: slot.remaining === 0 ? '#ef4444' : slot.remaining <= 2 ? '#f59e0b' : '#06C755' }}>{slot.remaining}席</td>
                        <td className="px-4 py-3">
                          {slot.is_full
                            ? <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-600 font-medium">満席</span>
                            : slot.remaining <= 2
                            ? <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-600 font-medium">残りわずか</span>
                            : <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-600 font-medium">受付中</span>}
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => handleDeleteSlot(slot.id, slot.event_date)}
                            className="px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                            削除
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'list' && (
            <div className="space-y-4">
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">手動で申し込みを追加</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <input type="text" placeholder="お名前" value={addName} onChange={e => setAddName(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500" />
                  <select value={addSlotId} onChange={e => setAddSlotId(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500">
                    <option value="">日程を選択</option>
                    {slots.filter(s => !s.is_full).map(s => (
                      <option key={s.id} value={s.id}>{formatDate(s.event_date)} {s.time_slot}（残{s.remaining}席）</option>
                    ))}
                  </select>
                  <select value={addType} onChange={e => setAddType(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500">
                    <option value="general">一般生</option>
                    <option value="coupon">回数券利用</option>
                    <option value="school">スクール生</option>
                  </select>
                  <button onClick={handleAddRegistration} disabled={addLoading || !addName || !addSlotId}
                    className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-40 hover:opacity-90"
                    style={{ backgroundColor: '#06C755' }}>
                    {addLoading ? '追加中...' : '追加する'}
                  </button>
                </div>
                {addError && <p className="mt-2 text-xs text-red-500">{addError}</p>}
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs text-gray-500 font-medium">日付で絞り込み：</span>
                <button onClick={() => setDateFilter('all')}
                  className={`px-3 py-1.5 text-xs rounded-full font-medium transition-colors ${dateFilter === 'all' ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  style={dateFilter === 'all' ? { backgroundColor: '#06C755' } : {}}>
                  すべて（{registrations.length}件）
                </button>
                {uniqueDates.map(date => {
                  const count = registrations.filter(r => r.eventDate === date).length
                  return (
                    <button key={date} onClick={() => setDateFilter(date)}
                      className={`px-3 py-1.5 text-xs rounded-full font-medium transition-colors ${dateFilter === date ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      style={dateFilter === date ? { backgroundColor: '#06C755' } : {}}>
                      {formatDate(date)}（{count}件）
                    </button>
                  )
                })}
              </div>

              <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
                {filteredRegistrations.length === 0 ? (
                  <div className="p-8 text-center text-gray-400">申し込みがありません</div>
                ) : (
                  <table className="w-full min-w-[600px]">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">名前</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">種別</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">日程</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">時間帯</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">人数</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">申し込み日時</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredRegistrations.map(r => (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{r.displayName}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                              r.participantType === 'general' ? 'bg-blue-100 text-blue-600' :
                              r.participantType === 'coupon' ? 'bg-pink-100 text-pink-600' :
                              'bg-purple-100 text-purple-600'
                            }`}>
                              {r.participantType === 'general' ? '一般生' : r.participantType === 'coupon' ? '回数券利用' : 'スクール生'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">{formatDate(r.eventDate)}</td>
                          <td className="px-4 py-3 text-sm text-gray-700">{r.timeSlot}</td>
                          <td className="px-4 py-3 text-sm text-gray-700">{r.participantCount ?? 1}名</td>
                          <td className="px-4 py-3 text-xs text-gray-400">{new Date(r.createdAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                          <td className="px-4 py-3">
                            <button onClick={() => handleCancel(r.id, r.displayName)}
                              className="px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                              キャンセル
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {activeTab === 'add-slot' && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">新しい日程を追加</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">日付</label>
                  <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">時間帯（例: Lv.1 10:00-11:30）</label>
                  <input type="text" placeholder="Lv.1 10:00-11:30" value={newTimeSlot} onChange={e => setNewTimeSlot(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">定員</label>
                  <input type="number" min="1" value={newCapacity} onChange={e => setNewCapacity(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500" />
                </div>
              </div>
              <button onClick={handleAddSlot} disabled={slotLoading || !newDate || !newTimeSlot || !newCapacity}
                className="px-6 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-40 hover:opacity-90"
                style={{ backgroundColor: '#06C755' }}>
                {slotLoading ? '追加中...' : '日程を追加する'}
              </button>
            </div>
          )}
        </>
      )}

      {selectedEvent && detailLoading && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">読み込み中...</div>
      )}
    </div>
  )
}

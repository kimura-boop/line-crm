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

function exportCsv(registrations: Registration[], eventTitle: string) {
  const headers = ['名前', '種別', '日程', '時間帯', 'ステータス', '申し込み日時']
  const rows = registrations.map(r => [
    r.displayName,
    r.participantType === 'external' ? '外部生' : 'スクール生',
    r.eventDate,
    r.timeSlot,
    r.status,
    new Date(r.createdAt).toLocaleString('ja-JP'),
  ])
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${eventTitle}_申し込み一覧_${new Date().toISOString().slice(0, 10)}.csv`
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
  const [activeTab, setActiveTab] = useState<'slots' | 'list'>('slots')

  useEffect(() => {
    fetchApi<Event[]>('/api/events')
      .then(data => { if (Array.isArray(data)) setEvents(data) })
      .finally(() => setLoading(false))
  }, [])

  const loadEventDetail = useCallback(async (event: Event) => {
    setSelectedEvent(event)
    setDetailLoading(true)
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

  // 日程別集計
  const slotStats = slots.map(slot => {
    const count = registrations.filter(r => r.eventDate === slot.event_date && r.timeSlot === slot.time_slot).length
    return { ...slot, registeredCount: count }
  })

  const totalRegistrations = registrations.length
  const recentCount = registrations.filter(r => {
    return (new Date().getTime() - new Date(r.createdAt).getTime()) < 7 * 24 * 60 * 60 * 1000
  }).length

  return (
    <div>
      <Header title="申し込み管理" description="イベント申し込みの一覧・残席確認" />

      {/* イベント選択 */}
      <div className="mb-6">
        <div className="flex flex-wrap gap-2">
          {loading ? (
            <div className="text-sm text-gray-400">読み込み中...</div>
          ) : events.length === 0 ? (
            <div className="text-sm text-gray-400">イベントがありません</div>
          ) : (
            events.map(event => (
              <button
                key={event.id}
                onClick={() => loadEventDetail(event)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedEvent?.id === event.id ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                style={selectedEvent?.id === event.id ? { backgroundColor: '#06C755' } : {}}
              >
                {event.title}
                {!event.isActive && <span className="ml-2 text-xs opacity-60">（終了）</span>}
              </button>
            ))
          )}
        </div>
      </div>

      {selectedEvent && !detailLoading && (
        <>
          {/* サマリーカード */}
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

          {/* タブ + CSV */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              <button onClick={() => setActiveTab('slots')} className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${activeTab === 'slots' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>日程別残席</button>
              <button onClick={() => setActiveTab('list')} className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${activeTab === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>申し込み一覧</button>
            </div>
            <button
              onClick={() => exportCsv(registrations, selectedEvent.title)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90"
              style={{ backgroundColor: '#06C755' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              CSV出力
            </button>
          </div>

          {/* 日程別残席タブ */}
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {slotStats.map(slot => {
                    const d = new Date(slot.event_date + 'T00:00:00+09:00')
                    const DAYS = ['日','月','火','水','木','金','土']
                    const dateStr = `${d.getMonth()+1}月${d.getDate()}日（${DAYS[d.getDay()]}）`
                    const pct = Math.round((slot.registered_count / slot.capacity) * 100)
                    return (
                      <tr key={slot.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{dateStr}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{slot.time_slot}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          <div className="flex items-center gap-2">
                            <span className="font-bold">{slot.registered_count}</span>
                            <span className="text-gray-400">/ {slot.capacity}名</span>
                            <div className="w-20 bg-gray-100 rounded-full h-1.5">
                              <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: slot.is_full ? '#ef4444' : '#06C755' }} />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm font-bold" style={{ color: slot.remaining === 0 ? '#ef4444' : slot.remaining <= 2 ? '#f59e0b' : '#06C755' }}>
                          {slot.remaining}席
                        </td>
                        <td className="px-4 py-3">
                          {slot.is_full
                            ? <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-600 font-medium">満席</span>
                            : slot.remaining <= 2
                            ? <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-600 font-medium">残りわずか</span>
                            : <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-600 font-medium">受付中</span>
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 申し込み一覧タブ */}
          {activeTab === 'list' && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
              {registrations.length === 0 ? (
                <div className="p-8 text-center text-gray-400">申し込みがありません</div>
              ) : (
                <table className="w-full min-w-[600px]">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">名前</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">種別</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">日程</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">時間帯</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">申し込み日時</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {registrations.map(r => {
                      const d = new Date(r.eventDate + 'T00:00:00+09:00')
                      const DAYS = ['日','月','火','水','木','金','土']
                      const dateStr = `${d.getMonth()+1}月${d.getDate()}日（${DAYS[d.getDay()]}）`
                      return (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{r.displayName}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 text-xs rounded-full font-medium ${r.participantType === 'external' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}>
                              {r.participantType === 'external' ? '外部生' : 'スクール生'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">{dateStr}</td>
                          <td className="px-4 py-3 text-sm text-gray-700">{r.timeSlot}</td>
                          <td className="px-4 py-3 text-xs text-gray-400">
                            {new Date(r.createdAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
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

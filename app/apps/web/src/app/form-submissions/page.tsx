'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'

interface Form {
  id: string
  name: string
  submitCount?: number
}

interface Submission {
  id: string
  formId: string
  friendId: string
  friendName?: string
  data: Record<string, unknown>
  createdAt: string
}

const PAGE_SIZE = 20

function exportCsv(submissions: Submission[], fieldKeys: string[], fieldLabels: Record<string, string>, formName: string) {
  const headers = ['名前', '日時', ...fieldKeys.map(k => fieldLabels[k] || k)]
  const rows = submissions.map(sub => [
    sub.friendName || '不明',
    new Date(sub.createdAt).toLocaleString('ja-JP'),
    ...fieldKeys.map(k => {
      const v = sub.data[k]
      if (Array.isArray(v)) return v.join('/')
      if (v !== null && v !== undefined && v !== '') return String(v)
      return ''
    }),
  ])
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const bom = '\uFEFF'
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${formName}_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function buildDateStats(submissions: Submission[], fieldKeys: string[]): { label: string; count: number }[] {
  const dateKey = fieldKeys.find(k => /日程|日付|date|schedule|day/i.test(k)) || fieldKeys[0]
  if (!dateKey) return []
  const map: Record<string, number> = {}
  for (const sub of submissions) {
    const val = sub.data[dateKey]
    const values = Array.isArray(val) ? val : [val]
    for (const v of values) {
      if (v !== null && v !== undefined && v !== '') {
        const label = String(v)
        map[label] = (map[label] || 0) + 1
      }
    }
  }
  return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => ({ label, count }))
}

export default function FormSubmissionsPage() {
  const { selectedAccountId } = useAccount()
  const [forms, setForms] = useState<Form[]>([])
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null)
  const [selectedFormName, setSelectedFormName] = useState<string>('')
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [subLoading, setSubLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState<'list' | 'stats'>('list')

  const loadForms = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: Form[] }>('/api/forms')
      if (res.success) setForms(res.data)
    } catch { /* silent */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadForms() }, [loadForms])

  const loadSubmissions = useCallback(async (formId: string) => {
    setSubLoading(true)
    setPage(1)
    try {
      const formRes = await fetchApi<{ success: boolean; data: { fields: Array<{ name: string; label: string }> } }>(`/api/forms/${formId}`)
      const res = await fetchApi<{ success: boolean; data: (Submission & { friendName?: string })[] }>(`/api/forms/${formId}/submissions`)
      setSelectedFormId((current) => {
        if (current !== formId) return current
        if (formRes.success && formRes.data.fields) {
          const labels: Record<string, string> = {}
          const fields = typeof formRes.data.fields === 'string' ? JSON.parse(formRes.data.fields) : formRes.data.fields
          for (const f of fields) labels[f.name] = f.label
          setFieldLabels(labels)
        }
        if (res.success) {
          setSubmissions(res.data.map((s) => ({
            ...s,
            data: typeof s.data === 'string' ? JSON.parse(s.data) : s.data,
            friendName: s.friendName || '不明',
          })))
        }
        return current
      })
    } catch { /* silent */ }
    setSelectedFormId((current) => {
      if (current === formId) setSubLoading(false)
      return current
    })
  }, [selectedAccountId])

  const handleSelectForm = (form: Form) => {
    setSelectedFormId(form.id)
    setSelectedFormName(form.name)
    loadSubmissions(form.id)
  }

  const totalPages = Math.ceil(submissions.length / PAGE_SIZE)
  const paged = submissions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const fieldKeys = submissions.length > 0 ? [...new Set(submissions.flatMap(s => Object.keys(s.data)))] : []
  const dateStats = buildDateStats(submissions, fieldKeys)

  return (
    <div>
      <Header title="フォーム回答" description="フォーム送信データの一覧・集計" />

      <div className="mb-6">
        <div className="flex flex-wrap gap-2">
          {loading ? (
            <div className="text-sm text-gray-400">読み込み中...</div>
          ) : (
            forms.map((form) => (
              <button
                key={form.id}
                onClick={() => handleSelectForm(form)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selectedFormId === form.id ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                style={selectedFormId === form.id ? { backgroundColor: '#06C755' } : {}}
              >
                {form.name}
              </button>
            ))
          )}
        </div>
      </div>

      {selectedFormId && !subLoading && submissions.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs text-gray-400 mb-1">総申し込み数</p>
              <p className="text-2xl font-bold text-gray-900">{submissions.length}<span className="text-sm font-normal text-gray-400 ml-1">件</span></p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs text-gray-400 mb-1">直近7日間</p>
              <p className="text-2xl font-bold text-gray-900">
                {submissions.filter(s => (new Date().getTime() - new Date(s.createdAt).getTime()) < 7 * 24 * 60 * 60 * 1000).length}
                <span className="text-sm font-normal text-gray-400 ml-1">件</span>
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs text-gray-400 mb-1">日程パターン数</p>
              <p className="text-2xl font-bold text-gray-900">{dateStats.length}<span className="text-sm font-normal text-gray-400 ml-1">種</span></p>
            </div>
          </div>

          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              <button onClick={() => setActiveTab('list')} className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${activeTab === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>一覧</button>
              <button onClick={() => setActiveTab('stats')} className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${activeTab === 'stats' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>日程別集計</button>
            </div>
            <button
              onClick={() => exportCsv(submissions, fieldKeys, fieldLabels, selectedFormName)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90"
              style={{ backgroundColor: '#06C755' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              CSV出力
            </button>
          </div>

          {activeTab === 'list' && (
            <>
              <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
                <table className="w-full min-w-[800px]">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">名前</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">日時</th>
                      {fieldKeys.map((key) => (
                        <th key={key} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">{fieldLabels[key] || key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paged.map((sub) => (
                      <tr key={sub.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">{sub.friendName}</td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                          {new Date(sub.createdAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        {fieldKeys.map((key) => (
                          <td key={key} className="px-4 py-3 text-sm text-gray-700 max-w-[200px] truncate">
                            {Array.isArray(sub.data[key]) ? (sub.data[key] as string[]).join(', ') : (sub.data[key] !== null && sub.data[key] !== undefined && sub.data[key] !== '') ? String(sub.data[key]) : '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-gray-400">{(page - 1) * PAGE_SIZE + 1}〜{Math.min(page * PAGE_SIZE, submissions.length)} 件 / 全{submissions.length}件</p>
                  <div className="flex gap-2">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50">前へ</button>
                    <span className="px-3 py-1.5 text-sm text-gray-500">{page} / {totalPages}</span>
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50">次へ</button>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'stats' && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              {dateStats.length === 0 ? (
                <div className="p-8 text-center text-gray-400">日程データが見つかりません</div>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">日程</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">申し込み数</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">割合</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {dateStats.map(({ label, count }) => {
                      const pct = Math.round((count / submissions.length) * 100)
                      return (
                        <tr key={label} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{label}</td>
                          <td className="px-4 py-3 text-sm text-gray-700"><span className="font-bold">{count}</span><span className="text-gray-400 ml-1">件</span></td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="flex-1 bg-gray-100 rounded-full h-2">
                                <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: '#06C755' }} />
                              </div>
                              <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
                            </div>
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

      {selectedFormId && subLoading && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">読み込み中...</div>
      )}
      {selectedFormId && !subLoading && submissions.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">回答がありません</div>
      )}
    </div>
  )
}

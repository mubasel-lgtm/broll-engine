'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, Clip } from '@/lib/supabase'

const DR_FUNCTIONS = ['ALL', 'PROBLEM', 'MECHANISM', 'PRODUCT', 'OUTCOME', 'LIFESTYLE', 'HOOK', 'SOCIAL_PROOF', 'CTA', 'OTHER']

type Brand = { id: number; name: string }

export default function ClipsPage() {
  const [clips, setClips] = useState<Clip[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [search, setSearch] = useState('')
  const [brandFilter, setBrandFilter] = useState('ALL')
  const [drFilter, setDrFilter] = useState('ALL')
  const [productFilter, setProductFilter] = useState<'ALL' | 'yes' | 'no'>('ALL')
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [previewClip, setPreviewClip] = useState<Clip | null>(null)

  useEffect(() => {
    supabase.from('brands').select('*').order('name').then(({ data }) => setBrands(data || []))
  }, [])

  useEffect(() => {
    loadClips()
  }, [drFilter, productFilter, brandFilter])

  async function loadClips() {
    setLoading(true)
    let query = supabase
      .from('clips')
      .select('*', { count: 'exact' })
      .order('brand')
      .order('dr_function')
      .limit(300)

    if (drFilter !== 'ALL') query = query.eq('dr_function', drFilter)
    if (productFilter === 'yes') query = query.eq('has_product', true)
    if (productFilter === 'no') query = query.eq('has_product', false)
    if (brandFilter !== 'ALL') query = query.eq('brand', brandFilter)

    const { data, count } = await query
    setClips(data || [])
    setTotal(count || 0)
    setLoading(false)
  }

  const filtered = clips.filter(c => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      c.description?.toLowerCase().includes(s) ||
      c.filename?.toLowerCase().includes(s) ||
      c.tags?.some((t: string) => t.toLowerCase().includes(s)) ||
      c.mood?.toLowerCase().includes(s) ||
      c.setting?.toLowerCase().includes(s)
    )
  })

  // Group by brand
  const grouped = filtered.reduce((acc, clip) => {
    const brand = clip.brand || 'Uncategorized'
    if (!acc[brand]) acc[brand] = []
    acc[brand].push(clip)
    return acc
  }, {} as Record<string, Clip[]>)

  function getDriveStreamUrl(driveUrl: string) {
    if (!driveUrl) return null
    return `/api/proxy-video?url=${encodeURIComponent(driveUrl)}`
  }

  function getDriveEmbedUrl(driveUrl: string) {
    const match = driveUrl?.match(/\/d\/([^/]+)/)
    if (!match) return null
    return `https://drive.google.com/file/d/${match[1]}/preview`
  }

  const drBadgeColor = (fn: string) => {
    switch (fn) {
      case 'PROBLEM': return 'bg-red-500/10 text-red-600 border-red-500/20'
      case 'MECHANISM': return 'bg-blue-500/10 text-blue-400 border-blue-500/20'
      case 'PRODUCT': return 'bg-purple-500/10 text-purple-400 border-purple-500/20'
      case 'OUTCOME': return 'bg-emerald-50 text-emerald-600 border-emerald-500/20'
      case 'LIFESTYLE': return 'bg-amber-500/10 text-amber-600 border-amber-500/20'
      case 'HOOK': return 'bg-pink-500/10 text-pink-400 border-pink-500/20'
      case 'SOCIAL_PROOF': return 'bg-teal-500/10 text-teal-400 border-teal-500/20'
      case 'CTA': return 'bg-orange-500/10 text-orange-400 border-orange-500/20'
      default: return 'bg-gray-50 text-gray-500 border-gray-200'
    }
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Navigation */}
      <nav className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-8 h-16 flex items-center gap-10">
          <Link href="/" className="font-semibold text-[15px] tracking-tight text-gray-900">
            B-Roll Engine
          </Link>
          <div className="flex items-center gap-1">
            <Link href="/clips" className="font-medium px-4 py-2 text-[13px] text-gray-900 rounded-lg bg-gray-50 transition-all duration-200">
              Clips
            </Link>
            <Link href="/brands" className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-50 transition-all duration-200">
              Brands
            </Link>
            <Link href="/projects" className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-50 transition-all duration-200">
              Projects
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-8 py-10">
        {/* Header */}
        <div className="flex items-end justify-between mb-10">
          <div>
            <h1 className="text-[32px] font-bold tracking-tight mb-2">Clip Library</h1>
            <p className="text-[15px] text-gray-400">
              {total} clips indexed across all brands
            </p>
          </div>
          <a
            href="https://drive.google.com/drive/folders/19B5_90zVZJIirJGPpklArzp2C-JzSugC"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-[13px] font-medium rounded-xl hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload to Drive
          </a>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-10 flex-wrap items-center">
          <div className="relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search clips..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="premium-input pl-10 w-72"
            />
          </div>
          <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)}
            className="premium-select">
            <option value="ALL">All Brands</option>
            {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
          <select value={drFilter} onChange={e => setDrFilter(e.target.value)}
            className="premium-select">
            {DR_FUNCTIONS.map(f => <option key={f} value={f}>{f === 'ALL' ? 'All Functions' : f}</option>)}
          </select>
          <select value={productFilter} onChange={e => setProductFilter(e.target.value as 'ALL' | 'yes' | 'no')}
            className="premium-select">
            <option value="ALL">Product: All</option>
            <option value="yes">Has Product</option>
            <option value="no">No Product</option>
          </select>
          {(brandFilter !== 'ALL' || drFilter !== 'ALL' || productFilter !== 'ALL' || search) && (
            <button
              onClick={() => { setBrandFilter('ALL'); setDrFilter('ALL'); setProductFilter('ALL'); setSearch('') }}
              className="text-[12px] text-gray-400 hover:text-gray-500 transition-colors px-3 py-2"
            >
              Clear filters
            </button>
          )}
        </div>

        {loading ? (
          /* Skeleton loading state */
          <div className="space-y-10">
            {[1, 2].map(g => (
              <div key={g}>
                <div className="skeleton h-6 w-40 mb-5" />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="rounded-2xl overflow-hidden">
                      <div className="skeleton aspect-video" />
                      <div className="p-4 space-y-3">
                        <div className="skeleton h-4 w-full" />
                        <div className="skeleton h-4 w-2/3" />
                        <div className="flex gap-2">
                          <div className="skeleton h-5 w-16 rounded-full" />
                          <div className="skeleton h-5 w-12 rounded-full" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <p className="text-[13px] text-gray-400 mb-6">{filtered.length} clips</p>
            <div className="space-y-12">
              {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([brand, brandClips]) => (
                <div key={brand} className="animate-fade-in">
                  <div className="flex items-center gap-3 mb-5">
                    <h2 className="text-[18px] font-semibold tracking-tight">{brand}</h2>
                    <span className="pill bg-gray-50 text-gray-400 border border-gray-200">{brandClips.length}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                    {brandClips.map(clip => (
                      <div key={clip.id}
                        className="glass-card rounded-2xl overflow-hidden cursor-pointer group"
                        onClick={() => setPreviewClip(clip)}>
                        <div className="aspect-video bg-gray-100 relative overflow-hidden">
                          {clip.drive_url ? (
                            <img src={getDriveStreamUrl(clip.drive_url)!} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                          ) : clip.thumbnail_url ? (
                            <img src={clip.thumbnail_url} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-300 text-[12px]">No preview</div>
                          )}
                          {/* Gradient overlay on hover */}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                          <span className={`absolute top-3 right-3 pill border ${drBadgeColor(clip.dr_function)}`}>
                            {clip.dr_function}
                          </span>
                          {clip.filetype === 'video' && (
                            <div className="absolute bottom-3 left-3 w-7 h-7 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="white"><polygon points="2,0 10,5 2,10" /></svg>
                            </div>
                          )}
                        </div>
                        <div className="p-4">
                          <p className="text-[13px] text-[#d4d4d8] line-clamp-2 mb-3 leading-relaxed">{clip.description}</p>
                          <div className="flex flex-wrap gap-1.5 mb-3">
                            {clip.tags?.slice(0, 4).map((tag: string, i: number) => (
                              <span key={i} className="pill bg-gray-50 text-gray-500 text-[11px]">{tag}</span>
                            ))}
                          </div>
                          <div className="flex justify-between items-center text-[12px]">
                            <span className="text-gray-400">{clip.mood} · {clip.setting}</span>
                            <span className={`pill text-[11px] ${
                              clip.reusability === 'high' ? 'bg-emerald-50 text-emerald-600' :
                              clip.reusability === 'medium' ? 'bg-amber-500/10 text-amber-600' :
                              'bg-red-500/10 text-red-600'
                            }`}>{clip.reusability}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {/* Video Preview Modal */}
      {previewClip && (
        <div className="fixed inset-0 modal-backdrop z-50 flex items-center justify-center p-8" onClick={() => setPreviewClip(null)}>
          <div className="bg-[#18181b] border border-gray-300 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="aspect-video bg-gray-50 rounded-t-2xl overflow-hidden">
              {previewClip.drive_url && previewClip.filename?.match(/\.(mp4|mov|webm)$/i) ? (
                <video key={previewClip.id} src={getDriveStreamUrl(previewClip.drive_url)!} controls autoPlay className="w-full h-full object-contain" playsInline />
              ) : previewClip.drive_url && previewClip.filename?.match(/\.(jpg|jpeg|png|webp)$/i) ? (
                <img src={getDriveStreamUrl(previewClip.drive_url)!} alt="" className="w-full h-full object-contain" />
              ) : previewClip.thumbnail_url ? (
                <img src={previewClip.thumbnail_url} alt="" className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-300">No preview available</div>
              )}
            </div>
            <div className="p-8">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-[17px] font-semibold tracking-tight">{previewClip.filename}</h3>
                <button onClick={() => setPreviewClip(null)} className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-all">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <p className="text-[14px] text-gray-500 leading-relaxed mb-6">{previewClip.description}</p>
              <div className="grid grid-cols-2 gap-4 text-[13px]">
                <div className="flex justify-between py-2.5 border-b border-white/[0.04]">
                  <span className="text-gray-400">DR Function</span>
                  <span className={`pill border ${drBadgeColor(previewClip.dr_function)}`}>{previewClip.dr_function}</span>
                </div>
                <div className="flex justify-between py-2.5 border-b border-white/[0.04]">
                  <span className="text-gray-400">Mood</span>
                  <span className="text-[#d4d4d8]">{previewClip.mood}</span>
                </div>
                <div className="flex justify-between py-2.5 border-b border-white/[0.04]">
                  <span className="text-gray-400">Setting</span>
                  <span className="text-[#d4d4d8]">{previewClip.setting}</span>
                </div>
                <div className="flex justify-between py-2.5 border-b border-white/[0.04]">
                  <span className="text-gray-400">Camera</span>
                  <span className="text-[#d4d4d8]">{previewClip.camera_movement}</span>
                </div>
                <div className="flex justify-between py-2.5 border-b border-white/[0.04]">
                  <span className="text-gray-400">Brand</span>
                  <span className="text-[#d4d4d8]">{previewClip.brand}</span>
                </div>
                <div className="flex justify-between py-2.5 border-b border-white/[0.04]">
                  <span className="text-gray-400">Reusability</span>
                  <span className={`pill text-[11px] ${
                    previewClip.reusability === 'high' ? 'bg-emerald-50 text-emerald-600' :
                    previewClip.reusability === 'medium' ? 'bg-amber-500/10 text-amber-600' :
                    'bg-red-500/10 text-red-600'
                  }`}>{previewClip.reusability}</span>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                {previewClip.tags?.map((tag: string, i: number) => (
                  <span key={i} className="pill bg-gray-50 text-gray-500 border border-gray-200 text-[12px]">{tag}</span>
                ))}
              </div>
              {previewClip.drive_url && (
                <a href={previewClip.drive_url} target="_blank" rel="noopener noreferrer"
                  className="mt-6 inline-flex items-center gap-2 text-[13px] text-indigo-600 hover:text-indigo-600 font-medium transition-colors">
                  <span>Open in Google Drive</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

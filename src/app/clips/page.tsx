'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Brand = { id: number; name: string }
type Product = { id: number; brand_id: number; name: string; image_url: string | null; physical_notes: string }

const DRIVE_BROLL_FOLDER = 'https://drive.google.com/drive/folders/19B5_90zVZJIirJGPpklArzp2C-JzSugC'

export default function UploadPage() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [clipCounts, setClipCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const { data: b } = await supabase.from('brands').select('*').order('name')
    const { data: p } = await supabase.from('products').select('*').order('name')
    setBrands(b || [])
    setProducts(p || [])

    // Get clip counts per brand
    const { data: clips } = await supabase.from('clips').select('brand')
    if (clips) {
      const counts: Record<string, number> = {}
      clips.forEach(c => { counts[c.brand] = (counts[c.brand] || 0) + 1 })
      setClipCounts(counts)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <nav className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-8 h-16 flex items-center gap-10">
          <Link href="/" className="font-semibold text-[15px] tracking-tight text-gray-900">
            B-Roll Engine
          </Link>
          <div className="flex items-center gap-1">
            <Link href="/clips" className="font-medium px-4 py-2 text-[13px] text-gray-900 rounded-lg bg-gray-50 transition-all duration-200">
              Upload
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
        <div className="flex items-end justify-between mb-10">
          <div>
            <h1 className="text-[32px] font-bold tracking-tight mb-2">Upload B-Roll</h1>
            <p className="text-[15px] text-gray-400">
              Upload new clips per brand. Files are auto-categorized by AI.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                <div className="skeleton h-6 w-40 mb-4" />
                <div className="skeleton h-20 w-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {brands.map(brand => {
              const brandProducts = products.filter(p => p.brand_id === brand.id)
              const count = clipCounts[brand.name] || 0

              return (
                <div key={brand.id} className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                  {/* Brand Header */}
                  <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h2 className="text-[17px] font-semibold tracking-tight">{brand.name}</h2>
                      <span className="text-xs bg-gray-50 text-gray-400 px-2.5 py-1 rounded-lg border border-gray-200">{count} clips</span>
                    </div>
                    <a
                      href={DRIVE_BROLL_FOLDER}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      Open Drive Folder
                    </a>
                  </div>

                  {/* Products */}
                  <div className="p-6">
                    {brandProducts.length === 0 ? (
                      <p className="text-sm text-gray-400">No products yet. <Link href="/brands" className="text-indigo-600 hover:text-indigo-700">Add in Brands</Link></p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {brandProducts.map(product => (
                          <div key={product.id} className="border border-gray-200 rounded-xl p-4 hover:border-gray-300 transition-colors">
                            <div className="flex items-center gap-3 mb-3">
                              {product.image_url ? (
                                <img src={product.image_url} alt="" className="w-12 h-12 object-contain rounded-lg border border-gray-100 bg-gray-50" />
                              ) : (
                                <div className="w-12 h-12 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center text-gray-300 text-xs">?</div>
                              )}
                              <div>
                                <h3 className="text-sm font-semibold text-gray-900">{product.name}</h3>
                                {product.physical_notes && (
                                  <p className="text-xs text-gray-400">{product.physical_notes}</p>
                                )}
                              </div>
                            </div>

                            <a
                              href={DRIVE_BROLL_FOLDER}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                              Upload B-Roll
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Info */}
        <div className="mt-10 bg-gray-50 border border-gray-200 rounded-2xl p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">How it works</h3>
          <ol className="text-sm text-gray-500 space-y-1.5 list-decimal list-inside">
            <li>Click &ldquo;Upload B-Roll&rdquo; to open the Google Drive B-Roll folder</li>
            <li>Drag and drop your video files into the folder</li>
            <li>The system automatically detects new files and categorizes them with AI</li>
            <li>Categorized clips appear in your projects when matching scripts</li>
          </ol>
        </div>
      </main>
    </div>
  )
}

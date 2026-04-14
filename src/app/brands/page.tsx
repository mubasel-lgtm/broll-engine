'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Brand = { id: number; name: string }
type Product = { id: number; brand_id: number; name: string; image_url: string | null; physical_notes: string }

export default function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [newBrand, setNewBrand] = useState('')
  const [newProduct, setNewProduct] = useState<Record<number, { name: string; physical_notes: string }>>({})

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const { data: b } = await supabase.from('brands').select('*').order('name')
    const { data: p } = await supabase.from('products').select('*').order('name')
    setBrands(b || [])
    setProducts(p || [])
  }

  async function addBrand() {
    if (!newBrand.trim()) return
    await supabase.from('brands').insert({ name: newBrand.trim() })
    setNewBrand('')
    loadData()
  }

  async function addProduct(brandId: number) {
    const p = newProduct[brandId]
    if (!p?.name?.trim()) return
    const { data } = await supabase.from('products').insert({
      brand_id: brandId,
      name: p.name.trim(),
      physical_notes: p.physical_notes || ''
    }).select().single()
    setNewProduct(prev => ({ ...prev, [brandId]: { name: '', physical_notes: '' } }))
    loadData()
  }

  async function uploadProductImage(productId: number, file: File) {
    const formData = new FormData()
    formData.append('image', file)
    formData.append('product_id', String(productId))
    const resp = await fetch('/api/upload-product-image', { method: 'POST', body: formData })
    const data = await resp.json()
    if (data.success) { loadData() }
  }

  return (
    <div className="min-h-screen bg-[#fafafa] text-gray-900">
      {/* Navigation */}
      <nav className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-8 h-16 flex items-center gap-10">
          <Link href="/" className="font-semibold text-[15px] tracking-tight text-gray-900">
            B-Roll Engine
          </Link>
          <div className="flex items-center gap-1">
            <Link href="/clips" className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-50 transition-all duration-200">
              Upload
            </Link>
            <Link href="/brands" className="nav-active px-4 py-2 text-[13px] text-indigo-600 rounded-lg bg-indigo-50 transition-all duration-200">
              Brands
            </Link>
            <Link href="/projects" className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-50 transition-all duration-200">
              Projects
            </Link>
            <Link href="/overlays" className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-50 transition-all duration-200">
              Overlays
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-8 py-10">
        {/* Header */}
        <div className="flex items-end justify-between mb-10">
          <div>
            <h1 className="text-[32px] font-bold tracking-tight mb-2 text-gray-900">Brands & Products</h1>
            <p className="text-[15px] text-gray-500">
              Manage your brands and their product catalog
            </p>
          </div>
          <div className="flex gap-3">
            <input
              value={newBrand}
              onChange={e => setNewBrand(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addBrand()}
              placeholder="New brand name..."
              className="premium-input w-52"
            />
            <button onClick={addBrand} className="btn-primary whitespace-nowrap flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Brand
            </button>
          </div>
        </div>

        {/* Brand cards */}
        <div className="space-y-6 stagger-children">
          {brands.map(brand => {
            const brandProducts = products.filter(p => p.brand_id === brand.id)
            const np = newProduct[brand.id] || { name: '', physical_notes: '' }

            return (
              <div key={brand.id} className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm hover:transform-none">
                {/* Brand header */}
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                    <span className="text-[14px] font-bold text-indigo-600">{brand.name.charAt(0)}</span>
                  </div>
                  <h2 className="text-[17px] font-semibold tracking-tight text-gray-900">{brand.name}</h2>
                  <span className="pill bg-gray-100 text-gray-500 border border-gray-200 text-[11px]">
                    {brandProducts.length} product{brandProducts.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Existing products */}
                <div className="space-y-3 mb-5">
                  {brandProducts.map(prod => (
                    <div key={prod.id} className="flex items-center gap-4 bg-gray-50 border border-gray-100 rounded-xl p-4 hover:bg-gray-100/60 transition-colors">
                      {/* Product image */}
                      <div className="w-14 h-14 bg-white border border-gray-200 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center">
                        {prod.image_url ? (
                          <img src={prod.image_url} alt="" className="w-full h-full object-contain" />
                        ) : (
                          <label className="cursor-pointer text-center w-full h-full flex items-center justify-center hover:bg-gray-50 transition-colors">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-gray-300">
                              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                            </svg>
                            <input type="file" accept="image/*" className="hidden"
                              onChange={e => { const f = e.target.files?.[0]; if (f) uploadProductImage(prod.id, f) }} />
                          </label>
                        )}
                      </div>

                      {/* Product info */}
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-medium text-gray-900">{prod.name}</div>
                        <div className="text-[12px] text-gray-400 mt-0.5">{prod.physical_notes || 'No mounting info'}</div>
                      </div>

                      {/* Upload/replace image */}
                      {prod.image_url && (
                        <label className="cursor-pointer text-[12px] text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1.5">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                          </svg>
                          Replace
                          <input type="file" accept="image/*" className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; if (f) uploadProductImage(prod.id, f) }} />
                        </label>
                      )}
                    </div>
                  ))}

                  {brandProducts.length === 0 && (
                    <div className="py-8 text-center">
                      <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center mx-auto mb-3">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-gray-300">
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                        </svg>
                      </div>
                      <p className="text-[13px] text-gray-400">No products yet</p>
                    </div>
                  )}
                </div>

                {/* Add product form */}
                <div className="flex gap-3 items-center pt-4 border-t border-gray-100">
                  <input
                    value={np.name}
                    onChange={e => setNewProduct(prev => ({ ...prev, [brand.id]: { ...np, name: e.target.value } }))}
                    placeholder="Product name"
                    className="premium-input flex-1"
                  />
                  <input
                    value={np.physical_notes}
                    onChange={e => setNewProduct(prev => ({ ...prev, [brand.id]: { ...np, physical_notes: e.target.value } }))}
                    placeholder="Mounting (e.g. plug-in, stands on table...)"
                    className="premium-input flex-1"
                  />
                  <button onClick={() => addProduct(brand.id)}
                    className="btn-secondary whitespace-nowrap flex items-center gap-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Product
                  </button>
                </div>
              </div>
            )
          })}

          {brands.length === 0 && (
            <div className="text-center py-24">
              <div className="w-14 h-14 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-gray-300">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                </svg>
              </div>
              <p className="text-[15px] text-gray-400 mb-1">No brands yet</p>
              <p className="text-[13px] text-gray-300">Create your first brand using the form above</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

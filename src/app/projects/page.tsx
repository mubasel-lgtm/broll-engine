'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Product = { id: number; name: string; brand_id: number; image_url: string; physical_notes: string }
type Brand = { id: number; name: string }

type ClipMatch = {
  id: number
  filename: string
  description: string
  dr_function: string
  tags: string[]
  mood: string
  setting: string
  thumbnail_url: string
  drive_url: string
  reusability: string
  match_score: number
  has_product: boolean
  has_person: boolean
}

type ScriptLine = {
  line_number: number
  text: string
  text_en?: string
  dr_function: string
  search_tags: string[]
  needs: string
  matches: ClipMatch[]
}

export default function ProjectsPage() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [selectedBrand, setSelectedBrand] = useState<number | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<number | null>(null)
  const [hasAroll, setHasAroll] = useState(false)
  const [arollPreview, setArollPreview] = useState<string | null>(null)
  const [arollBase64, setArollBase64] = useState<string | null>(null)
  const [speakerDesc, setSpeakerDesc] = useState('')
  const [projectName, setProjectName] = useState('')
  const [script, setScript] = useState('')
  const [lines, setLines] = useState<ScriptLine[]>([])
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<'setup' | 'results'>('setup')
  const [selected, setSelected] = useState<Record<number, number | null>>({})
  const [previewClip, setPreviewClip] = useState<ClipMatch | null>(null)
  const [generating, setGenerating] = useState<Record<number, boolean>>({})
  const [generatedImages, setGeneratedImages] = useState<Record<number, string>>({})
  const [generatedStatus, setGeneratedStatus] = useState<Record<number, 'review' | 'accepted' | 'creating_video' | 'video_done' | 'video_failed'>>({})
  const [generatedVideos, setGeneratedVideos] = useState<Record<number, string>>({})
  const [productImageB64, setProductImageB64] = useState<string | null>(null)
  const [history, setHistory] = useState<Array<{id: number; name: string; script: string; status: string; created_at: string; brand_name?: string; product_name?: string}>>([])
  // Map line_number → project_result DB row id (for persisting selections/generations)
  const [resultIds, setResultIds] = useState<Record<number, number>>({})
  // Chat history per line: previous prompts + rejections for iterative generation
  const [chatHistories, setChatHistories] = useState<Record<number, Array<{ prompt: string; rejection: string }>>>({})
  const [lastPrompts, setLastPrompts] = useState<Record<number, string>>({})

  // Rejection feedback state
  const [rejectModal, setRejectModal] = useState<{ lineNumber: number; clipId?: number; scriptLine: string; drFunction: string } | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectNote, setRejectNote] = useState('')
  const [savingReject, setSavingReject] = useState(false)

  type HistoryProject = {id: number; name: string; script: string; status: string; created_at: string; brand_name?: string; product_name?: string}

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const { data: b } = await supabase.from('brands').select('*').order('name')
    const { data: p } = await supabase.from('products').select('*').order('name')
    setBrands(b || [])
    setProducts(p || [])
    // Load project history
    const { data: h } = await supabase.from('projects').select('id, name, script, status, created_at, products(name, brands(name))').order('created_at', { ascending: false }).limit(50)
    if (h) {
      setHistory(h.map((p: Record<string, unknown>) => {
        const prod = p.products as Record<string, unknown> | null
        const brand = prod?.brands as Record<string, unknown> | null
        return { ...p, product_name: prod?.name as string || '', brand_name: brand?.name as string || '' } as HistoryProject
      }))
    }
  }

  // Auto-load product image when product is selected
  useEffect(() => {
    if (!selectedProduct) { setProductImageB64(null); return }
    const prod = products.find(p => p.id === selectedProduct)
    if (!prod?.image_url) { setProductImageB64(null); console.log('No product image URL'); return }
    console.log('Loading product image from:', prod.image_url)
    fetch(prod.image_url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.blob()
      })
      .then(blob => {
        const reader = new FileReader()
        reader.onload = () => {
          const b64 = (reader.result as string).split(',')[1]
          setProductImageB64(b64)
          console.log('Product image loaded:', b64.length, 'chars')
        }
        reader.readAsDataURL(blob)
      })
      .catch(e => { console.error('Failed to load product image:', e); setProductImageB64(null) })
  }, [selectedProduct, products])

  const [enlargedImage, setEnlargedImage] = useState<string | null>(null)

  function handleArollUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      setArollPreview(URL.createObjectURL(file))
      setHasAroll(true)
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        setArollBase64(result.split(',')[1])
      }
      reader.readAsDataURL(file)
    }
  }

  const [currentProjectId, setCurrentProjectId] = useState<number | null>(null)

  function updateResult(lineNumber: number, update: Record<string, unknown>) {
    const resultId = resultIds[lineNumber]
    if (!resultId) return
    fetch('/api/project-results', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: resultId, ...update })
    }).catch(e => console.error('Failed to update result:', e))
  }

  async function analyzeScript() {
    if (!script.trim()) return
    setLoading(true)

    // Save project to Supabase and get the ID
    const prod = products.find(p => p.id === selectedProduct)
    const brand = prod ? brands.find(b => b.id === prod.brand_id) : null
    const { data: proj } = await supabase.from('projects').insert({
      name: projectName || 'Untitled',
      product_id: selectedProduct,
      brand_id: brand?.id || null,
      script,
      speaker_description: speakerDesc,
      status: 'active'
    }).select().single()

    const projectId = proj?.id
    if (projectId) setCurrentProjectId(projectId)

    const resp = await fetch('/api/analyze-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script, product_id: selectedProduct, brand_id: brand?.id || selectedBrand })
    })
    const data = await resp.json()
    if (data.lines) {
      setLines(data.lines)
      setStep('results')

      // Save results to DB for later reopening
      if (projectId) {
        try {
          const saveResp = await fetch('/api/project-results', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project_id: projectId, lines: data.lines })
          })
          const saveData = await saveResp.json()
          if (saveData.result_ids) {
            setResultIds(saveData.result_ids)
          }
        } catch (e) { console.error('Failed to save results:', e) }
      }
    }
    setLoading(false)
  }

  async function loadProject(project: HistoryProject) {
    setLoading(true)
    setCurrentProjectId(project.id)
    setProjectName(project.name)
    setScript(project.script)

    // Find and select the brand/product
    const brandObj = brands.find(b => b.name === project.brand_name)
    if (brandObj) {
      setSelectedBrand(brandObj.id)
      const prodObj = products.find(p => p.brand_id === brandObj.id && p.name === project.product_name)
      if (prodObj) setSelectedProduct(prodObj.id)
    }

    // Load saved results
    const resp = await fetch(`/api/project-results?project_id=${project.id}`)
    const { results } = await resp.json()

    if (results && results.length > 0) {
      // Re-fetch full clip data for matched IDs
      const allClipIds = results.flatMap((r: { matched_clip_ids: number[] }) => r.matched_clip_ids || [])
      const uniqueIds = [...new Set(allClipIds)]

      let clipMap = new Map()
      if (uniqueIds.length > 0) {
        const { data: clips } = await supabase
          .from('clips')
          .select('*')
          .in('id', uniqueIds)
        if (clips) clipMap = new Map(clips.map(c => [c.id, c]))
      }

      // Build resultIds map for live updates
      const rIds: Record<number, number> = {}
      results.forEach((r: { id: number; line_number: number }, idx: number) => { rIds[idx] = r.id })
      setResultIds(rIds)

      const loadedLines: ScriptLine[] = results.map((r: { id: number; line_number: number; script_text: string; dr_function: string; search_tags: string[]; matched_clip_ids: number[]; selected_clip_id: number | null; generated_image_url: string | null; generated_video_url: string | null }) => {
        const matches = (r.matched_clip_ids || [])
          .map((id: number, idx: number) => {
            const clip = clipMap.get(id)
            if (!clip) return null
            return { ...clip, match_score: 10 - idx * 2 }
          })
          .filter(Boolean)

        return {
          line_number: r.line_number,
          text: r.script_text,
          dr_function: r.dr_function,
          search_tags: r.search_tags || [],
          matches,
        }
      })

      setLines(loadedLines)

      // Restore selections and generated content
      const sel: Record<number, number | null> = {}
      const imgs: Record<number, string> = {}
      const vids: Record<number, string> = {}
      const stats: Record<number, 'review' | 'accepted' | 'creating_video' | 'video_done' | 'video_failed'> = {}

      results.forEach((r: { line_number: number; selected_clip_id: number | null; generated_image_url: string | null; generated_video_url: string | null }, idx: number) => {
        if (r.selected_clip_id) sel[idx] = r.selected_clip_id
        if (r.generated_image_url) { imgs[idx] = r.generated_image_url; stats[idx] = 'review' }
        if (r.generated_video_url) { vids[idx] = r.generated_video_url; stats[idx] = 'video_done' }
      })

      setSelected(sel)
      setGeneratedImages(imgs)
      setGeneratedVideos(vids)
      setGeneratedStatus(stats)
      setStep('results')
    } else {
      // No saved results — re-analyze
      setStep('setup')
    }
    setLoading(false)
  }

  function getDriveStreamUrl(driveUrl: string) {
    if (!driveUrl) return null
    return `/api/proxy-video?url=${encodeURIComponent(driveUrl)}`
  }

  function getDriveEmbedUrl(driveUrl: string) {
    const match = driveUrl?.match(/\/d\/([^/]+)/)
    if (!match) return null
    return `https://drive.google.com/file/d/${match[1]}/preview`
  }

  const drColor = (fn: string) => {
    switch (fn) {
      case 'PROBLEM': return 'bg-red-50 text-red-600 border-red-200'
      case 'MECHANISM': return 'bg-blue-50 text-blue-600 border-blue-200'
      case 'PRODUCT': return 'bg-purple-50 text-purple-600 border-purple-200'
      case 'OUTCOME': return 'bg-emerald-50 text-emerald-600 border-emerald-200'
      case 'LIFESTYLE': return 'bg-amber-50 text-amber-600 border-amber-200'
      case 'HOOK': return 'bg-pink-50 text-pink-600 border-pink-200'
      case 'SOCIAL_PROOF': return 'bg-teal-50 text-teal-600 border-teal-200'
      case 'CTA': return 'bg-orange-50 text-orange-600 border-orange-200'
      default: return 'bg-gray-50 text-gray-500 border-gray-200'
    }
  }

  const selectedProd = products.find(p => p.id === selectedProduct)
  const selectedBrandObj = brands.find(b => b.id === selectedBrand)
  const brandProducts = selectedBrand ? products.filter(p => p.brand_id === selectedBrand) : []

  // Auto-select product if brand has only one
  // Reset product when brand changes
  function handleBrandChange(brandId: number) {
    setSelectedBrand(brandId)
    setSelectedProduct(null)
    const prods = products.filter(p => p.brand_id === brandId)
    if (prods.length === 1) setSelectedProduct(prods[0].id)
  }

  async function submitRejection() {
    if (!rejectModal || !rejectReason) return
    setSavingReject(true)
    try {
      const prod = products.find(p => p.id === selectedProduct)
      const brand = prod ? brands.find(b => b.id === prod.brand_id) : null
      await fetch('/api/save-learning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct,
          brand_id: brand?.id || selectedBrand,
          clip_id: rejectModal.clipId || null,
          script_line: rejectModal.scriptLine,
          dr_function: rejectModal.drFunction,
          rejection_reason: rejectReason,
          editor_note: rejectNote || null,
        })
      })
    } catch (e) {
      console.error('Failed to save rejection:', e)
    }
    // Build chat history for this line
    const lineNum = rejectModal.lineNumber
    const scriptLine = rejectModal.scriptLine
    const drFunction = rejectModal.drFunction
    const rejectionText = `${rejectReason}${rejectNote ? `. ${rejectNote}` : ''}`
    const prevPrompt = lastPrompts[lineNum] || ''

    // Add current attempt to chat history
    const history = [...(chatHistories[lineNum] || [])]
    if (prevPrompt) {
      history.push({ prompt: prevPrompt, rejection: rejectionText })
    }
    setChatHistories(prev => ({ ...prev, [lineNum]: history }))

    setGeneratedImages(prev => { const n = { ...prev }; delete n[lineNum]; return n })
    setGeneratedStatus(prev => { const n = { ...prev }; delete n[lineNum]; return n })
    setRejectModal(null)
    setRejectReason('')
    setRejectNote('')
    setSavingReject(false)

    // Auto-regenerate with full chat history
    setGenerating(prev => ({ ...prev, [lineNum]: true }))
    try {
      const resp = await fetch('/api/generate-broll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script_line: scriptLine,
          dr_function: drFunction,
          aroll_image: arollBase64,
          speaker_description: speakerDesc,
          product_image: productImageB64,
          product_physical: selectedProd?.physical_notes,
          rejection_feedback: rejectionText,
          previous_prompt: prevPrompt,
          chat_history: history,
        })
      })
      const data = await resp.json()
      if (data.success) {
        const imgDataUrl = `data:${data.image.mimeType};base64,${data.image.data}`
        setGeneratedImages(prev => ({ ...prev, [lineNum]: imgDataUrl }))
        setGeneratedStatus(prev => ({ ...prev, [lineNum]: 'review' }))
        setLastPrompts(prev => ({ ...prev, [lineNum]: data.prompt_used }))
        updateResult(lineNum, { generated_image_url: imgDataUrl, status: 'review' })
      }
    } catch (e) { console.error('Regeneration failed:', e) }
    setGenerating(prev => ({ ...prev, [lineNum]: false }))
  }

  return (
    <div className="min-h-screen bg-[#fafafa] text-gray-900">
      <nav className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-8 h-16 flex items-center gap-10">
          <Link href="/" className="font-semibold text-[15px] tracking-tight text-gray-900">B-Roll Engine</Link>
          <div className="flex items-center gap-1">
            <Link href="/clips" className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-50 transition-all duration-200">Upload</Link>
            <Link href="/brands" className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-50 transition-all duration-200">Brands</Link>
            <Link href="/projects" className="nav-active px-4 py-2 text-[13px] text-indigo-600 rounded-lg bg-indigo-50 transition-all duration-200">Projects</Link>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-8 py-10">

        {step === 'setup' && (
          <>
            <h1 className="text-[32px] font-bold tracking-tight mb-8 text-gray-900">New Project</h1>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Left: Setup */}
              <div className="lg:col-span-2 space-y-6">
                {/* Project Name */}
                <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                  <label className="text-sm font-medium text-gray-500 block mb-2">Project Name</label>
                  <input
                    value={projectName}
                    onChange={e => setProjectName(e.target.value)}
                    placeholder="e.g. ODRX German Testimonial v3"
                    className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                  />
                </div>

                {/* Brand -> Product */}
                <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                  <div className="grid grid-cols-2 gap-6">
                    {/* Brand */}
                    <div>
                      <label className="text-sm font-medium text-gray-500 block mb-3">Brand</label>
                      <div className="flex flex-col gap-2">
                        {brands.map(b => (
                          <button key={b.id} onClick={() => handleBrandChange(b.id)}
                            className={`px-4 py-2.5 rounded-xl border transition text-sm text-left font-medium ${
                              selectedBrand === b.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white hover:border-gray-300 text-gray-700 hover:bg-gray-50'
                            }`}>{b.name}</button>
                        ))}
                      </div>
                    </div>
                    {/* Product */}
                    <div>
                      <label className="text-sm font-medium text-gray-500 block mb-3">Product</label>
                      {selectedBrand ? (
                        <div className="flex flex-col gap-2">
                          {brandProducts.map(p => (
                            <button key={p.id} onClick={() => setSelectedProduct(p.id)}
                              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition text-sm font-medium ${
                                selectedProduct === p.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white hover:border-gray-300 text-gray-700 hover:bg-gray-50'
                              }`}>
                              {p.image_url && <img src={p.image_url} alt="" className="w-10 h-10 object-contain rounded-lg border border-gray-100" />}
                              <span>{p.name}</span>
                            </button>
                          ))}
                          {brandProducts.length === 0 && <p className="text-xs text-gray-400">No products. <Link href="/brands" className="text-indigo-600 hover:text-indigo-700">Add in Brands</Link></p>}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">Select a brand first</p>
                      )}
                      {selectedProd?.image_url && productImageB64 && (
                        <div className="mt-3 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                          <img src={selectedProd.image_url} alt="" className="w-8 h-8 object-contain rounded-lg" />
                          <span className="text-xs text-emerald-600 font-medium">Reference loaded</span>
                        </div>
                      )}
                      {selectedProduct && !selectedProd?.image_url && (
                        <p className="mt-2 text-xs text-amber-600">No product image. <Link href="/brands" className="text-indigo-600 underline">Add in Brands</Link></p>
                      )}
                    </div>
                  </div>
                </div>

                {/* A-Roll */}
                <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                  <label className="text-sm font-medium text-gray-500 block mb-3">Speaker / A-Roll</label>
                  <div className="flex gap-3 mb-4">
                    <button
                      onClick={() => { setHasAroll(true) }}
                      className={`text-sm px-5 py-2.5 rounded-xl border transition font-medium ${
                        hasAroll ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white hover:border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      Upload A-Roll Frame
                    </button>
                    <button
                      onClick={() => { setHasAroll(false); setArollPreview(null) }}
                      className={`text-sm px-5 py-2.5 rounded-xl border transition font-medium ${
                        !hasAroll ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white hover:border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      Describe Speaker
                    </button>
                  </div>
                  {hasAroll ? (
                    <div className="flex items-center gap-4">
                      <input type="file" accept="image/*" onChange={handleArollUpload}
                        className="text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-gray-100 file:text-gray-700 file:text-sm file:cursor-pointer file:font-medium hover:file:bg-gray-200 transition-all" />
                      {arollPreview && <img src={arollPreview} alt="A-Roll" className="h-16 rounded-xl border border-gray-200 shadow-sm" />}
                    </div>
                  ) : (
                    <input
                      value={speakerDesc}
                      onChange={e => setSpeakerDesc(e.target.value)}
                      placeholder="e.g. Woman, mid-30s, German, sitting in kitchen"
                      className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all"
                    />
                  )}
                </div>

                {/* Script */}
                <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                  <label className="text-sm font-medium text-gray-500 block mb-3">Script</label>
                  <textarea
                    value={script}
                    onChange={e => setScript(e.target.value)}
                    placeholder="Paste the full ad script here..."
                    rows={8}
                    className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-y transition-all"
                  />
                </div>

                <button
                  onClick={analyzeScript}
                  disabled={loading || !script.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed px-8 py-3.5 rounded-xl text-sm font-semibold transition-all w-full text-white shadow-sm hover:shadow-md"
                >
                  {loading ? 'Analyzing script & matching B-Roll...' : 'Analyze Script & Find B-Roll'}
                </button>
              </div>

              {/* Right: Summary */}
              <div className="space-y-6">
                <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                  <h3 className="font-semibold text-gray-900 mb-4">Project Summary</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between py-1">
                      <span className="text-gray-400">Name</span>
                      <span className="text-gray-700 font-medium">{projectName || '---'}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-gray-400">Product</span>
                      <span className="text-gray-700 font-medium">{selectedProd?.name || '---'}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-gray-400">Speaker</span>
                      <span className="text-gray-700 font-medium">{hasAroll ? 'A-Roll uploaded' : (speakerDesc || '---')}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-gray-400">Script</span>
                      <span className="text-gray-700 font-medium">{script ? `${script.split(/[.!?]/).filter(Boolean).length} sentences` : '---'}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                  <h3 className="font-semibold text-gray-900 mb-3 text-sm">How it works</h3>
                  <ol className="text-xs text-gray-500 space-y-2 list-decimal list-inside leading-relaxed">
                    <li>Select your product</li>
                    <li>Upload A-Roll frame or describe speaker</li>
                    <li>Paste the script</li>
                    <li>AI analyzes each line and finds matching B-Roll</li>
                    <li>Accept matches or generate new clips</li>
                  </ol>
                </div>

                {/* Project History */}
                {history.length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                    <h3 className="font-semibold text-gray-900 mb-4 text-sm">Recent Projects</h3>
                    {Object.entries(
                      history.reduce((acc, p) => {
                        const key = p.brand_name || 'Other'
                        if (!acc[key]) acc[key] = {}
                        const prodKey = p.product_name || 'General'
                        if (!acc[key][prodKey]) acc[key][prodKey] = []
                        acc[key][prodKey].push(p)
                        return acc
                      }, {} as Record<string, Record<string, typeof history>>)
                    ).sort(([a], [b]) => a.localeCompare(b)).map(([brand, productGroups]) => (
                      <div key={brand} className="mb-4">
                        <div className="text-xs text-indigo-600 font-semibold mb-1.5">{brand}</div>
                        {Object.entries(productGroups).map(([product, projects]) => (
                          <div key={product} className="ml-2 mb-2">
                            <div className="text-xs text-gray-400 mb-1">{product}</div>
                            {projects.map(p => (
                              <div key={p.id}
                                onClick={() => loadProject(p)}
                                className="text-xs py-1.5 ml-2 border-b border-gray-100 last:border-0 flex justify-between cursor-pointer hover:bg-indigo-50 hover:text-indigo-700 rounded px-1.5 -mx-1.5 transition-colors">
                                <span className="text-gray-700 truncate group-hover:text-indigo-700">{p.name}</span>
                                <span className="text-gray-300 flex-shrink-0 ml-2">{p.created_at?.slice(0, 10)}</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-20">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-2 border-indigo-500 border-t-transparent mb-4"></div>
            <p className="text-gray-600 font-medium">Analyzing script and finding matching clips...</p>
            <p className="text-gray-400 text-sm mt-1">This takes 10-15 seconds</p>
          </div>
        )}

        {/* Results */}
        {step === 'results' && !loading && (
          <>
            <div className="flex items-center justify-between mb-8">
              <div>
                <button onClick={() => setStep('setup')} className="text-sm text-gray-400 hover:text-gray-700 mb-2 block transition-colors font-medium">&larr; Back to setup</button>
                <h1 className="text-[28px] font-bold tracking-tight text-gray-900">{projectName || 'Untitled Project'}</h1>
                <p className="text-gray-500 text-sm mt-1">{selectedProd?.name} &middot; {lines.length} lines &middot; {Object.values(selected).filter(Boolean).length} clips selected</p>
              </div>
            </div>

            <div className="space-y-8">
              {lines.map((line, lineIdx) => (
                <div key={lineIdx} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                  {/* Script Line */}
                  <div className="p-6 border-b border-gray-100">
                    <div className="flex items-start gap-4">
                      <span className="text-gray-300 font-mono text-sm mt-0.5 w-6 text-right flex-shrink-0">{lineIdx + 1}</span>
                      <div className="flex-1">
                        <p className="text-gray-800 mb-1 leading-relaxed">&ldquo;{line.text}&rdquo;</p>
                        {line.text_en && <p className="text-gray-400 text-sm mb-3 italic">{line.text_en}</p>}
                        <div className="flex gap-2 flex-wrap">
                          <span className={`text-xs px-2.5 py-1 rounded-lg border font-medium ${drColor(line.dr_function)}`}>
                            {line.dr_function}
                          </span>
                          {line.search_tags?.slice(0, 5).map((tag, i) => (
                            <span key={i} className="text-xs bg-gray-50 text-gray-500 px-2.5 py-1 rounded-lg border border-gray-100">{tag}</span>
                          ))}
                          {selected[lineIdx] && (
                            <span className="text-xs bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-lg border border-emerald-200 font-medium">Clip selected</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Matching Clips */}
                  <div className="p-6">
                    {line.matches.length > 0 ? (
                      <div className="flex gap-4 overflow-x-auto pb-2">
                        {line.matches.map((clip) => (
                          <div
                            key={clip.id}
                            className={`flex-shrink-0 w-80 rounded-xl border transition-all shadow-sm hover:shadow-md ${
                              selected[lineIdx] === clip.id
                                ? 'border-indigo-500 bg-indigo-50/30 ring-1 ring-indigo-200'
                                : 'border-gray-200 bg-white hover:border-gray-300'
                            }`}
                          >
                            <div
                              className="aspect-video bg-gray-100 rounded-t-xl overflow-hidden relative cursor-pointer"
                              onClick={() => setPreviewClip(clip)}
                            >
                              {clip.drive_url ? (
                                <video src={`/api/proxy-video?url=${encodeURIComponent(clip.drive_url)}`} preload="metadata" muted className="w-full h-full object-cover" playsInline />
                              ) : clip.thumbnail_url ? (
                                <img src={clip.thumbnail_url} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">No preview</div>
                              )}
                              <div className="absolute bottom-2 right-2 text-xs bg-white/90 text-gray-700 px-2 py-0.5 rounded-lg shadow-sm backdrop-blur-sm font-medium">Play</div>
                              <div className="absolute top-2 right-2 text-xs bg-indigo-600 text-white px-2 py-0.5 rounded-lg shadow-sm font-medium">{clip.match_score}pts</div>
                            </div>
                            <div className="p-3">
                              <p className="text-xs text-gray-600 line-clamp-2 mb-2 leading-relaxed">{clip.description}</p>
                              <a
                                href={clip.drive_url ? `/api/proxy-video?url=${encodeURIComponent(clip.drive_url)}` : '#'}
                                download={clip.filename}
                                className="text-xs px-3 py-1.5 rounded-lg transition w-full block text-center border border-gray-200 bg-gray-50 text-gray-600 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 font-medium"
                              >
                                Download
                              </a>
                            </div>
                          </div>
                        ))}

                        <div className="flex-shrink-0 w-80 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50 overflow-hidden">
                          {generating[lineIdx] ? (
                            <div className="flex items-center justify-center p-8">
                              <div className="text-center">
                                <div className="animate-spin rounded-full h-6 w-6 border-2 border-amber-500 border-t-transparent mx-auto mb-3"></div>
                                <p className="text-xs text-amber-600 font-medium">Generating image...</p>
                              </div>
                            </div>
                          ) : generatedStatus[lineIdx] === 'creating_video' ? (
                            <div className="flex items-center justify-center p-8">
                              <div className="text-center">
                                <div className="animate-spin rounded-full h-6 w-6 border-2 border-emerald-500 border-t-transparent mx-auto mb-3"></div>
                                <p className="text-xs text-emerald-600 font-medium">Creating video...</p>
                                <p className="text-xs text-gray-400 mt-1">~45 seconds</p>
                              </div>
                            </div>
                          ) : generatedVideos[lineIdx] ? (
                            <div>
                              <video src={generatedVideos[lineIdx]} controls className="w-full aspect-video object-cover rounded-t-xl" playsInline />
                              <div className="p-3">
                                <a href={generatedVideos[lineIdx]} target="_blank" rel="noopener noreferrer"
                                  className="text-xs px-3 py-1.5 rounded-lg w-full block text-center bg-emerald-600 text-white hover:bg-emerald-700 font-medium transition-colors">Show Video</a>
                              </div>
                            </div>
                          ) : generatedImages[lineIdx] ? (
                            <div>
                              <img src={generatedImages[lineIdx]} alt="" className="w-full aspect-video object-cover cursor-pointer hover:opacity-90 rounded-t-xl transition-opacity" onClick={() => setEnlargedImage(generatedImages[lineIdx])} />
                              <div className="p-3 space-y-2">
                                {generatedStatus[lineIdx] === 'video_failed' && (
                                  <p className="text-xs text-red-500 font-medium mb-1">Video failed (check Kling credits)</p>
                                )}
                                <div className="flex gap-2">
                                  <button onClick={async () => {
                                    setGeneratedStatus(prev => ({ ...prev, [lineIdx]: 'creating_video' }))
                                    try {
                                      const imgData = generatedImages[lineIdx].split(',')[1]
                                      const resp = await fetch('/api/create-video', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ image_base64: imgData, script_line: line.text, dr_function: line.dr_function })
                                      })
                                      const data = await resp.json()
                                      if (data.success) {
                                        setGeneratedVideos(prev => ({ ...prev, [lineIdx]: data.video_url }))
                                        setGeneratedStatus(prev => ({ ...prev, [lineIdx]: 'video_done' }))
                                        // Persist video URL to project results
                                        updateResult(lineIdx, { generated_video_url: data.video_url, status: 'video_done' })
                                        // Auto-save to clip library with categorization + Drive upload (awaited!)
                                        try {
                                          await fetch('/api/categorize-clip', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                              image_base64: imgData,
                                              video_url: data.video_url,
                                              filename: `ai_broll_${lineIdx + 1}_${Date.now()}.mp4`,
                                              brand: selectedBrandObj?.name || 'Uncategorized',
                                              filetype: 'video',
                                            })
                                          })
                                        } catch (e) { console.error('Auto-categorize failed:', e) }
                                      } else {
                                        setGeneratedStatus(prev => ({ ...prev, [lineIdx]: 'video_failed' }))
                                      }
                                    } catch { setGeneratedStatus(prev => ({ ...prev, [lineIdx]: 'video_failed' })) }
                                  }} className="flex-1 text-xs py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium transition-colors">Accept</button>
                                  <button onClick={() => {
                                    setRejectModal({ lineNumber: lineIdx, scriptLine: line.text, drFunction: line.dr_function })
                                  }} className="flex-1 text-xs py-2 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 font-medium transition-colors">Reject</button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center p-8 cursor-pointer hover:bg-gray-100/50 transition-colors h-full"
                              onClick={async () => {
                                setGenerating(prev => ({ ...prev, [lineIdx]: true }))
                                try {
                                  const resp = await fetch('/api/generate-broll', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ script_line: line.text, dr_function: line.dr_function, aroll_image: arollBase64, speaker_description: speakerDesc, product_image: productImageB64, product_physical: selectedProd?.physical_notes })
                                  })
                                  const data = await resp.json()
                                  if (data.success) {
                                    const imgUrl = `data:${data.image.mimeType};base64,${data.image.data}`
                                    setGeneratedImages(prev => ({ ...prev, [lineIdx]: imgUrl }))
                                    setGeneratedStatus(prev => ({ ...prev, [lineIdx]: 'review' }))
                                    setLastPrompts(prev => ({ ...prev, [lineIdx]: data.prompt_used }))
                                    updateResult(lineIdx, { generated_image_url: imgUrl, status: 'review' })
                                  }
                                } catch (e) { console.error(e) }
                                setGenerating(prev => ({ ...prev, [lineIdx]: false }))
                              }}>
                              <div className="text-center">
                                <div className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center mx-auto mb-2 shadow-sm">
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-400"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                </div>
                                <p className="text-xs text-gray-400 font-medium">Generate new<br/>B-Roll with AI</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-4">
                        <span className="text-sm text-gray-400">No matching clips found</span>
                        <button
                          disabled={generating[lineIdx]}
                          onClick={async () => {
                            setGenerating(prev => ({ ...prev, [lineIdx]: true }))
                            try {
                              const resp = await fetch('/api/generate-broll', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ script_line: line.text, dr_function: line.dr_function, aroll_image: arollBase64, speaker_description: speakerDesc, product_image: productImageB64, product_physical: selectedProd?.physical_notes })
                              })
                              const data = await resp.json()
                              if (data.success) {
                                const imgUrl = `data:${data.image.mimeType};base64,${data.image.data}`
                                setGeneratedImages(prev => ({ ...prev, [lineIdx]: imgUrl }))
                                setGeneratedStatus(prev => ({ ...prev, [lineIdx]: 'review' }))
                                setLastPrompts(prev => ({ ...prev, [lineIdx]: data.prompt_used }))
                                updateResult(lineIdx, { generated_image_url: imgUrl, status: 'review' })
                              }
                            } catch (e) { console.error(e) }
                            setGenerating(prev => ({ ...prev, [lineIdx]: false }))
                          }}
                          className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-4 py-2 rounded-xl hover:bg-amber-100 transition font-medium disabled:opacity-50"
                        >
                          {generating[lineIdx] ? 'Generating...' : 'Generate new B-Roll with AI'}
                        </button>
                        {generatedImages[lineIdx] && (
                          <a href={generatedImages[lineIdx]} download={`broll_${lineIdx + 1}.jpg`}
                            className="text-xs bg-emerald-600 text-white px-4 py-2 rounded-xl hover:bg-emerald-700 font-medium transition-colors">Download generated</a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {/* Rejection Feedback Modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-8" onClick={() => { if (!savingReject) { setRejectModal(null); setRejectReason(''); setRejectNote('') } }}>
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-200 animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h3 className="text-[16px] font-semibold tracking-tight mb-1">Why are you rejecting this?</h3>
              <p className="text-xs text-gray-400 mb-5">Your feedback improves future matching for this product.</p>
              <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mb-5 border border-gray-100 line-clamp-2">&ldquo;{rejectModal.scriptLine}&rdquo;</p>

              <label className="text-sm font-medium text-gray-500 block mb-2">Reason</label>
              <div className="flex flex-wrap gap-2 mb-4">
                {[
                  'Wrong visual content',
                  'Wrong mood/tone',
                  'Product not visible',
                  'Person looks wrong',
                  'Setting doesn\'t match',
                  'Low quality',
                  'Too generic',
                  'Not UGC style',
                ].map(reason => (
                  <button key={reason} onClick={() => setRejectReason(reason)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-all font-medium ${
                      rejectReason === reason
                        ? 'border-red-400 bg-red-50 text-red-700'
                        : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                    }`}>{reason}</button>
                ))}
              </div>

              <label className="text-sm font-medium text-gray-500 block mb-2">Additional note (optional)</label>
              <textarea
                value={rejectNote}
                onChange={e => setRejectNote(e.target.value)}
                placeholder="e.g. Should show the device plugged into the wall, not on a table..."
                rows={2}
                className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 transition-all resize-none mb-5"
              />

              <div className="flex gap-3">
                <button
                  onClick={submitRejection}
                  disabled={!rejectReason || savingReject}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {savingReject ? (
                    <><div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent"></div> Saving...</>
                  ) : 'Reject & Save Feedback'}
                </button>
                <button
                  onClick={() => { setRejectModal(null); setRejectReason(''); setRejectNote('') }}
                  disabled={savingReject}
                  className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 font-medium hover:bg-gray-50 transition-colors"
                >Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Enlarged Image Modal */}
      {enlargedImage && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 cursor-pointer" onClick={() => setEnlargedImage(null)}>
          <img src={enlargedImage} alt="" className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl" />
        </div>
      )}

      {/* Video Preview Modal */}
      {previewClip && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-8"
          onClick={() => setPreviewClip(null)}>
          <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-gray-200" onClick={e => e.stopPropagation()}>
            <div className="aspect-video bg-gray-100 rounded-t-2xl overflow-hidden">
              {previewClip.drive_url && previewClip.filename?.match(/\.(mp4|mov|webm)$/i) ? (
                <video
                  key={previewClip.id}
                  src={getDriveStreamUrl(previewClip.drive_url)!}
                  controls
                  autoPlay
                  className="w-full h-full object-contain"
                  playsInline
                />
              ) : previewClip.drive_url && previewClip.filename?.match(/\.(jpg|jpeg|png|webp)$/i) ? (
                <img src={getDriveStreamUrl(previewClip.drive_url)!} alt="" className="w-full h-full object-contain" />
              ) : previewClip.thumbnail_url ? (
                <img src={previewClip.thumbnail_url} alt="" className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-300">No preview</div>
              )}
            </div>
            <div className="p-6">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="text-sm text-gray-700 leading-relaxed">{previewClip.description}</p>
                  <p className="text-xs text-gray-400 mt-1">{previewClip.filename}</p>
                </div>
                <button onClick={() => setPreviewClip(null)} className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all ml-4 flex-shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div className="flex gap-2 flex-wrap mt-3">
                <span className={`text-xs px-2.5 py-1 rounded-lg border font-medium ${drColor(previewClip.dr_function)}`}>{previewClip.dr_function}</span>
                <span className="text-xs bg-gray-50 text-gray-500 px-2.5 py-1 rounded-lg border border-gray-100">{previewClip.mood}</span>
                <span className="text-xs bg-gray-50 text-gray-500 px-2.5 py-1 rounded-lg border border-gray-100">{previewClip.setting}</span>
                {previewClip.drive_url && (
                  <a href={previewClip.drive_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-indigo-600 hover:text-indigo-700 ml-auto font-medium transition-colors">Open in Drive &rarr;</a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
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
            <Link href="/brands" className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-50 transition-all duration-200">
              Brands
            </Link>
            <Link href="/projects" className="px-4 py-2 text-[13px] text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-50 transition-all duration-200">
              Projects
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <main className="max-w-5xl mx-auto px-8 pt-24 pb-32">
        <div className="animate-fade-in">
          {/* Subtle badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-50 border border-indigo-100 mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-[12px] font-medium text-indigo-600 tracking-wide">AI-Powered B-Roll Pipeline</span>
          </div>

          <h1 className="text-[48px] font-bold tracking-tight leading-[1.1] mb-5 text-gray-900">
            B-Roll Engine
          </h1>
          <p className="text-[18px] text-gray-500 max-w-xl leading-relaxed mb-16">
            Search existing B-roll clips, match them to scripts, only generate what you don&apos;t have.
          </p>

          {/* Feature Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 stagger-children">
            <Link href="/clips" className="group glass-card rounded-2xl p-8 block">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mb-5 group-hover:bg-indigo-100 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-600">
                  <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                  <line x1="7" y1="2" x2="7" y2="22" />
                  <line x1="17" y1="2" x2="17" y2="22" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <line x1="2" y1="7" x2="7" y2="7" />
                  <line x1="2" y1="17" x2="7" y2="17" />
                  <line x1="17" y1="7" x2="22" y2="7" />
                  <line x1="17" y1="17" x2="22" y2="17" />
                </svg>
              </div>
              <h2 className="text-[17px] font-semibold text-gray-900 mb-2 tracking-tight">Upload B-Roll</h2>
              <p className="text-[14px] text-gray-500 leading-relaxed">Upload new B-roll clips per brand and product. Auto-categorized by AI.</p>
              <div className="mt-6 flex items-center gap-2 text-[13px] text-indigo-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <span>Upload clips</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                </svg>
              </div>
            </Link>

            <Link href="/projects" className="group glass-card rounded-2xl p-8 block">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mb-5 group-hover:bg-indigo-100 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-600">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
              </div>
              <h2 className="text-[17px] font-semibold text-gray-900 mb-2 tracking-tight">Projects</h2>
              <p className="text-[14px] text-gray-500 leading-relaxed">Paste a script, get matched clips per line. Only generate what&apos;s missing.</p>
              <div className="mt-6 flex items-center gap-2 text-[13px] text-indigo-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <span>New project</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                </svg>
              </div>
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}

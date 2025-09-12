import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

interface UsageLimits {
  plan: string
  isPro: boolean
  usage: {
    monthlyGenerations: number
    monthlyQuotes: number
    remainingGenerations: number
    remainingQuotes: number
  }
  limits: {
    monthlyGenerations: number
    monthlyQuotes: number
    maxAssetsPerRequest: number
    features: string[]
  }
  resetDate: string
}

interface Quote {
  id: string
  text: string
  author?: string
  attributed?: boolean
  toneTag?: string
}

interface Asset {
  id: string
  provider: string
  query: string
  fileUrl: string
  width?: number
  height?: number
  duration?: number
  photographer?: string
  sourceUrl?: string
  thumbUrl?: string
}

interface AiImage {
  id: string
  url: string
  prompt: string
  style: string
}

export function CreativePage() {
  const [limits, setLimits] = useState<UsageLimits | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Quote state
  const [quoteText, setQuoteText] = useState('Create a motivational quote about success')
  const [quoteTone, setQuoteTone] = useState<'motivational'|'witty'|'poetic'|'bold'|'calm'|'default'>('default')
  const [currentQuote, setCurrentQuote] = useState<Quote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  // Asset state
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [assetType, setAssetType] = useState<'images'|'videos'>('images')
  const [assetQuery, setAssetQuery] = useState('nature')
  const [assets, setAssets] = useState<Asset[]>([])
  const [assetLoading, setAssetLoading] = useState(false)
  const [assetError, setAssetError] = useState<string | null>(null)
  const [assetPage, setAssetPage] = useState(1)
  const [hasMoreAssets, setHasMoreAssets] = useState(false)
  const [nextPage, setNextPage] = useState<number|null>(null)

  // AI Images state
  const [aiPrompt, setAiPrompt] = useState('A serene mountain landscape at sunset')
  const [aiStyle, setAiStyle] = useState<'realistic'|'creative'>('realistic')
  const [aiImages, setAiImages] = useState<AiImage[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  // Load usage limits on mount
  useEffect(() => {
    loadLimits()
  }, [])

  async function loadLimits() {
    try {
      setLoading(true)
      setError(null)
      const result = await api.getUsageLimits()
      if (result.ok) {
        setLimits(result.data)
      } else {
        setError(result.error)
      }
    } catch (e) {
      setError('Failed to load usage limits')
    } finally {
      setLoading(false)
    }
  }

  async function generateQuote() {
    if (!quoteText.trim()) return
    
    try {
      setQuoteLoading(true)
      setQuoteError(null)
      const result = await api.generateQuote({
        text: quoteText,
        tone: quoteTone === 'default' ? undefined : quoteTone,
        maxChars: 120
      })
      if (result.ok) {
        setCurrentQuote(result.data.quote)
      } else {
        setQuoteError(result.error)
      }
    } catch (e) {
      setQuoteError('Failed to generate quote')
    } finally {
      setQuoteLoading(false)
    }
  }

  async function remixQuote(mode: 'regenerate'|'rephrase'|'tone_shift') {
    if (!currentQuote) return
    
    try {
      setQuoteLoading(true)
      setQuoteError(null)
      const result = await api.remixQuote({
        originalText: currentQuote.text,
        mode,
        targetTone: mode === 'tone_shift' ? quoteTone : undefined,
        maxChars: 120
      })
      if (result.ok) {
        setCurrentQuote(result.data.quote)
      } else {
        setQuoteError(result.error)
      }
    } catch (e) {
      setQuoteError('Failed to remix quote')
    } finally {
      setQuoteLoading(false)
    }
  }

  async function loadAssets(page = 1) {
    try {
      setAssetLoading(true)
      setAssetError(null)
      const perPage = 12 // request fuller grid; backend will cap for free plans
      const result = await api.getAssetsOptions({
        type: assetType,
        query: assetQuery,
        page,
        perPage
      })
      if (result.ok) {
        if (page === 1) {
          setAssets(result.data.items)
        } else {
          setAssets(prev => [...prev, ...result.data.items])
        }
        setHasMoreAssets(!!result.data.nextPage)
        setNextPage(result.data.nextPage)
        setAssetPage(page)
      } else {
        setAssetError(result.error)
      }
    } catch (e) {
      setAssetError('Failed to load assets')
    } finally {
      setAssetLoading(false)
    }
  }

  async function loadMoreAssets() {
    const p = nextPage || (assetPage + 1)
    await loadAssets(p)
  }

  async function generateAiImages() {
    if (!aiPrompt.trim()) return
    
    try {
      setAiLoading(true)
      setAiError(null)
      const result = await api.generateAiImages({
        prompt: aiPrompt,
        style: aiStyle,
        count: 2
      })
      if (result.ok) {
        setAiImages(result.data.images)
      } else {
        setAiError(result.error)
      }
    } catch (e) {
      setAiError('Failed to generate AI images')
    } finally {
      setAiLoading(false)
    }
  }

  // Load assets when type or query changes
  useEffect(() => {
    if (limits) {
      loadAssets(1)
    }
  }, [assetType, assetQuery, limits])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-500">Error: {error}</div>
      </div>
    )
  }

  if (!limits) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-500">Failed to load usage limits</div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      {/* Header with Plan Badge */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Creative Studio</h1>
        <div className="flex items-center gap-4">
          <div className={`px-3 py-1 rounded-full text-sm font-medium ${
            limits.isPro ? 'bg-purple-600 text-white' : 'bg-gray-600 text-white'
          }`}>
            {limits.plan.toUpperCase()} Plan
          </div>
          <div className="text-sm text-gray-400">
            {limits.usage.remainingGenerations} generations left
          </div>
        </div>
      </div>

      {/* Quote Generation Section */}
      <div className="bg-gray-900 rounded-lg p-6 space-y-4">
        <h2 className="text-xl font-semibold">Generate Quote</h2>
        
        <div className="flex gap-4 items-center">
          <input
            type="text"
            value={quoteText}
            onChange={(e) => setQuoteText(e.target.value)}
            placeholder="Describe what kind of quote you want..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2"
          />
          <select
            value={quoteTone}
            onChange={(e) => setQuoteTone(e.target.value as any)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2"
          >
            <option value="default">Default</option>
            <option value="motivational">Motivational</option>
            <option value="witty">Witty</option>
            <option value="poetic">Poetic</option>
            <option value="bold">Bold</option>
            <option value="calm">Calm</option>
          </select>
          <button
            onClick={generateQuote}
            disabled={quoteLoading || !quoteText.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 rounded"
          >
            {quoteLoading ? 'Generating...' : 'Generate Quote'}
          </button>
        </div>

        {quoteError && (
          <div className="text-red-500 text-sm">{quoteError}</div>
        )}

        {currentQuote && (
          <div className="bg-gray-800 rounded p-4 space-y-3">
            <div className="text-lg font-medium">{currentQuote.text}</div>
            {currentQuote.author && (
              <div className="text-sm text-gray-400">— {currentQuote.author}</div>
            )}
            {currentQuote.toneTag && (
              <div className="text-xs text-blue-400">Tone: {currentQuote.toneTag}</div>
            )}
            
            {/* Remix buttons (Pro only) */}
            {limits.isPro && (
              <div className="flex gap-2">
                <button
                  onClick={() => remixQuote('regenerate')}
                  disabled={quoteLoading}
                  className="px-3 py-1 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 rounded text-sm"
                >
                  Regenerate
                </button>
                <button
                  onClick={() => remixQuote('rephrase')}
                  disabled={quoteLoading}
                  className="px-3 py-1 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 rounded text-sm"
                >
                  Rephrase
                </button>
                <button
                  onClick={() => remixQuote('tone_shift')}
                  disabled={quoteLoading}
                  className="px-3 py-1 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 rounded text-sm"
                >
                  Change Tone
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Asset Selection Section */}
      <div className="bg-gray-900 rounded-lg p-6 space-y-4">
        <h2 className="text-xl font-semibold">Choose Background</h2>
        
        {/* Asset Type Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setAssetType('images')}
            className={`px-4 py-2 rounded ${
              assetType === 'images' ? 'bg-blue-600' : 'bg-gray-700'
            }`}
          >
            Images
          </button>
          <button
            onClick={() => setAssetType('videos')}
            className={`px-4 py-2 rounded ${
              assetType === 'videos' ? 'bg-blue-600' : 'bg-gray-700'
            }`}
          >
            Videos
          </button>
          {limits.isPro && (
            <button
              onClick={() => setAssetType('ai')}
              className={`px-4 py-2 rounded ${
                assetType === 'ai' ? 'bg-purple-600' : 'bg-gray-700'
              }`}
            >
              AI Images
            </button>
          )}
        </div>

        {/* Search Controls */}
        {assetType !== 'ai' && (
          <div className="flex gap-4 items-center">
            <input
              type="text"
              value={assetQuery}
              onChange={(e) => setAssetQuery(e.target.value)}
              placeholder="Search for images/videos..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2"
            />
            <button
              onClick={() => loadAssets(1)}
              disabled={assetLoading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 rounded"
            >
              {assetLoading ? 'Loading...' : 'Search'}
            </button>
          </div>
        )}

        {/* AI Images Controls */}
        {assetType === 'ai' && (
          <div className="space-y-4">
            <div className="flex gap-4 items-center">
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Describe the image you want..."
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2"
              />
              <select
                value={aiStyle}
                onChange={(e) => setAiStyle(e.target.value as any)}
                className="bg-gray-800 border border-gray-700 rounded px-3 py-2"
              >
                <option value="realistic">Realistic</option>
                <option value="creative">Creative</option>
              </select>
              <button
                onClick={generateAiImages}
                disabled={aiLoading || !aiPrompt.trim()}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 rounded"
              >
                {aiLoading ? 'Generating...' : 'Generate'}
              </button>
            </div>
            {aiError && (
              <div className="text-red-500 text-sm">{aiError}</div>
            )}
          </div>
        )}

        {assetError && (
          <div className="text-red-500 text-sm">{assetError}</div>
        )}

        {/* Asset Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Stock Assets */}
          {assetType !== 'ai' && assets.map((asset) => (
            <div
              key={asset.id}
              className={`border-2 rounded overflow-hidden cursor-pointer transition-colors ${
                selectedAsset?.id === asset.id ? 'border-blue-500' : 'border-gray-700'
              }`}
              onClick={() => setSelectedAsset(asset)}
            >
              {assetType === 'images' ? (
                <img
                  src={asset.thumbUrl || asset.fileUrl}
                  alt={asset.query}
                  loading="lazy"
                  className="w-full h-32 object-cover"
                />
              ) : (
                <video
                  src={asset.fileUrl}
                  className="w-full h-32 object-cover"
                  muted
                  playsInline
                />
              )}
              <div className="p-2 text-xs">
                <div className="truncate">{asset.query}</div>
                {asset.photographer && (
                  <div className="text-gray-400 truncate">by {asset.photographer}</div>
                )}
              </div>
            </div>
          ))}

          {/* AI Images */}
          {assetType === 'ai' && aiImages.map((image) => (
            <div
              key={image.id}
              className={`border-2 rounded overflow-hidden cursor-pointer transition-colors ${
                selectedAsset?.id === image.id ? 'border-purple-500' : 'border-gray-700'
              }`}
              onClick={() => setSelectedAsset({
                id: image.id,
                provider: 'ai',
                query: image.prompt,
                fileUrl: image.url,
                width: 1024,
                height: 1024
              })}
            >
              <img
                src={image.url}
                alt={image.prompt}
                className="w-full h-32 object-cover"
              />
              <div className="p-2 text-xs">
                <div className="truncate">{image.prompt}</div>
                <div className="text-purple-400">AI • {image.style}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Load More Button */}
        {assetType !== 'ai' && hasMoreAssets && (
          <div className="text-center">
            <button
              onClick={loadMoreAssets}
              disabled={assetLoading}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-600 rounded"
            >
              {assetLoading ? 'Loading...' : 'More Results'}
            </button>
          </div>
        )}

        {/* Free Plan Notice */}
        {!limits.isPro && (
          <div className="text-center text-sm text-gray-400">
            Showing {limits.limits.maxAssetsPerRequest} curated assets. 
            <span className="text-blue-400"> Upgrade to Pro</span> for full search and AI images.
          </div>
        )}
      </div>

      {/* Render Section */}
      <div className="bg-gray-900 rounded-lg p-6 space-y-4">
        <h2 className="text-xl font-semibold">Create Short</h2>
        
        {!currentQuote && (
          <div className="text-gray-400">Generate a quote first</div>
        )}
        
        {!selectedAsset && (
          <div className="text-gray-400">Choose a background asset</div>
        )}

        {currentQuote && selectedAsset && (
          <div className="space-y-4">
            <div className="bg-gray-800 rounded p-4">
              <div className="text-sm text-gray-400 mb-2">Preview:</div>
              <div className="text-lg font-medium mb-2">{currentQuote.text}</div>
              <div className="text-sm text-gray-400">
                Background: {selectedAsset.provider === 'ai' ? 'AI Image' : `${selectedAsset.type} - ${selectedAsset.query}`}
              </div>
            </div>
            
            <button
              onClick={() => {
                // TODO: Wire to existing render flow
                alert('Render functionality will be wired to existing render endpoint')
              }}
              className="px-6 py-3 bg-green-600 hover:bg-green-500 rounded-lg font-medium"
            >
              Render Short
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

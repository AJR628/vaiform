/**
 * Extract content from URLs using LLM or fallback text extraction
 */

const OPENAI_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/**
 * Extract main content from a URL
 * @param {string} url - URL to extract content from
 * @returns {Promise<{title: string, summary: string, keyPoints: string[]}>}
 */
export async function extractContentFromUrl(url) {
  try {
    // Fetch HTML
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      redirect: 'follow'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }
    
    const html = await response.text();
    
    // Try LLM extraction first
    try {
      return await extractWithLLM(html, url);
    } catch (llmError) {
      console.warn('[link.extract] LLM extraction failed, using fallback:', llmError?.message);
      return extractFallback(html, url);
    }
  } catch (error) {
    throw new Error(`LINK_EXTRACT_FAILED: ${error?.message || error}`);
  }
}

/**
 * Use LLM to extract structured content from HTML
 */
async function extractWithLLM(html, url) {
  // Truncate HTML to avoid token limits (keep first 8000 chars)
  const truncatedHtml = html.slice(0, 8000);
  
  const apiUrl = `${OPENAI_BASE}/chat/completions`;
  const body = {
    model: OPENAI_MODEL,
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content: 'You extract the main content from web pages. Return ONLY valid JSON: {"title":"...","summary":"2-3 sentence summary","keyPoints":["point1","point2",...]}'
      },
      {
        role: 'user',
        content: `Extract content from this HTML (URL: ${url}):\n\n${truncatedHtml}`
      }
    ]
  };

  const r = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!r.ok) throw new Error(`LLM_HTTP_${r.status}`);

  const data = await r.json();
  const content = data?.choices?.[0]?.message?.content || '';
  
  // Parse JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in LLM response');
  
  const parsed = JSON.parse(jsonMatch[0]);
  
  return {
    title: String(parsed?.title || '').trim() || 'Untitled',
    summary: String(parsed?.summary || '').trim() || '',
    keyPoints: Array.isArray(parsed?.keyPoints) 
      ? parsed.keyPoints.map(p => String(p).trim()).filter(Boolean)
      : []
  };
}

/**
 * Fallback: simple text extraction from HTML
 */
function extractFallback(html, url) {
  // Remove script and style tags
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : 'Untitled';
  
  // Use first 500 chars as summary
  const summary = cleaned.slice(0, 500).trim();
  
  // Extract key points (look for list items or paragraphs)
  const keyPoints = [];
  const listMatch = html.match(/<li[^>]*>([^<]+)<\/li>/gi);
  if (listMatch) {
    keyPoints.push(...listMatch.slice(0, 5).map(m => m.replace(/<[^>]+>/g, '').trim()).filter(Boolean));
  }
  
  return {
    title,
    summary: summary || 'No summary available',
    keyPoints: keyPoints.length > 0 ? keyPoints : [summary.slice(0, 100)]
  };
}

export default { extractContentFromUrl };


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
  // Realistic browser headers to avoid bot detection
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    Referer: 'https://www.google.com/',
    Connection: 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0',
  };

  let lastError = null;
  const maxRetries = 2;

  // Retry logic for 403/429 errors
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        // Wait before retry with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        console.log(`[link.extract] Retry attempt ${attempt} for ${url}`);
      }

      // Fetch HTML with timeout (each retry attempt gets its own timeout)
      const { withAbortTimeout } = await import('./fetch.timeout.js');
      const response = await withAbortTimeout(
        async (signal) => {
          return await fetch(url, {
            headers,
            redirect: 'follow',
            ...(signal ? { signal } : {}),
          });
        },
        { timeoutMs: 20000, errorMessage: 'LINK_EXTRACT_TIMEOUT' }
      );

      if (!response.ok) {
        // Retry on 403/429, but fail immediately on other errors
        if ((response.status === 403 || response.status === 429) && attempt < maxRetries) {
          lastError = new Error(`HTTP_${response.status}`);
          continue;
        }
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
      lastError = error;
      // CRITICAL: Timeout errors must NOT trigger retries (fail immediately)
      if (error.name === 'AbortError' || error.message === 'LINK_EXTRACT_TIMEOUT') {
        throw error;
      }
      // Only retry on network/403/429 errors
      if (
        attempt < maxRetries &&
        (error.message.includes('HTTP_403') ||
          error.message.includes('HTTP_429') ||
          error.message.includes('fetch'))
      ) {
        continue;
      }
      throw new Error(`LINK_EXTRACT_FAILED: ${error?.message || error}`);
    }
  }

  // If we exhausted retries, throw the last error
  throw new Error(`LINK_EXTRACT_FAILED: ${lastError?.message || 'Max retries exceeded'}`);
}

/**
 * Use LLM to extract structured content from HTML
 */
async function extractWithLLM(html, url) {
  // Truncate HTML to avoid token limits (keep first 12000 chars for better context)
  const truncatedHtml = html.slice(0, 12000);

  const apiUrl = `${OPENAI_BASE}/chat/completions`;
  const body = {
    model: OPENAI_MODEL,
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content:
          'You extract the main content from web pages. Extract the full article content, not just the headline. Return ONLY valid JSON: {"title":"...","summary":"4-8 sentence comprehensive summary covering the main points of the article","keyPoints":["point1","point2",...]}. The summary should be detailed enough to generate a 4-6 sentence video story. Write the summary in your own words - do not copy sentences verbatim from the article.',
      },
      {
        role: 'user',
        content: `Extract the full article content from this HTML (URL: ${url}). Provide a comprehensive summary that captures the main story, not just the headline:\n\n${truncatedHtml}`,
      },
    ],
  };

  const r = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
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
      ? parsed.keyPoints.map((p) => String(p).trim()).filter(Boolean)
      : [],
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
    keyPoints.push(
      ...listMatch
        .slice(0, 5)
        .map((m) => m.replace(/<[^>]+>/g, '').trim())
        .filter(Boolean)
    );
  }

  return {
    title,
    summary: summary || 'No summary available',
    keyPoints: keyPoints.length > 0 ? keyPoints : [summary.slice(0, 100)],
  };
}

export default { extractContentFromUrl };

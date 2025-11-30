/**
 * LLM service for story generation and visual planning
 */

import { randomUUID } from 'crypto';
import { extractContentFromUrl } from '../utils/link.extract.js';
import { calculateReadingDuration } from '../utils/text.duration.js';

const OPENAI_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/**
 * Generate a 4-6 sentence story from input
 * @param {string} input - User input (link content, idea, or paragraph)
 * @param {string} inputType - 'link' | 'idea' | 'paragraph'
 * @returns {Promise<{sentences: string[], totalDurationSec: number}>}
 */
export async function generateStoryFromInput({ input, inputType }) {
  let sourceContent = input;
  
  // If link, extract content first
  if (inputType === 'link') {
    try {
      const extracted = await extractContentFromUrl(input);
      sourceContent = `${extracted.title}\n\n${extracted.summary}\n\n${extracted.keyPoints.join('. ')}`;
    } catch (error) {
      console.warn('[story.llm] Link extraction failed, using URL as-is:', error?.message);
      sourceContent = `URL: ${input}`;
    }
  }
  
  const url = `${OPENAI_BASE}/chat/completions`;
  const body = {
    model: OPENAI_MODEL,
    temperature: 0.8,
    messages: [
      {
        role: 'system',
        content: [
          'You create engaging short-form video stories. Output a cohesive 4-6 sentence narrative.',
          'Each sentence: 8-12 words, clear and visual. Sentences should flow together as a complete story.',
          'For link content: Create a cohesive summary in your own words that captures the essence of the article.',
          'Total story should be 12-30 seconds when spoken (estimate ~2-3 words per second).',
          'Return ONLY valid JSON: {"sentences":["sentence1","sentence2",...],"totalDurationSec":number}'
        ].join(' ')
      },
      {
        role: 'user',
        content: inputType === 'idea' 
          ? `Expand this idea into a 4-6 sentence cohesive story: "${input}"`
          : inputType === 'link'
          ? `Create a 4-6 sentence cohesive story summary from this article content. Write it in your own words as a flowing narrative:\n\n${sourceContent}`
          : `Create a 4-6 sentence cohesive story from this text:\n\n${input}`
      }
    ]
  };

  const r = await fetch(url, {
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
  
  // Parse JSON
  let parsed = null;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
  } catch (parseError) {
    console.warn('[story.llm] JSON parse failed, using fallback');
    parsed = null;
  }
  
  // Validate and normalize
  let sentences = Array.isArray(parsed?.sentences) ? parsed.sentences : [];
  let totalDurationSec = Number(parsed?.totalDurationSec) || 0;
  
  // Fallback: split input into sentences if LLM failed
  if (sentences.length === 0) {
    const text = inputType === 'link' ? sourceContent : input;
    sentences = text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 10 && s.length < 150)
      .slice(0, 6);
    
    if (sentences.length < 4) {
      // Split long sentences
      const words = text.split(/\s+/).filter(w => w.length > 0);
      const wordsPerSentence = Math.ceil(words.length / 5);
      sentences = [];
      for (let i = 0; i < words.length; i += wordsPerSentence) {
        const chunk = words.slice(i, i + wordsPerSentence).join(' ');
        if (chunk.length > 10) sentences.push(chunk);
      }
      sentences = sentences.slice(0, 6);
    }
  }
  
  // Normalize sentences
  sentences = sentences
    .map(s => String(s).replace(/\s+/g, ' ').trim())
    .filter(s => s.length >= 8 && s.length <= 150)
    .slice(0, 6);
  
  // Ensure we have 4-6 sentences
  if (sentences.length < 4) {
    // Pad with variations
    while (sentences.length < 4 && sentences.length > 0) {
      sentences.push(sentences[sentences.length - 1]);
    }
  }
  
  // Calculate duration if not provided (estimate 2.5 words per second)
  if (!totalDurationSec || totalDurationSec <= 0) {
    const totalWords = sentences.join(' ').split(/\s+/).length;
    totalDurationSec = Math.max(12, Math.min(30, Math.ceil(totalWords / 2.5)));
  }
  
  return {
    sentences: sentences.slice(0, 6),
    totalDurationSec: Math.max(12, Math.min(30, totalDurationSec))
  };
}

/**
 * Plan visual shots for each sentence
 * @param {string[]} sentences - Array of story sentences
 * @returns {Promise<Array<{sentenceIndex: number, visualDescription: string, searchQuery: string, durationSec: number, startTimeSec: number}>>}
 */
export async function planVisualShots({ sentences }) {
  if (!Array.isArray(sentences) || sentences.length === 0) {
    throw new Error('SENTENCES_REQUIRED');
  }
  
  const url = `${OPENAI_BASE}/chat/completions`;
  const body = {
    model: OPENAI_MODEL,
    temperature: 0.7,
    messages: [
      {
        role: 'system',
        content: [
          'You plan visual shots for short-form video. For each sentence, provide:',
          '- visualDescription: What should be shown (2-3 words)',
          '- searchQuery: 2-4 word search term for stock video (portrait-oriented)',
          '- durationSec: Duration in seconds based on text length (3-10 seconds, longer sentences need more time)',
          'Return ONLY valid JSON: {"shots":[{"sentenceIndex":0,"visualDescription":"...","searchQuery":"...","durationSec":number},...]}',
          'Total duration should match the story length. Longer sentences should have longer durations.'
        ].join(' ')
      },
      {
        role: 'user',
        content: `Plan visual shots for these sentences:\n${sentences.map((s, i) => `${i}: ${s}`).join('\n')}`
      }
    ]
  };

  const r = await fetch(url, {
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
  
  // Parse JSON
  let parsed = null;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
  } catch (parseError) {
    console.warn('[story.llm] Visual plan JSON parse failed, using fallback');
    parsed = null;
  }
  
  // Validate and normalize
  let shots = Array.isArray(parsed?.shots) ? parsed.shots : [];
  
  // Fallback: generate basic plan
  if (shots.length === 0 || shots.length !== sentences.length) {
    shots = sentences.map((sentence, index) => {
      // Extract key words for search
      const words = sentence.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3)
        .slice(0, 3);
      
      // Calculate duration based on sentence text length
      const durationSec = calculateReadingDuration(sentence);
      
      return {
        sentenceIndex: index,
        visualDescription: words.join(' ') || 'abstract',
        searchQuery: words.slice(0, 2).join(' ') || 'nature',
        durationSec,
        startTimeSec: 0
      };
    });
  }
  
  // Calculate start times and normalize durations
  let cumulativeTime = 0;
  shots = shots.map((shot, index) => {
    const sentenceIndex = Number(shot.sentenceIndex) ?? index;
    const sentence = sentences[sentenceIndex] || sentences[index] || '';
    
    // Calculate duration from text, but respect LLM-provided duration if reasonable
    const llmDuration = Number(shot.durationSec) || 0;
    const calculatedDuration = calculateReadingDuration(sentence);
    
    // Use calculated duration, but if LLM provided a value in reasonable range, prefer it
    let durationSec = calculatedDuration;
    if (llmDuration >= 3 && llmDuration <= 10) {
      // LLM provided reasonable duration, use average of both
      durationSec = Math.round((calculatedDuration + llmDuration) / 2 * 2) / 2;
    }
    
    // Clamp to 3-10 seconds (expanded from 2-4)
    durationSec = Math.max(3, Math.min(10, durationSec));
    
    const startTimeSec = cumulativeTime;
    cumulativeTime += durationSec;
    
    return {
      sentenceIndex,
      visualDescription: String(shot.visualDescription || '').trim() || 'visual',
      searchQuery: String(shot.searchQuery || '').trim() || 'nature',
      durationSec,
      startTimeSec
    };
  });
  
  return shots;
}

export default { generateStoryFromInput, planVisualShots };


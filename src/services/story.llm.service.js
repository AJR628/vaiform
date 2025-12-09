/**
 * LLM service for story generation and visual planning
 */

import { randomUUID } from 'crypto';
import { extractContentFromUrl } from '../utils/link.extract.js';
import { calculateReadingDuration } from '../utils/text.duration.js';

const OPENAI_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const SCRIPT_STYLES = {
  default: 'Write in a clear, conversational tone. Be informative but engaging.',
  hype: 'Write with high energy and excitement. Use strong, punchy language. Create urgency and momentum.',
  cozy: 'Write in a warm, friendly, relaxed tone. Use gentle language. Make it feel personal and comforting.'
};

/**
 * Generate a 4-8 sentence video script from input
 * @param {string} input - User input (link content, idea, or paragraph)
 * @param {string} inputType - 'link' | 'idea' | 'paragraph'
 * @param {string} styleKey - Style key ('default', 'hype', 'cozy')
 * @returns {Promise<{sentences: string[], totalDurationSec: number}>}
 */
export async function generateStoryFromInput({ input, inputType, styleKey = 'default' }) {
  let sourceContent = input;
  
  // Get style instructions
  const styleInstructions = SCRIPT_STYLES[styleKey] || SCRIPT_STYLES.default;
  
  // If link, extract content first
  let extracted = null;
  if (inputType === 'link') {
    try {
      extracted = await extractContentFromUrl(input);
    } catch (error) {
      console.warn('[story.llm] Link extraction failed, using URL as-is:', error?.message);
      extracted = null;
    }
  }
  
  const url = `${OPENAI_BASE}/chat/completions`;
  
  // Build system message with HOOK/BEATS/OUTRO structure
  const systemMessage = [
    'You are a short-form video scriptwriter for vertical video (20–40 seconds).',
    '',
    'Your job is to turn dense content into a punchy, hook-driven VO script that stops scrollers and delivers a single clear transformation.',
    'You will be given structured info about content to turn into a script.',
    '',
    'CRITICAL: Return ONLY valid JSON with this exact shape:',
    '{',
    '  "hook": ["sentence1", "sentence2?"],',
    '  "beats": ["beat1", "beat2", "..."],',
    '  "outro": ["outro1", "outro2?"],',
    '  "totalDurationSec": number',
    '}',
    'No markdown, no extra prose, no explanations. Just JSON.',
    '',
    '=== OVERALL STRUCTURE ===',
    '- Use a Problem → Amplify → Solution micro-story:',
    '  • HOOK: state the problem and amplify the stakes.',
    '  • BEATS: teach 3–5 key points that lead to the solution.',
    '  • OUTRO: lock in the transformation or ask a reflective question.',
    '- Follow the Pyramid Principle:',
    '  • Start from the key message, then support it with 3–5 concrete arguments.',
    '',
    '=== HOOK RULES (first 1–2 sentences) ===',
    '- Exactly 1–2 short sentences.',
    '- Each sentence MUST be 12–18 words or less.',
    '- Speak directly to the viewer using "you" (not "we" or "this video").',
    '- Focus on a specific, relatable problem the viewer actually feels.',
    '- In the first sentence, do ONE of:',
    '  • State the problem in a sharp, concrete way, OR',
    '  • Point out a common mistake or misconception, OR',
    '  • Ask a short "what / how / why" question that creates curiosity.',
    '- In the second sentence, AMPLIFY the stakes: what happens if they never fix this?',
    '- You may optionally mention how quickly they\'ll learn something,',
    '  but avoid repetitive phrases like "in the next 30 seconds".',
    '- Avoid clickbaity exaggerations like "insane", "crazy trick", or "you won\'t believe".',
    '- NEVER use: "in this video", "in this article", "today we\'re going to talk about...", "this content explains...".',
    '',
    '=== BEATS RULES (body sentences) ===',
    '- Each beat is exactly ONE sentence.',
    '- Each sentence MUST be 10–18 words or less.',
    '- No long multi-clause paragraphs; avoid stacked commas and run-ons.',
    '- Use simple, conversational language.',
    '- Use 3–5 beats total.',
    '- Beat 1: Reveal the core surprising idea or fact (the key message).',
    '- At least one beat must use cross-domain synthesis:',
    '  • Explain the idea using an analogy from another domain (sports, physics, games, cooking, etc.).',
    '- At least one beat must present a unique process or solution:',
    '  • A small 2–3 step framework or list of actions the viewer can follow.',
    '- Remaining beats should connect the idea to the viewer\'s real life and consequences.',
    '- Use at least 2–3 concrete details or examples from the source content.',
    '- Avoid vague summaries or meta commentary about "the content" – just speak to the viewer.',
    '',
    '=== OUTRO RULES (final 1–2 sentences) ===',
    '- Exactly 1–2 short sentences.',
    '- Each sentence MUST be 10–18 words or less.',
    '- Choose ONE of the following styles:',
    '  • METAPHOR that simplifies the big idea,',
    '  • SHORT QUOTE that justifies your point (without inventing fake sources),',
    '  • REFRAME that flips how the viewer sees the problem,',
    '  • or a "WHAT / HOW / WHY" QUESTION that makes them think.',
    '- No generic CTAs like "follow for more" unless explicitly requested.',
    '',
    `Target style: ${styleInstructions}`,
    '',
    'Total script should be approximately 60–120 words and feel like 20–40 seconds of VO.',
    'Use ONLY information that could reasonably come from the provided content. Do not invent facts.'
  ].join('\n');
  
  // Build user message based on input type
  let userMessage = '';
  if (inputType === 'link' && extracted) {
    userMessage = [
      'Article information:',
      `- Title: ${extracted.title}`,
      `- Summary: ${extracted.summary}`,
      `- Key Points: ${extracted.keyPoints.join(', ')}`,
      '',
      'Write a short, punchy script following the HOOK/BEATS/OUTRO rules.',
      'Return ONLY valid JSON (no markdown, no explanations).'
    ].join('\n');
  } else if (inputType === 'paragraph') {
    userMessage = [
      'Content:',
      input,
      '',
      'Write a short, punchy script following the HOOK/BEATS/OUTRO rules.',
      'Return ONLY valid JSON (no markdown, no explanations).'
    ].join('\n');
  } else if (inputType === 'idea') {
    userMessage = `Turn this into a 30-45 second vertical video script with a hook, rising tension, payoff, and a clean ending. Each line is one caption/clip:\n\n"${input}"`;
  } else {
    // Fallback for link without extraction
    userMessage = `Now, using this content, write the script in that format:\n\n${sourceContent}`;
  }
  
  const body = {
    model: OPENAI_MODEL,
    temperature: 0.8,
    messages: [
      {
        role: 'system',
        content: systemMessage
      },
      {
        role: 'user',
        content: userMessage
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
  
  // Parse JSON with three-tier fallback
  let parsed = null;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
  } catch (parseError) {
    console.warn('[story.llm] JSON parse failed, using fallback');
    parsed = null;
  }
  
  let sentences = [];
  let totalDurationSec = 0;
  
  // Primary: Try new hook/beats/outro structure
  if (parsed && parsed.hook && Array.isArray(parsed.hook) && parsed.beats && Array.isArray(parsed.beats)) {
    const hook = parsed.hook || [];
    const beats = parsed.beats || [];
    const outro = parsed.outro || [];
    sentences = [...hook, ...beats, ...outro].filter(Boolean);
    totalDurationSec = Number(parsed.totalDurationSec) || 0;
    console.log('[story.llm] using new hook/beats/outro structure');
  }
  // Fallback 1: Legacy sentences structure
  else if (parsed && parsed.sentences && Array.isArray(parsed.sentences)) {
    sentences = parsed.sentences;
    totalDurationSec = Number(parsed.totalDurationSec) || 0;
    console.log('[story.llm] using legacy sentences structure');
  }
  // Fallback 2: Sentence splitting
  else {
    console.log('[story.llm] falling back to sentence-splitting');
    const text = inputType === 'link' && extracted 
      ? `${extracted.title}\n\n${extracted.summary}\n\n${extracted.keyPoints.join('. ')}`
      : input;
    sentences = text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 10 && s.length < 150)
      .slice(0, 8);
    
    if (sentences.length < 4) {
      // Split long sentences
      const words = text.split(/\s+/).filter(w => w.length > 0);
      const wordsPerSentence = Math.ceil(words.length / 5);
      sentences = [];
      for (let i = 0; i < words.length; i += wordsPerSentence) {
        const chunk = words.slice(i, i + wordsPerSentence).join(' ');
        if (chunk.length > 10) sentences.push(chunk);
      }
      sentences = sentences.slice(0, 8);
    }
  }

  // Normalize sentences
  sentences = sentences
    .map(s => String(s).replace(/\s+/g, ' ').trim())
    .filter(s => s.length >= 8 && s.length <= 150)
    .slice(0, 8);

  // Ensure we have 4-8 sentences
  if (sentences.length < 4) {
    // Pad with variations
    while (sentences.length < 4 && sentences.length > 0) {
      sentences.push(sentences[sentences.length - 1]);
    }
  }
  
  // Calculate duration if not provided (estimate 2.5 words per second)
  if (!totalDurationSec || totalDurationSec <= 0) {
    const totalWords = sentences.join(' ').split(/\s+/).length;
    totalDurationSec = Math.max(30, Math.min(45, Math.ceil(totalWords / 2.5)));
  }

  return {
    sentences: sentences.slice(0, 8),
    totalDurationSec: Math.max(30, Math.min(45, totalDurationSec))
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


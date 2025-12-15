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

// Heuristics for framework detection (strong signals only to reduce false positives)
function detectFramework(line) {
  const patterns = [
    /\bdo\b.*\bthen\b.*\bthen\b/i,  // Explicit "Do ... then ... then ..."
    /\bstep\s*1\b|\bstep\s*2\b|\bstep\s*3\b/i,  // Numbered steps
    /\b1\)\s+|\b2\)\s+|\b3\)\s+/,  // Parenthesized numbered list
    /\bdo\s+\w+,\s*then\s+\w+,\s*then\s+\w+/i  // Comma-separated "do X, then Y, then Z"
  ];
  return patterns.some(p => p.test(line));
}

// Heuristics for analogy detection (phrase-based to minimize false positives)
function detectAnalogy(line) {
  const analogyPhrases = /\b(it'?s like|like a|imagine|think of|as if)\b/i;
  return analogyPhrases.test(line);
  // Note: Domain keywords (sports/physics/cooking/games) are not used to avoid
  // false positives on normal lines that mention these domains without analogies.
}

// Validate LLM output against caps (two-tier: hard vs soft)
function validateStoryOutput(hook, beats, outro) {
  // Normalize arrays (handle missing/invalid gracefully)
  const hookArray = Array.isArray(hook) ? hook : [];
  const beatsArray = Array.isArray(beats) ? beats : [];
  const outroArray = Array.isArray(outro) ? outro : [];
  
  const allLines = [...hookArray, ...beatsArray, ...outroArray];
  const totalLines = allLines.length;
  const maxLineLength = Math.max(...allLines.map(l => String(l).length), 0);
  const scriptText = allLines.map(l => String(l)).join('\n');
  const totalChars = scriptText.length; // Includes newlines
  
  // Hard violations (must retry)
  const hardViolations = [];
  
  // Check for missing/invalid arrays or wrong counts
  if (!Array.isArray(hook) || !Array.isArray(beats) || !Array.isArray(outro)) {
    hardViolations.push('Missing or invalid hook/beats/outro arrays');
  }
  if (hookArray.length !== 2) {
    hardViolations.push(`Expected 2 hook strings, got ${hookArray.length}`);
  }
  if (beatsArray.length !== 5) {
    hardViolations.push(`Expected 5 beat strings, got ${beatsArray.length}`);
  }
  if (outroArray.length !== 1) {
    hardViolations.push(`Expected 1 outro string, got ${outroArray.length}`);
  }
  if (totalLines !== 8) {
    hardViolations.push(`Expected 8 lines total, got ${totalLines}`);
  }
  if (maxLineLength > 160) {
    hardViolations.push(`Max line length ${maxLineLength} exceeds 160`);
  }
  if (totalChars > 850) {
    hardViolations.push(`Total chars ${totalChars} exceeds 850`);
  }
  
  // Soft violations (retry once, but allow fallback if persists)
  const softViolations = [];
  const linesOver120 = allLines.filter(l => String(l).length > 120);
  if (linesOver120.length > 0) {
    softViolations.push(`${linesOver120.length} line(s) exceed 120 chars (max: ${Math.max(...linesOver120.map(l => String(l).length))})`);
  }
  
  const beatsUnder90 = beatsArray.filter(b => String(b).length <= 90).length;
  if (beatsUnder90 < 3) {
    softViolations.push(`Only ${beatsUnder90} beat(s) <= 90 chars (need at least 3 for rhythmic variety)`);
  }
  
  // Framework detection
  const frameworkLines = allLines.filter(l => detectFramework(String(l)));
  if (frameworkLines.length === 0) {
    softViolations.push('No framework line detected (need 2-3 step micro-framework)');
  } else if (frameworkLines.length > 1) {
    softViolations.push(`${frameworkLines.length} framework lines detected (should be exactly 1)`);
  }
  
  // Analogy detection
  const analogyLines = allLines.filter(l => detectAnalogy(String(l)));
  if (analogyLines.length === 0) {
    softViolations.push('No analogy line detected (need cross-domain synthesis)');
  } else if (analogyLines.length > 1) {
    softViolations.push(`${analogyLines.length} analogy lines detected (should be exactly 1)`);
  }
  
  // Optional: Check for banned terms
  const bannedHedging = /\b(maybe|kinda|sort of|might|perhaps|possibly|could be)\b/i;
  const bannedMeta = /\b(in this video|this article|today we're going to|this content explains|let me tell you about)\b/i;
  const bannedClickbait = /\b(insane|crazy trick|you won't believe|mind-blowing|game-changing)\b/i;
  
  const linesWithHedging = allLines.filter(l => bannedHedging.test(String(l)));
  const linesWithMeta = allLines.filter(l => bannedMeta.test(String(l)));
  const linesWithClickbait = allLines.filter(l => bannedClickbait.test(String(l)));
  
  if (linesWithHedging.length > 0) {
    softViolations.push(`${linesWithHedging.length} line(s) contain hedging words`);
  }
  if (linesWithMeta.length > 0) {
    softViolations.push(`${linesWithMeta.length} line(s) contain meta phrases`);
  }
  if (linesWithClickbait.length > 0) {
    softViolations.push(`${linesWithClickbait.length} line(s) contain clickbait terms`);
  }
  
  return {
    valid: hardViolations.length === 0,
    hardViolations,
    softViolations,
    stats: {
      totalLines,
      maxLineLength,
      totalChars,
      linesOver120: linesOver120.length,
      beatsUnder90,
      frameworkCount: frameworkLines.length,
      analogyCount: analogyLines.length
    }
  };
}

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
    '  "hook": ["sentence1", "sentence2"],',
    '  "beats": ["beat1", "beat2", "beat3", "beat4", "beat5"],',
    '  "outro": ["outro1"],',
    '  "totalDurationSec": number',
    '}',
    'No markdown, no extra prose, no explanations. Just JSON.',
    '',
    '=== HARD CONSTRAINTS (MUST COMPLY) ===',
    '- You MUST output exactly 8 total strings: hook (2 strings) + beats (5 strings) + outro (1 string) = 8 total.',
    '- Each string MUST be <= 120 characters (hard limit is 160; use 120 as safe buffer).',
    '- Total characters of all 8 strings joined with newline separators must be <= 850.',
    '- Each string is exactly ONE sentence. No semicolons. Minimal commas. Avoid run-ons.',
    '- Before returning JSON, silently verify:',
    '  • Count all strings in hook + beats + outro = exactly 8',
    '  • Each string length <= 120',
    '  • Total characters of all 8 strings joined with newline separators <= 850',
    '- If any check fails, rewrite until compliant. Do not return non-compliant JSON.',
    '',
    '=== OVERALL STRUCTURE (8 Lines) ===',
    '- Lines 1-2 (hook): State the problem and amplify the stakes.',
    '- Lines 3-7 (beats): Teach 5 key points that lead to the solution.',
    '- Line 8 (outro): Lock in the transformation or ask a reflective question.',
    '- Follow the Pyramid Principle: Start from the key message, then support it with concrete arguments.',
    '',
    '=== HOOK RULES (Lines 1-2) ===',
    '- Exactly 2 short sentences.',
    '- Each sentence MUST be 12-18 words AND <= 120 characters.',
    '- Speak directly to the viewer using "you" (not "we" or "this video").',
    '- Line 1: State the problem in a sharp, concrete way, OR point out a common mistake, OR ask a short "what/how/why" question.',
    '- Line 2: AMPLIFY the stakes - what happens if they never fix this?',
    '- You may optionally mention how quickly they\'ll learn something, but avoid repetitive phrases like "in the next 30 seconds".',
    '- NEVER use: "in this video", "in this article", "today we\'re going to talk about...", "this content explains...".',
    '',
    '=== BEATS RULES (Lines 3-7) ===',
    '- Exactly 5 sentences (one per line).',
    '- Each sentence MUST be 10-18 words AND <= 120 characters.',
    '- No long multi-clause paragraphs; avoid stacked commas and run-ons.',
    '- Use simple, conversational language.',
    '- Line 3: Reveal the core surprising idea or fact (the key message).',
    '- Line 4: Present a unique 2-3 step micro-framework or process (e.g., "Do A, then B, then C." or "Step 1: X. Step 2: Y. Step 3: Z.") - keep this line <= 120 chars.',
    '- Line 5: Use cross-domain synthesis - explain the idea using an analogy from another domain (sports, physics, games, cooking, etc.). This is the ONLY analogy line.',
    '- Lines 6-7: Connect the idea to the viewer\'s real life and consequences. Use concrete details or examples from the source content.',
    '- At least 3 of the 5 beats must be <= 90 characters (for rhythmic variety).',
    '- Avoid vague summaries or meta commentary about "the content" – just speak to the viewer.',
    '',
    '=== OUTRO RULES (Line 8) ===',
    '- Exactly 1 short sentence.',
    '- MUST be 10-18 words AND <= 120 characters.',
    '- Choose ONE of the following styles:',
    '  • METAPHOR that simplifies the big idea,',
    '  • SHORT QUOTE that justifies your point (without inventing fake sources),',
    '  • REFRAME that flips how the viewer sees the problem,',
    '  • or a "WHAT / HOW / WHY" QUESTION that makes them think.',
    '- No generic CTAs like "follow for more" unless explicitly requested.',
    '',
    '=== PUNCHINESS RULES ===',
    '- NO hedging words: "maybe", "kinda", "sort of", "might", "perhaps", "possibly", "could be".',
    '- NO meta phrases: "in this video", "this article", "today we\'re going to...", "this content explains...", "let me tell you about...".',
    '- Use direct "you" language. Speak to the viewer, not about content.',
    '- Avoid clickbaity exaggerations: "insane", "crazy trick", "you won\'t believe", "mind-blowing", "game-changing" (unless the content genuinely warrants it).',
    '- Prefer active voice over passive voice.',
    '- Use concrete nouns and verbs. Avoid abstract qualifiers.',
    '',
    `Target style: ${styleInstructions}`,
    '',
    'Aim for ~45–90 words total. Hard character caps above override everything.',
    'Use ONLY information that could reasonably come from the provided content. Do not invent facts.',
    '',
    '=== FINAL CHECKLIST ===',
    'Before returning JSON, verify:',
    '1. hook.length === 2',
    '2. beats.length === 5',
    '3. outro.length === 1',
    '4. All 8 strings are <= 120 characters',
    '5. Total characters of all 8 strings joined with newline separators <= 850',
    '6. At least 3 beats are <= 90 characters',
    '7. Exactly one beat contains a 2-3 step framework',
    '8. Exactly one beat contains an analogy',
    '9. No hedging words, no meta phrases, no clickbait',
    'If any check fails, rewrite and verify again before returning.'
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
  let content = data?.choices?.[0]?.message?.content || '';
  
  // Parse JSON with three-tier fallback
  let parsed = null;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
  } catch (parseError) {
    console.warn('[story.llm] JSON parse failed, using fallback');
    parsed = null;
  }
  
  // Helper function to make retry request
  async function makeRetryRequest(fixMessage, includeAssistantJson = false) {
    const messages = [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage }
    ];
    
    // Include prior assistant JSON only if parsed is valid and has required arrays (tweak A)
    if (includeAssistantJson && parsed && Array.isArray(parsed.hook) && Array.isArray(parsed.beats) && Array.isArray(parsed.outro)) {
      messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
    }
    
    messages.push({ role: 'user', content: fixMessage });
    
    const retryBody = {
      model: OPENAI_MODEL,
      temperature: 0.8,
      messages: messages
    };
    
    const retryR = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(retryBody)
    });
    
    if (!retryR.ok) throw new Error(`LLM_HTTP_${retryR.status}`);
    
    const retryData = await retryR.json();
    return retryData?.choices?.[0]?.message?.content || '';
  }
  
  let sentences = [];
  let totalDurationSec = 0;
  let usedRetry = false;
  
  // Primary: Try new hook/beats/outro structure
  if (parsed && (parsed.hook || parsed.beats || parsed.outro)) {
    const hook = parsed.hook || [];
    const beats = parsed.beats || [];
    const outro = parsed.outro || [];
    
    // Always validate (tweak A: shape validation runs even when arrays are missing)
    const validation = validateStoryOutput(hook, beats, outro);
    
    // Hard violations: retry once with clean fix instruction
    if (validation.hardViolations.length > 0) {
      console.warn('[story.llm] Hard violations detected, retrying:', validation.hardViolations);
      
      const fixMessage = `Your previous JSON violated these constraints: ${validation.hardViolations.join('; ')}. Rewrite JSON only, fully compliant.`;
      
      try {
        const retryContent = await makeRetryRequest(fixMessage, true);
        
        // Re-parse retry response (tweak C: retry response must be used)
        let retryParsed = null;
        try {
          const retryJsonMatch = retryContent.match(/\{[\s\S]*\}/);
          retryParsed = JSON.parse(retryJsonMatch ? retryJsonMatch[0] : retryContent);
        } catch (retryParseError) {
          console.warn('[story.llm] Retry JSON parse failed');
        }
        
        if (retryParsed && (retryParsed.hook || retryParsed.beats || retryParsed.outro)) {
          const retryHook = retryParsed.hook || [];
          const retryBeats = retryParsed.beats || [];
          const retryOutro = retryParsed.outro || [];
          
          // Re-validate retry response
          const retryValidation = validateStoryOutput(retryHook, retryBeats, retryOutro);
          
          if (retryValidation.valid) {
            // Retry passed hard checks, use it (tweak C)
            parsed = retryParsed;
            usedRetry = true;
            console.log('[story.llm] Retry passed validation, using retry response');
          } else {
            console.error('[story.llm] Retry still has hard violations, falling back to normalization:', retryValidation.hardViolations);
          }
        }
      } catch (retryError) {
        console.error('[story.llm] Retry request failed:', retryError?.message);
      }
    }
    
    // If no hard violations (or retry fixed them), check for soft violations
    if (!usedRetry) {
      // Re-validate after potential retry (or if no retry was needed)
      const finalValidation = validateStoryOutput(hook, beats, outro);
      
      // Soft violations: retry once, but allow fallback if persists
      if (finalValidation.softViolations.length > 0 && finalValidation.valid) {
        console.warn('[story.llm] Soft violations detected, retrying:', finalValidation.softViolations);
        
        // Prioritize soft violations (tweak B: must not include undefined)
        const prioritizedSoftViolations = [];
        if (finalValidation.stats.linesOver120 > 0) {
          const found = finalValidation.softViolations.find(v => v.includes('exceed 120'));
          if (found) prioritizedSoftViolations.push(found);
        }
        if (finalValidation.stats.beatsUnder90 < 3) {
          const found = finalValidation.softViolations.find(v => v.includes('<= 90'));
          if (found) prioritizedSoftViolations.push(found);
        }
        if (finalValidation.stats.frameworkCount === 0 || finalValidation.stats.frameworkCount > 1) {
          const found = finalValidation.softViolations.find(v => v.includes('framework'));
          if (found) prioritizedSoftViolations.push(found);
        }
        if (finalValidation.stats.analogyCount === 0 || finalValidation.stats.analogyCount > 1) {
          const found = finalValidation.softViolations.find(v => v.includes('analogy'));
          if (found) prioritizedSoftViolations.push(found);
        }
        // Add remaining banned term violations
        prioritizedSoftViolations.push(...finalValidation.softViolations.filter(v => 
          (v.includes('hedging') || v.includes('meta') || v.includes('clickbait')) && !prioritizedSoftViolations.includes(v)
        ));
        
        const fixMessage = `Your previous JSON had these quality issues: ${prioritizedSoftViolations.join('; ')}. Rewrite JSON only, fully compliant.`;
        
        try {
          const retryContent = await makeRetryRequest(fixMessage, true);
          
          let retryParsed = null;
          try {
            const retryJsonMatch = retryContent.match(/\{[\s\S]*\}/);
            retryParsed = JSON.parse(retryJsonMatch ? retryJsonMatch[0] : retryContent);
          } catch (retryParseError) {
            console.warn('[story.llm] Soft retry JSON parse failed');
          }
          
          if (retryParsed && (retryParsed.hook || retryParsed.beats || retryParsed.outro)) {
            const retryHook = retryParsed.hook || [];
            const retryBeats = retryParsed.beats || [];
            const retryOutro = retryParsed.outro || [];
            
            const retryValidation = validateStoryOutput(retryHook, retryBeats, retryOutro);
            
            if (retryValidation.valid) {
              // Retry passed hard checks, use it
              parsed = retryParsed;
              usedRetry = true;
              console.log('[story.llm] Soft retry passed validation, using retry response');
            } else {
              console.warn('[story.llm] Soft retry still has violations, proceeding with original (soft constraints not met)');
            }
          }
        } catch (retryError) {
          console.warn('[story.llm] Soft retry request failed, proceeding with original:', retryError?.message);
        }
      }
    }
    
    // Extract sentences from parsed (either original or retry)
    const finalHook = parsed.hook || [];
    const finalBeats = parsed.beats || [];
    const finalOutro = parsed.outro || [];
    sentences = [...finalHook, ...finalBeats, ...finalOutro].filter(Boolean);
    totalDurationSec = Number(parsed.totalDurationSec) || 0;
    console.log(usedRetry ? '[story.llm] using retry hook/beats/outro structure' : '[story.llm] using new hook/beats/outro structure');
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


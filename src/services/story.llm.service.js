/**
 * LLM service for story generation and visual planning
 */

import { extractContentFromUrl } from '../utils/link.extract.js';
import { withAbortTimeout } from '../utils/fetch.timeout.js';
import { isOutboundPolicyError } from '../utils/outbound.fetch.js';
import { calculateReadingDuration } from '../utils/text.duration.js';
import logger from '../observability/logger.js';
import { getRuntimeOverride } from '../testing/runtime-overrides.js';
import {
  acquireFinalizeOpenAiAdmission,
  getFinalizeProviderRetryAfterSec,
  releaseFinalizeOpenAiAdmission,
} from './finalize-control.service.js';

const OPENAI_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_RETRY_AFTER_SEC = 15;
const OPENAI_STORY_TIMEOUT_MS = 20_000;
const OPENAI_PLAN_TIMEOUT_MS = 20_000;
const MAX_CONCURRENT_OPENAI_REQUESTS = 2;
const MIN_STORY_DURATION_SEC = 18;
const MAX_STORY_DURATION_SEC = 45;
let activeOpenAiRequests = 0;

const SCRIPT_STYLES = {
  default: 'Write in a clear, conversational tone. Be informative but engaging.',
  hype: 'Write with high energy and excitement. Use strong, punchy language. Create urgency and momentum.',
  cozy: 'Write in a warm, friendly, relaxed tone. Use gentle language. Make it feel personal and comforting.',
};

const GENERIC_TEMPLATE_PATTERNS = [
  /\bstep\s*1\b/i,
  /\bstep\s*2\b/i,
  /\bstep\s*3\b/i,
  /\bin the next 30 seconds\b/i,
  /\bhere'?s why\b/i,
  /\bthink of it like\b/i,
  /\bimagine\b/i,
  /\bit'?s like\b/i,
  /\blike a\b/i,
  /\bin this video\b/i,
  /\bin this article\b/i,
  /\btoday we'?re going to\b/i,
  /\blet me tell you\b/i,
];

function detectGenericTemplatePhrase(line) {
  return GENERIC_TEMPLATE_PATTERNS.some((pattern) => pattern.test(line));
}

// Validate LLM output against caps (two-tier: hard vs soft)
function validateStoryOutput(hook, beats, outro) {
  // Normalize arrays (handle missing/invalid gracefully)
  const hookArray = Array.isArray(hook) ? hook : [];
  const beatsArray = Array.isArray(beats) ? beats : [];
  const outroArray = Array.isArray(outro) ? outro : [];

  const allLines = [...hookArray, ...beatsArray, ...outroArray];
  const totalLines = allLines.length;
  const maxLineLength = Math.max(...allLines.map((l) => String(l).length), 0);
  const scriptText = allLines.map((l) => String(l)).join('\n');
  const totalChars = scriptText.length; // Includes newlines

  // Hard violations (must retry)
  const hardViolations = [];

  // Check for missing/invalid arrays or wrong counts
  if (!Array.isArray(hook) || !Array.isArray(beats) || !Array.isArray(outro)) {
    hardViolations.push('Missing or invalid hook/beats/outro arrays');
  }
  if (hookArray.length < 1 || hookArray.length > 2) {
    hardViolations.push(`Expected 1-2 hook strings, got ${hookArray.length}`);
  }
  if (beatsArray.length < 2 || beatsArray.length > 6) {
    hardViolations.push(`Expected 2-6 beat strings, got ${beatsArray.length}`);
  }
  if (outroArray.length !== 1) {
    hardViolations.push(`Expected 1 outro string, got ${outroArray.length}`);
  }
  if (totalLines < 4 || totalLines > 8) {
    hardViolations.push(`Expected 4-8 lines total, got ${totalLines}`);
  }
  const nonStringLines = allLines.filter((l) => typeof l !== 'string');
  if (nonStringLines.length > 0) {
    hardViolations.push(`${nonStringLines.length} line(s) are not strings`);
  }
  const emptyLines = allLines.filter((l) => String(l).trim().length === 0);
  if (emptyLines.length > 0) {
    hardViolations.push(`${emptyLines.length} empty line(s)`);
  }
  if (maxLineLength > 160) {
    hardViolations.push(`Max line length ${maxLineLength} exceeds 160`);
  }
  if (totalChars > 850) {
    hardViolations.push(`Total chars ${totalChars} exceeds 850`);
  }

  // Soft violations (retry once, but allow fallback if persists)
  const softViolations = [];
  const linesOver120 = allLines.filter((l) => String(l).length > 120);
  if (linesOver120.length > 0) {
    softViolations.push(
      `${linesOver120.length} line(s) exceed 120 chars (max: ${Math.max(...linesOver120.map((l) => String(l).length))})`
    );
  }

  const genericTemplateLines = allLines.filter((l) => detectGenericTemplatePhrase(String(l)));
  if (genericTemplateLines.length > 0) {
    softViolations.push(`${genericTemplateLines.length} line(s) contain generic template phrasing`);
  }

  // Optional: Check for banned terms
  const bannedHedging = /\b(maybe|kinda|sort of|might|perhaps|possibly|could be)\b/i;
  const bannedMeta =
    /\b(in this video|this article|today we're going to|this content explains|let me tell you about)\b/i;
  const bannedClickbait = /\b(insane|crazy trick|you won't believe|mind-blowing|game-changing)\b/i;

  const linesWithHedging = allLines.filter((l) => bannedHedging.test(String(l)));
  const linesWithMeta = allLines.filter((l) => bannedMeta.test(String(l)));
  const linesWithClickbait = allLines.filter((l) => bannedClickbait.test(String(l)));

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
      genericTemplateCount: genericTemplateLines.length,
    },
  };
}

function createRetryableOpenAiError(code, detail, retryAfter = OPENAI_RETRY_AFTER_SEC) {
  const error = new Error(detail);
  error.code = code;
  error.status = 503;
  error.retryAfter = retryAfter;
  return error;
}

async function withOpenAiAdmission({ code, detail, retryAfter = OPENAI_RETRY_AFTER_SEC }, fn) {
  const sharedAdmission = await acquireFinalizeOpenAiAdmission();
  const sharedControlled = sharedAdmission?.bypassed !== true;
  if (sharedControlled && sharedAdmission?.acquired !== true) {
    throw createRetryableOpenAiError(
      code,
      detail,
      getFinalizeProviderRetryAfterSec(sharedAdmission, retryAfter)
    );
  }

  if (activeOpenAiRequests >= MAX_CONCURRENT_OPENAI_REQUESTS) {
    if (sharedControlled) {
      await releaseFinalizeOpenAiAdmission().catch(() => false);
    }
    throw createRetryableOpenAiError(code, detail, retryAfter);
  }

  activeOpenAiRequests += 1;
  try {
    return await fn();
  } finally {
    activeOpenAiRequests -= 1;
    if (sharedControlled) {
      await releaseFinalizeOpenAiAdmission().catch(() => false);
    }
  }
}

async function postOpenAiJson(
  url,
  body,
  {
    timeoutMs,
    timeoutCode,
    timeoutDetail,
    busyCode,
    busyDetail,
    retryAfter = OPENAI_RETRY_AFTER_SEC,
  }
) {
  try {
    const response = await withAbortTimeout(
      async (signal) =>
        await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          ...(signal ? { signal } : {}),
          body: JSON.stringify(body),
        }),
      { timeoutMs, errorMessage: timeoutCode }
    );

    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        throw createRetryableOpenAiError(busyCode, busyDetail, retryAfter);
      }
      throw new Error(`LLM_HTTP_${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (error?.code === timeoutCode) {
      throw createRetryableOpenAiError(timeoutCode, timeoutDetail, retryAfter);
    }
    throw error;
  }
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
      if (isOutboundPolicyError(error) || error?.code === 'LINK_EXTRACT_TOO_LARGE') {
        throw error;
      }
      logger.warn('story.generate.link_extract_failed', {
        inputType,
        error,
      });
      extracted = null;
    }
  }

  const url = `${OPENAI_BASE}/chat/completions`;

  // Build system message with HOOK/BEATS/OUTRO structure
  const systemMessage = [
    'You are a short-form video scriptwriter for vertical video (18-45 seconds).',
    '',
    'Your job is to turn dense content into a punchy, hook-driven VO script that stops scrollers and delivers a single clear transformation.',
    'You will be given structured info about content to turn into a script.',
    '',
    'CRITICAL: Return ONLY valid JSON with this exact shape:',
    '{',
    '  "hook": ["sentence1"],',
    '  "beats": ["beat1", "beat2", "beat3"],',
    '  "outro": ["outro1"],',
    '  "totalDurationSec": number',
    '}',
    'No markdown, no extra prose, no explanations. Just JSON.',
    '',
    '=== HARD CONSTRAINTS (MUST COMPLY) ===',
    '- hook MUST contain 1-2 strings.',
    '- beats MUST contain 2-6 strings.',
    '- outro MUST contain exactly 1 string.',
    '- Total strings across hook + beats + outro MUST be 4-8.',
    '- Each string MUST be one sentence and <= 120 characters when possible.',
    '- Hard line limit is 160 characters.',
    '- Total characters of all strings joined with newline separators must be <= 850.',
    '- Never pad the script just to reach 8 lines.',
    '- Before returning JSON, silently verify the counts and character caps.',
    '- If any hard check fails, rewrite until compliant. Do not return non-compliant JSON.',
    '',
    '=== LENGTH JUDGMENT ===',
    '- 4-5 lines is best for one clear idea.',
    '- 6-7 lines is best for tension, examples, or a useful turn.',
    '- 8 lines is only for dense topics.',
    '- Use fewer lines when the story is simple.',
    '- Leave room for the user to add beats later.',
    '- More lines are allowed only when the content genuinely needs them.',
    '',
    '=== STRUCTURE ===',
    '- Hook: State the problem, surprising idea, or stakes in 1-2 short sentences.',
    '- Beats: Teach the clearest supporting points with concrete source-grounded details.',
    '- Outro: Lock in the transformation, reframe the point, or ask a reflective question.',
    '- Follow the Pyramid Principle: Start from the key message, then support it with concrete arguments.',
    '',
    '=== HOOK RULES ===',
    '- Use 1-2 short sentences.',
    '- Speak directly to the viewer using "you" when natural.',
    '- State a sharp problem, common mistake, surprising fact, or short what/how/why question.',
    '- Avoid repetitive timing and meta phrases like "in the next 30 seconds" or "in this video".',
    '',
    '=== BEATS RULES ===',
    '- Use 2-6 sentences.',
    '- No long multi-clause paragraphs; avoid stacked commas and run-ons.',
    '- Use simple, conversational language.',
    '- Avoid vague summaries or meta commentary about "the content"; speak to the viewer.',
    '- Procedural steps are allowed only when the source is genuinely procedural.',
    '- Analogies are allowed only when they are fresh, specific, and genuinely useful.',
    '',
    '=== OUTRO RULES ===',
    '- Use exactly 1 short sentence.',
    '- Choose a reframe, consequence, clean payoff, or what/how/why question.',
    '- No generic CTAs like "follow for more" unless explicitly requested.',
    '',
    '=== PUNCHINESS RULES ===',
    '- NO hedging words: "maybe", "kinda", "sort of", "might", "perhaps", "possibly", "could be".',
    '- NO meta phrases: "in this video", "this article", "today we\'re going to", "this content explains", "let me tell you".',
    '- Avoid generic template phrases like "Step 1" unless the source is genuinely procedural.',
    '- Avoid default analogy phrases like "think of it like", "imagine", "it\'s like", or "like a" unless the comparison is specific and useful.',
    '- Use direct language, active voice, concrete nouns, and concrete verbs.',
    '- Avoid clickbaity exaggerations: "insane", "crazy trick", "you won\'t believe", "mind-blowing", "game-changing" unless the content genuinely warrants it.',
    '',
    `Target style: ${styleInstructions}`,
    '',
    'Aim for the cleanest script length, usually 45-90 words total. Hard character caps override everything.',
    'Use ONLY information that could reasonably come from the provided content. Do not invent facts.',
    '',
    '=== FINAL CHECKLIST ===',
    'Before returning JSON, verify:',
    '1. hook has 1-2 strings',
    '2. beats has 2-6 strings',
    '3. outro has exactly 1 string',
    '4. Total strings are 4-8',
    '5. Each string targets <= 120 characters and never exceeds 160 characters',
    '6. Total characters joined with newline separators are <= 850',
    '7. No required framework line and no required analogy line',
    '8. No hedging words, generic meta phrases, or unsupported claims',
    'If any hard check fails, rewrite and verify again before returning.',
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
      'Return ONLY valid JSON (no markdown, no explanations).',
    ].join('\n');
  } else if (inputType === 'paragraph') {
    userMessage = [
      'Content:',
      input,
      '',
      'Write a short, punchy script following the HOOK/BEATS/OUTRO rules.',
      'Return ONLY valid JSON (no markdown, no explanations).',
    ].join('\n');
  } else if (inputType === 'idea') {
    userMessage = `Turn this into an 18-45 second vertical video script with a hook, rising tension, payoff, and a clean ending. Use the cleanest 4-8 line shape for the idea, with each line as one caption/clip:\n\n"${input}"`;
  } else {
    // Fallback for link without extraction
    userMessage = `Now, using this content, write the script in that format:\n\n${sourceContent}`;
  }

  return await withOpenAiAdmission(
    {
      code: 'STORY_GENERATE_BUSY',
      detail: 'Story generation is busy. Please retry shortly.',
    },
    async () => {
      const override = getRuntimeOverride('story.llm.generateStoryFromInput');
      if (override) {
        return await override({ input, inputType, styleKey });
      }

      const body = {
        model: OPENAI_MODEL,
        temperature: 0.8,
        messages: [
          {
            role: 'system',
            content: systemMessage,
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
      };

      const data = await postOpenAiJson(url, body, {
        timeoutMs: OPENAI_STORY_TIMEOUT_MS,
        timeoutCode: 'STORY_GENERATE_TIMEOUT',
        timeoutDetail: 'Story generation timed out. Please retry shortly.',
        busyCode: 'STORY_GENERATE_BUSY',
        busyDetail: 'Story generation is busy. Please retry shortly.',
      });
      let content = data?.choices?.[0]?.message?.content || '';

      // Parse JSON with three-tier fallback
      let parsed = null;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
      } catch (parseError) {
        logger.warn('story.generate.parse_failed', {
          inputType,
          error: parseError,
        });
        parsed = null;
      }

      // Helper function to make retry request
      async function makeRetryRequest(fixMessage, includeAssistantJson = false) {
        const messages = [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userMessage },
        ];

        // Include prior assistant JSON only if parsed is valid and has required arrays (tweak A)
        if (
          includeAssistantJson &&
          parsed &&
          Array.isArray(parsed.hook) &&
          Array.isArray(parsed.beats) &&
          Array.isArray(parsed.outro)
        ) {
          messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
        }

        messages.push({ role: 'user', content: fixMessage });

        const retryBody = {
          model: OPENAI_MODEL,
          temperature: 0.8,
          messages: messages,
        };

        const retryData = await postOpenAiJson(url, retryBody, {
          timeoutMs: OPENAI_STORY_TIMEOUT_MS,
          timeoutCode: 'STORY_GENERATE_TIMEOUT',
          timeoutDetail: 'Story generation timed out. Please retry shortly.',
          busyCode: 'STORY_GENERATE_BUSY',
          busyDetail: 'Story generation is busy. Please retry shortly.',
        });
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
          logger.warn('story.generate.hard_retry', {
            hardViolationCount: validation.hardViolations.length,
          });

          const fixMessage = `Your previous JSON violated these constraints: ${validation.hardViolations.join('; ')}. Rewrite JSON only, fully compliant.`;

          try {
            const retryContent = await makeRetryRequest(fixMessage, true);

            // Re-parse retry response (tweak C: retry response must be used)
            let retryParsed = null;
            try {
              const retryJsonMatch = retryContent.match(/\{[\s\S]*\}/);
              retryParsed = JSON.parse(retryJsonMatch ? retryJsonMatch[0] : retryContent);
            } catch (retryParseError) {
              logger.warn('story.generate.retry_parse_failed', {
                error: retryParseError,
              });
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
                logger.info('story.generate.retry_accepted', {
                  hardViolationCount: retryValidation.hardViolations.length,
                });
              } else {
                logger.error('story.generate.retry_rejected', {
                  hardViolationCount: retryValidation.hardViolations.length,
                });
              }
            }
          } catch (retryError) {
            logger.error('story.generate.retry_failed', {
              error: retryError,
            });
          }
        }

        // If no hard violations (or retry fixed them), check for soft violations.
        if (!usedRetry) {
          const currentHook = parsed.hook || [];
          const currentBeats = parsed.beats || [];
          const currentOutro = parsed.outro || [];
          const finalValidation = validateStoryOutput(currentHook, currentBeats, currentOutro);

          // Soft violations: retry once, but allow fallback if persists
          if (finalValidation.softViolations.length > 0 && finalValidation.valid) {
            logger.warn('story.generate.soft_retry', {
              softViolationCount: finalValidation.softViolations.length,
            });

            // Prioritize soft violations (must not include undefined)
            const prioritizedSoftViolations = [];
            if (finalValidation.stats.linesOver120 > 0) {
              const found = finalValidation.softViolations.find((v) => v.includes('exceed 120'));
              if (found) prioritizedSoftViolations.push(found);
            }
            if (finalValidation.stats.genericTemplateCount > 0) {
              const found = finalValidation.softViolations.find((v) =>
                v.includes('generic template')
              );
              if (found) prioritizedSoftViolations.push(found);
            }
            // Add remaining banned term violations
            prioritizedSoftViolations.push(
              ...finalValidation.softViolations.filter(
                (v) =>
                  (v.includes('hedging') ||
                    v.includes('meta') ||
                    v.includes('clickbait') ||
                    v.includes('generic template')) &&
                  !prioritizedSoftViolations.includes(v)
              )
            );

            const qualityIssues =
              prioritizedSoftViolations.length > 0
                ? prioritizedSoftViolations
                : finalValidation.softViolations;
            const fixMessage = `Your previous JSON had these quality issues: ${qualityIssues.join('; ')}. Rewrite JSON only. Keep the same JSON shape, keep 4-8 total lines, do not pad, and avoid generic template phrasing.`;

            try {
              const retryContent = await makeRetryRequest(fixMessage, true);

              let retryParsed = null;
              try {
                const retryJsonMatch = retryContent.match(/\{[\s\S]*\}/);
                retryParsed = JSON.parse(retryJsonMatch ? retryJsonMatch[0] : retryContent);
              } catch (retryParseError) {
                logger.warn('story.generate.soft_retry_parse_failed', {
                  error: retryParseError,
                });
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
                  logger.info('story.generate.soft_retry_accepted', {
                    softViolationCount: retryValidation.softViolations.length,
                  });
                } else {
                  logger.warn('story.generate.soft_retry_rejected', {
                    softViolationCount: retryValidation.softViolations.length,
                  });
                }
              }
            } catch (retryError) {
              logger.warn('story.generate.soft_retry_failed', {
                error: retryError,
              });
            }
          }
        }

        // Extract sentences from parsed (either original or retry) only when hard-valid.
        const finalHook = parsed.hook || [];
        const finalBeats = parsed.beats || [];
        const finalOutro = parsed.outro || [];
        const finalValidation = validateStoryOutput(finalHook, finalBeats, finalOutro);
        if (finalValidation.valid) {
          sentences = [...finalHook, ...finalBeats, ...finalOutro].filter(Boolean);
          totalDurationSec = Number(parsed.totalDurationSec) || 0;
          logger.info('story.generate.output_shape', {
            outputShape: usedRetry ? 'retry_hook_beats_outro' : 'hook_beats_outro',
          });
        } else {
          logger.warn('story.generate.structured_output_rejected', {
            hardViolationCount: finalValidation.hardViolations.length,
          });
        }
      }
      // Fallback 1: Legacy sentences structure
      else if (parsed && parsed.sentences && Array.isArray(parsed.sentences)) {
        sentences = parsed.sentences;
        totalDurationSec = Number(parsed.totalDurationSec) || 0;
        logger.info('story.generate.output_shape', {
          outputShape: 'legacy_sentences',
        });
      }
      // Fallback 2: Source-derived sentence splitting
      if (sentences.length === 0) {
        logger.warn('story.generate.output_shape_fallback', {
          outputShape: 'sentence_split',
        });
        const text =
          inputType === 'link' && extracted
            ? `${extracted.title}\n\n${extracted.summary}\n\n${extracted.keyPoints.join('. ')}`
            : input;
        sentences = text
          .split(/[.!?]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 10 && s.length < 150)
          .slice(0, 8);

        if (sentences.length < 4) {
          // Split long sentences
          const words = text.split(/\s+/).filter((w) => w.length > 0);
          const wordsPerSentence = Math.ceil(words.length / 5);
          sentences = [];
          const step = Math.max(wordsPerSentence, 1);
          for (let i = 0; i < words.length; i += step) {
            const chunk = words.slice(i, i + wordsPerSentence).join(' ');
            if (chunk.length > 10) sentences.push(chunk);
          }
          sentences = sentences.slice(0, 8);
        }
      }

      // Normalize sentences
      sentences = sentences
        .map((s) => String(s).replace(/\s+/g, ' ').trim())
        .filter((s) => s.length >= 8 && s.length <= 150)
        .slice(0, 8);

      // Require 4-8 usable sentences. Do not duplicate lines to pad invalid output.
      if (sentences.length < 4) {
        throw new Error('STORY_OUTPUT_INVALID');
      }

      // Calculate duration if not provided (estimate 2.5 words per second)
      if (!totalDurationSec || totalDurationSec <= 0) {
        const totalWords = sentences.join(' ').split(/\s+/).length;
        totalDurationSec = Math.max(
          MIN_STORY_DURATION_SEC,
          Math.min(MAX_STORY_DURATION_SEC, Math.ceil(totalWords / 2.5))
        );
      }

      return {
        sentences: sentences.slice(0, 8),
        totalDurationSec: Math.max(
          MIN_STORY_DURATION_SEC,
          Math.min(MAX_STORY_DURATION_SEC, totalDurationSec)
        ),
      };
    }
  );
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

  return await withOpenAiAdmission(
    {
      code: 'STORY_PLAN_BUSY',
      detail: 'Story planning is busy. Please retry shortly.',
    },
    async () => {
      const override = getRuntimeOverride('story.llm.planVisualShots');
      if (override) {
        return await override({ sentences });
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
              'Total duration should match the story length. Longer sentences should have longer durations.',
            ].join(' '),
          },
          {
            role: 'user',
            content: `Plan visual shots for these sentences:\n${sentences.map((s, i) => `${i}: ${s}`).join('\n')}`,
          },
        ],
      };

      const data = await postOpenAiJson(url, body, {
        timeoutMs: OPENAI_PLAN_TIMEOUT_MS,
        timeoutCode: 'STORY_PLAN_TIMEOUT',
        timeoutDetail: 'Story planning timed out. Please retry shortly.',
        busyCode: 'STORY_PLAN_BUSY',
        busyDetail: 'Story planning is busy. Please retry shortly.',
      });
      const content = data?.choices?.[0]?.message?.content || '';

      // Parse JSON
      let parsed = null;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
      } catch (parseError) {
        logger.warn('story.plan.parse_failed', {
          error: parseError,
        });
        parsed = null;
      }

      // Validate and normalize
      let shots = Array.isArray(parsed?.shots) ? parsed.shots : [];

      // Fallback: generate basic plan
      if (shots.length === 0 || shots.length !== sentences.length) {
        shots = sentences.map((sentence, index) => {
          // Extract key words for search
          const words = sentence
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter((w) => w.length > 3)
            .slice(0, 3);

          // Calculate duration based on sentence text length
          const durationSec = calculateReadingDuration(sentence);

          return {
            sentenceIndex: index,
            visualDescription: words.join(' ') || 'abstract',
            searchQuery: words.slice(0, 2).join(' ') || 'nature',
            durationSec,
            startTimeSec: 0,
          };
        });
      }

      // Calculate start times and normalize durations
      let cumulativeTime = 0;
      shots = shots.map((shot, index) => {
        const parsedSentenceIndex = Number(shot.sentenceIndex);
        const sentenceIndex = Number.isFinite(parsedSentenceIndex) ? parsedSentenceIndex : index;
        const sentence = sentences[sentenceIndex] || sentences[index] || '';

        // Calculate duration from text, but respect LLM-provided duration if reasonable
        const llmDuration = Number(shot.durationSec) || 0;
        const calculatedDuration = calculateReadingDuration(sentence);

        // Use calculated duration, but if LLM provided a value in reasonable range, prefer it
        let durationSec = calculatedDuration;
        if (llmDuration >= 3 && llmDuration <= 10) {
          // LLM provided reasonable duration, use average of both
          durationSec = Math.round(((calculatedDuration + llmDuration) / 2) * 2) / 2;
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
          startTimeSec,
        };
      });

      return shots;
    }
  );
}

export default { generateStoryFromInput, planVisualShots };

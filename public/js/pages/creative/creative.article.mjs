/**
 * Article-only entry: minimal helpers + bootstrap + Article block.
 * No legacy quote/asset/tts/live-preview code.
 */

        // --- Caption sizing constants (HOISTED) ---
        const UI_MIN_PX = 48;     // slider min visual (increased to prevent text disappearing)
        const UI_MID_PX = 72;     // slider mid visual (more reasonable middle)
        const UI_MAX_PX = 120;    // slider max visual (capped to prevent overflow)
        const API_MIN_PX = 32;    // backend clamp lower bound
        const API_MAX_PX = 120;   // backend clamp upper bound (match server ABS_MAX_FONT)

        // --- Caption size mapping (define BEFORE any usage)
        function mapSliderToPx(sliderVal) {
          // non-linear map slider value to pixel range, then clamp to API bounds
          const raw = Number(sliderVal);
          
          if (!isFinite(raw)) {
            return API_MIN_PX + (API_MAX_PX - API_MIN_PX) / 2; // fallback to middle
          }
          
          const v = Math.max(0, Math.min(100, raw));
          const t = v / 100;
          // Non-linear mapping: size = 32 + (120-32)*Math.pow(t,0.6)
          const size = API_MIN_PX + (API_MAX_PX - API_MIN_PX) * Math.pow(t, 0.6);
          
          return Math.max(API_MIN_PX, Math.min(API_MAX_PX, Math.round(size)));
        }

        function getCaptionPx() {
            const el = document.getElementById('caption-size');
            return mapSliderToPx(el ? el.value : 50);
        }

        // expose for other code
        window.getCaptionPx = getCaptionPx;
        window.__captionSizeMapping = { mapSliderToPx, API_MIN_PX, API_MAX_PX, UI_MIN_PX, UI_MID_PX, UI_MAX_PX };

        // No-op for Article-only (no overlay/quote)
        function queueCaptionOverlayRefresh() {}

        function showError(elementId, message) {
            const element = document.getElementById(elementId);
            if (!element) {
                if (message) console.warn('[showError] Target missing:', elementId, message);
                return;
            }
            element.textContent = message;
            element.classList.remove('hidden');
        }

        function hideError(elementId) {
            const element = document.getElementById(elementId);
            if (!element) return;
            element.classList.add('hidden');
        }

        function showBlockingError(title, msg) {
            alert(`${title}\n\n${msg}`);
        }

        function showToast(message, durationMs = 3000) {
            // Create toast element if it doesn't exist
            let toastEl = document.getElementById('article-toast');
            if (!toastEl) {
                toastEl = document.createElement('div');
                toastEl.id = 'article-toast';
                toastEl.className = 'fixed bottom-5 left-1/2 transform -translate-x-1/2 bg-gray-900 dark:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm shadow-lg z-50 hidden';
                document.body.appendChild(toastEl);
            }
            toastEl.textContent = message;
            toastEl.classList.remove('hidden');
            setTimeout(() => {
                toastEl.classList.add('hidden');
            }, durationMs);
        }

        // Show free limit reached modal with upgrade option
        function showFreeLimitModal() {
            // Create modal if it doesn't exist
            let modal = document.getElementById('free-limit-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'free-limit-modal';
                modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
                modal.innerHTML = `
                    <div class="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md mx-4 shadow-xl">
                        <h2 class="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">Free Limit Reached</h2>
                        <p class="text-gray-700 dark:text-gray-300 mb-6">You've used your 4 free shorts. Upgrade to keep creating unlimited shorts.</p>
                        <div class="flex gap-3">
                            <a href="/pricing.html" class="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-center font-semibold">View Plans</a>
                            <button onclick="document.getElementById('free-limit-modal').remove()" class="flex-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-4 py-2 rounded hover:bg-gray-300 dark:hover:bg-gray-600 font-semibold">Close</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }
            modal.style.display = 'flex';
            
            // Close on outside click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });
        }

        function showAuthRequiredModal() {
            // Create modal if it doesn't exist
            let modal = document.getElementById('auth-required-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'auth-required-modal';
                modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
                modal.innerHTML = `
                    <div class="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md mx-4 shadow-xl">
                        <h2 class="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">Sign In Required</h2>
                        <p class="text-gray-700 dark:text-gray-300 mb-6">You need to sign in to create shorts. Sign up for free to get started!</p>
                        <div class="flex gap-3">
                            <a href="/plans.html#free" class="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-center font-semibold">Sign up free</a>
                            <button onclick="document.getElementById('auth-required-modal').remove()" class="flex-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-4 py-2 rounded hover:bg-gray-300 dark:hover:bg-gray-600 font-semibold">Close</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }
            modal.style.display = 'flex';
            
            // Close on outside click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });
        }

        function setLoading(buttonId, loading) {
            const button = document.getElementById(buttonId);
            button.disabled = loading;
            button.textContent = loading ? 'Loading...' : button.textContent.replace('Loading...', '');
        }

        // URL detection helper
        function isUrl(text) {
            if (!text || typeof text !== 'string') return false;
            const trimmed = text.trim();
            try {
                const url = new URL(trimmed);
                return url.protocol === 'http:' || url.protocol === 'https:';
            } catch {
                // Check if it looks like a URL even if URL constructor fails
                return /^https?:\/\/.+/.test(trimmed);
            }
        }

        // Initialize caption size UI (safe DOM ready wrapper)
        function initCaptionSizeUI(){
          const el = document.getElementById('caption-size');
          const label = document.getElementById('size-value');
          if (!el || !label) return;
          
          function update() {
            try {
              const px = getCaptionPx(); // use the hoisted function
            label.textContent = `${px}px`;
              // refresh preview overlay without blocking rest of UI
              queueCaptionOverlayRefresh();
              // also update other caption style values
              if (typeof updateCaptionStyleValues === 'function') {
                updateCaptionStyleValues();
              }
            } catch (err) {
              console.error('[caption-size] update failed:', err);
            }
          }

          el.addEventListener('input', update);
          update(); // initial paint
        }
        
        /**
         * Actively load DejaVu Sans variants using Font Loading API
         * Returns true if all variants are ready, false if timeout/failure
         */
        async function ensureDejaVuVariantsReady(timeoutMs = 3000) {
          // Wait for font set to be ready first
          try { await document.fonts.ready; } catch {}

          // Explicitly request each face we care about
          const descriptors = [
            '16px "DejaVu Sans"',
            'bold 16px "DejaVu Sans"',
            'italic 16px "DejaVu Sans"',
            'italic bold 16px "DejaVu Sans"',
          ];

          // Actively load them (Chrome/Firefox/Safari support)
          const loadAll = Promise.all(descriptors.map(d => document.fonts.load(d)));

          // Optional timeout so we don't hang the UI forever
          await Promise.race([
            loadAll,
            new Promise((_, reject) => setTimeout(() => reject(new Error('font-load-timeout')), timeoutMs))
          ]).catch(err => {
            console.warn('[fonts] load() did not fully resolve:', err);
          });

          // Final check (now it should pass)
          const ok = descriptors.every(d => document.fonts.check(d));
          if (!ok) console.warn('[fonts] check() still false for some faces');
          return ok;
        }
        
        // --- robust page bootstrap (run after DOM is ready)
        // Wire Apply Caption Settings button
        document.addEventListener('DOMContentLoaded', () => {
            const applyBtn = document.getElementById('apply-caption-style-btn');
            if (applyBtn) {
                applyBtn.addEventListener('click', applyCaptionStyle);
            }
        });
        
        // Article-only bootstrap (no quote/asset/overlay init)
        document.addEventListener('DOMContentLoaded', async () => {
          const safe = (label, fn) => { try { fn && fn(); } catch (e) { console.error(`[init] ${label} failed`, e); } };
          if (document.fonts) {
            await ensureDejaVuVariantsReady(3000);
          }
          safe('caption-size', () => (typeof initCaptionSizeUI === 'function') && initCaptionSizeUI());
          if (!window.currentStorySessionId) {
            if (!window.draftStoryboard) {
              window.draftStoryboard = { beats: [{ id: generateBeatId(), text: '', selectedClip: null }] };
            }
            renderDraftStoryboard();
            updateRenderArticleButtonState();
          }
        });

        // Move Caption Style section below storyboard when DOM is ready
        // Isolated listener ensures it runs even if main DOMContentLoaded handler throws
        document.addEventListener('DOMContentLoaded', function ensureCaptionStyleMounted() {
            try {
                const mount = document.getElementById('caption-style-mount');
                const section = document.getElementById('caption-style-section');
                
                if (!mount || !section) {
                    console.warn('[caption-style] Mount point or section not found');
                    return;
                }
                
                // Only move if not already in mount (avoid duplicate moves)
                if (section.parentElement !== mount) {
                    // Remove inline display:none (section will inherit visibility from storyboard)
                    section.style.display = '';
                    mount.appendChild(section);
                    console.log('[caption-style] Moved Caption Style section below storyboard');
                }
            } catch (e) {
                console.error('[caption-style] Failed to move section:', e);
                // Non-fatal: section remains in original location, just hidden
            }
        });
        // Article mode constants
        const MAX_BEATS = 8;
        const MAX_BEAT_CHARS = 160;
        const MAX_TOTAL_CHARS = 850;
        const NEW_BEAT_PLACEHOLDER = '[New beat]';

        // Phase 0: Helper to detect placeholder text
        function isPlaceholderText(text) {
            if (!text || typeof text !== 'string') return true;
            const trimmed = text.trim();
            return trimmed === '' || 
                   trimmed === 'Add textâ€¦' || 
                   trimmed === 'Add text' ||
                   trimmed.toLowerCase() === 'add textâ€¦';
        }

        // Phase 0: Helper to check if beat is valid (has both text and clip)
        function isValidBeat(beat) {
            if (!beat) return false;
            const hasText = beat.text && !isPlaceholderText(beat.text);
            const hasClip = beat.selectedClip && beat.selectedClip.url;
            return hasText && hasClip;
        }

        // Phase 1: Generate stable ID for beats
        function generateBeatId() {
            return 'beat-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        }

        // Normalize script text into beats with caps
        function normalizeScript(originalText) {
            let didSplitLongBeat = false;
            let didTruncateBeats = false;
            
            // Split by newlines, trim, drop empty
            let beats = originalText.split('\n')
                .map(s => s.trim())
                .filter(s => s.length > 0);
            
            // Split long beats
            const splitBeats = [];
            for (const beat of beats) {
                if (beat.length > MAX_BEAT_CHARS) {
                    didSplitLongBeat = true;
                    // Try splitting by sentence boundaries first
                    const sentences = beat.split(/([.!?]+)/).filter(s => s.trim().length > 0);
                    const grouped = [];
                    let current = '';
                    
                    for (let i = 0; i < sentences.length; i++) {
                        const test = current + sentences[i];
                        if (test.length <= MAX_BEAT_CHARS) {
                            current = test;
                        } else {
                            if (current) grouped.push(current.trim());
                            current = sentences[i];
                        }
                    }
                    if (current) grouped.push(current.trim());
                    
                    // If still too long, split by comma/space
                    const finalSplit = [];
                    for (const part of grouped) {
                        if (part.length <= MAX_BEAT_CHARS) {
                            finalSplit.push(part);
                        } else {
                            // Split by comma, then space
                            const commaParts = part.split(',').map(s => s.trim()).filter(s => s.length > 0);
                            for (const commaPart of commaParts) {
                                if (commaPart.length <= MAX_BEAT_CHARS) {
                                    finalSplit.push(commaPart);
                                } else {
                                    // Split by space
                                    const words = commaPart.split(/\s+/);
                                    let line = '';
                                    for (const word of words) {
                                        const test = line ? line + ' ' + word : word;
                                        if (test.length <= MAX_BEAT_CHARS) {
                                            line = test;
                                        } else {
                                            if (line) finalSplit.push(line);
                                            line = word;
                                        }
                                    }
                                    if (line) finalSplit.push(line);
                                }
                            }
                        }
                    }
                    splitBeats.push(...finalSplit);
                } else {
                    splitBeats.push(beat);
                }
            }
            
            beats = splitBeats;
            
            // Truncate to max beats
            if (beats.length > MAX_BEATS) {
                didTruncateBeats = true;
                beats = beats.slice(0, MAX_BEATS);
            }
            
            // Enforce total char limit (truncate last beat if needed)
            const normalizedText = beats.join('\n');
            if (normalizedText.length > MAX_TOTAL_CHARS) {
                const lastBeat = beats[beats.length - 1];
                const allowedLength = MAX_TOTAL_CHARS - (beats.slice(0, -1).join('\n').length + 1); // +1 for newline
                beats[beats.length - 1] = lastBeat.substring(0, Math.max(0, allowedLength)).trim();
                didTruncateBeats = true;
            }
            
            const finalNormalizedText = beats.join('\n');
            const originalLength = originalText.length;
            const trimmedChars = Math.max(0, originalLength - finalNormalizedText.length);
            
            return {
                normalizedBeats: beats,
                trimmedChars,
                didSplitLongBeat,
                didTruncateBeats
            };
        }
        
        // Update script preview counters
        function updateScriptCounters() {
            const textarea = document.getElementById('article-script-preview');
            const countersEl = document.getElementById('script-preview-counters');
            if (!textarea || !countersEl) return;
            
            const text = textarea.value;
            const beats = text.split('\n')
                .map(s => s.trim())
                .filter(s => s.length > 0);
            const totalChars = text.length;
            
            countersEl.textContent = `Beats: ${beats.length} / ${MAX_BEATS} | Total: ${totalChars} / ${MAX_TOTAL_CHARS}`;
            
            // Update button state (only disable if empty)
            const prepareBtn = document.getElementById('prepare-storyboard-btn');
            if (prepareBtn) {
                prepareBtn.disabled = beats.length === 0;
            }
        }
        
        // Beat Editor functions (Phase 1: Mirror mode)
        let currentViewMode = 'raw'; // 'raw' or 'beats'
        
        // Phase 2: Raw draft tracking
        window.rawDraftText = '';
        window.rawDirty = false;
        window.pendingBeatParseResult = null;
        
        // Sync textarea from beats array (with guard to prevent input handler firing)
        function syncTextareaFromBeats(beats) {
            const textarea = document.getElementById('article-script-preview');
            if (!textarea) return;
            
            // Set guard flag to prevent input handler from firing
            window._syncingTextarea = true;
            
            // Join beats with newlines (matching current semantics)
            const text = beats.map(b => typeof b === 'string' ? b : b.text).join('\n');
            textarea.value = text;
            
            // Reset guard flag after a brief delay to ensure input event doesn't fire
            setTimeout(() => {
                window._syncingTextarea = false;
            }, 0);
            
            // Update counters
            updateScriptCounters();
        }
        
        // Parse textarea into beats array (exact newline semantics)
        function parseBeatsFromTextarea(text) {
            return text.split('\n')
                .map(s => s.trim())
                .filter(s => s.length > 0)
                .map((text, idx) => ({ id: `beat-${idx}`, text }));
        }
        
        // Phase 2: Check if applying beats will change the raw text
        function willApplyChangeText(rawText) {
            // Use normalizeScript() as the authority to determine if changes will occur
            const { normalizedBeats, trimmedChars, didSplitLongBeat, didTruncateBeats } = normalizeScript(rawText);
            const normalizedText = normalizedBeats.join('\n');
            
            // Compare original (after basic parse) vs normalized
            const originalBeats = rawText.split('\n')
                .map(s => s.trim())
                .filter(s => s.length > 0);
            const originalText = originalBeats.join('\n');
            
            // Check for meaningful changes (beat count, truncation, splitting)
            const hasMeaningfulChange = 
                normalizedBeats.length !== originalBeats.length ||
                didSplitLongBeat ||
                didTruncateBeats;
            
            // Check if only whitespace trimming changed (not meaningful)
            const onlyWhitespaceChange = !hasMeaningfulChange && 
                normalizedText !== originalText &&
                normalizedBeats.length === originalBeats.length &&
                normalizedBeats.every((beat, idx) => beat === originalBeats[idx].trim());
            
            // Show banner only for meaningful changes, not whitespace-only
            const willChange = hasMeaningfulChange || (!onlyWhitespaceChange && normalizedText !== originalText);
            
            return {
                willChange,
                normalizedBeats,
                normalizedText,
                originalBeats,
                originalText,
                trimmedChars,
                didSplitLongBeat,
                didTruncateBeats,
                onlyWhitespaceChange,
                stats: {
                    originalBeats: originalBeats.length,
                    normalizedBeats: normalizedBeats.length,
                    originalChars: originalText.length,
                    normalizedChars: normalizedText.length
                }
            };
        }
        
        // Phase 2: Show confirm UI for applying beats
        function showApplyConfirmDialog(parseResult, onApply, onCancel) {
            // Remove any existing confirm UI
            const existing = document.getElementById('beat-apply-confirm');
            if (existing) {
                existing.remove();
            }
            
            const scriptSection = document.getElementById('article-script-section');
            if (!scriptSection) return;
            
            const confirmBanner = document.createElement('div');
            confirmBanner.id = 'beat-apply-confirm';
            confirmBanner.className = 'p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded mb-2';
            
            const { stats, didSplitLongBeat, didTruncateBeats, trimmedChars } = parseResult;
            
            let changesList = [];
            if (stats.originalBeats !== stats.normalizedBeats) {
                changesList.push(`${stats.originalBeats} â†’ ${stats.normalizedBeats} beats`);
            }
            if (didSplitLongBeat) {
                changesList.push('long beats will be split');
            }
            if (didTruncateBeats) {
                changesList.push('beats will be truncated');
            }
            if (trimmedChars > 0) {
                changesList.push(`${trimmedChars} characters will be trimmed`);
            }
            
            const changesText = changesList.length > 0 
                ? `Changes: ${changesList.join(', ')}.`
                : 'Your script will be adjusted to fit limits.';
            
            confirmBanner.innerHTML = `
                <div class="text-sm text-yellow-800 dark:text-yellow-200 mb-2">
                    <strong>Applying Beats will adjust your script to fit limits.</strong>
                </div>
                <div class="text-xs text-yellow-700 dark:text-yellow-300 mb-3">
                    ${changesText}
                    <br>Limits: max 8 beats, 160 chars/beat, 850 total chars.
                </div>
                <div class="flex gap-2">
                    <button
                        id="beat-apply-confirm-btn"
                        class="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded"
                    >
                        Apply & Switch
                    </button>
                    <button
                        id="beat-apply-cancel-btn"
                        class="px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded"
                    >
                        Cancel
                    </button>
                </div>
            `;
            
            // Insert before textarea
            const textarea = document.getElementById('article-script-preview');
            if (textarea && textarea.parentNode) {
                textarea.parentNode.insertBefore(confirmBanner, textarea);
            } else {
                scriptSection.appendChild(confirmBanner);
            }
            
            // Wire up buttons
            const applyBtn = confirmBanner.querySelector('#beat-apply-confirm-btn');
            const cancelBtn = confirmBanner.querySelector('#beat-apply-cancel-btn');
            
            if (applyBtn) {
                applyBtn.addEventListener('click', () => {
                    confirmBanner.remove();
                    onApply();
                });
            }
            
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    confirmBanner.remove();
                    onCancel();
                });
            }
        }
        
        // Render beat editor from current textarea value
        function renderBeatEditor() {
            const beatEditor = document.getElementById('beat-editor');
            const beatList = document.getElementById('beat-list');
            const addBeatBtn = document.getElementById('add-beat-btn');
            const countersEl = document.getElementById('beat-editor-counters');
            const textarea = document.getElementById('article-script-preview');
            
            if (!beatEditor || !beatList || !textarea) return;
            
            // Parse beats from textarea
            const beats = parseBeatsFromTextarea(textarea.value);
            
            // Clear existing beats
            beatList.innerHTML = '';
            
            // Render each beat
            beats.forEach((beat, idx) => {
                const beatRow = document.createElement('div');
                beatRow.className = 'beat-row flex items-start gap-2 p-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded';
                beatRow.dataset.beatId = beat.id;
                
                // Beat number badge
                const badge = document.createElement('div');
                badge.className = 'flex-shrink-0 w-8 h-8 flex items-center justify-center bg-blue-600 text-white text-xs font-semibold rounded';
                badge.textContent = String(idx + 1).padStart(2, '0');
                
                // Beat input container
                const inputContainer = document.createElement('div');
                inputContainer.className = 'flex-1 flex flex-col gap-1';
                
                // Beat text input
                const input = document.createElement('input');
                input.type = 'text';
                input.value = beat.text;
                input.setAttribute('data-role', 'beat-input');
                input.dataset.beatId = beat.id; // Stable identifier for session mode mapping
                input.className = 'w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm text-gray-900 dark:text-white';
                input.style.wordWrap = 'break-word';
                input.style.whiteSpace = 'normal';
                
                // Character counter
                const charCounter = document.createElement('div');
                charCounter.className = 'text-xs text-gray-500 dark:text-gray-400';
                const charCount = beat.text.length;
                const isOverLimit = charCount > MAX_BEAT_CHARS;
                charCounter.textContent = `${charCount}/160`;
                if (isOverLimit) {
                    charCounter.className = 'text-xs text-orange-500 dark:text-orange-400';
                }
                
                // Prevent Enter key and commit on Enter
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        // Commit: trigger update with filtering and commit flag
                        const newValue = input.value;
                        updateBeatInTextarea(beat.id, newValue, true, true); // filterEmpties=true, commit=true
                        // Blur to signal save
                        input.blur();
                    }
                });
                
                // Sanitize paste (replace newlines with spaces)
                input.addEventListener('paste', (e) => {
                    e.preventDefault();
                    const pastedText = (e.clipboardData || window.clipboardData).getData('text');
                    const sanitized = pastedText.replace(/[\r\n]+/g, ' ');
                    const start = input.selectionStart;
                    const end = input.selectionEnd;
                    const currentValue = input.value;
                    const newValue = currentValue.substring(0, start) + sanitized + currentValue.substring(end);
                    input.value = newValue;
                    
                    // Update char counter
                    const newCharCount = newValue.length;
                    charCounter.textContent = `${newCharCount}/160`;
                    if (newCharCount > MAX_BEAT_CHARS) {
                        charCounter.className = 'text-xs text-orange-500 dark:text-orange-400';
                    } else {
                        charCounter.className = 'text-xs text-gray-500 dark:text-gray-400';
                    }
                    
                    // Sync to textarea (don't filter empties on paste, don't commit)
                    updateBeatInTextarea(beat.id, newValue, false, false); // filterEmpties=false, commit=false
                });
                
                // Update on input
                input.addEventListener('input', () => {
                    const newValue = input.value;
                    
                    // Update char counter
                    const newCharCount = newValue.length;
                    charCounter.textContent = `${newCharCount}/160`;
                    if (newCharCount > MAX_BEAT_CHARS) {
                        charCounter.className = 'text-xs text-orange-500 dark:text-orange-400';
                    } else {
                        charCounter.className = 'text-xs text-gray-500 dark:text-gray-400';
                    }
                    
                    // Sync to textarea (don't filter empties on input - preserve what user is typing, don't commit)
                    updateBeatInTextarea(beat.id, newValue, false, false); // filterEmpties=false, commit=false
                });
                
                // Commit on blur (filter empties, commit)
                input.addEventListener('blur', () => {
                    const newValue = input.value;
                    updateBeatInTextarea(beat.id, newValue, true, true); // filterEmpties=true, commit=true
                });
                
                inputContainer.appendChild(input);
                inputContainer.appendChild(charCounter);
                
                beatRow.appendChild(badge);
                beatRow.appendChild(inputContainer);
                beatList.appendChild(beatRow);
            });
            
            // Auto-focus last beat input if it contains placeholder (newly added)
            const lastBeatRow = beatList.querySelector('.beat-row:last-child');
            if (lastBeatRow) {
                const lastInput = lastBeatRow.querySelector('[data-role="beat-input"]');
                if (lastInput && lastInput.value.trim() === NEW_BEAT_PLACEHOLDER) {
                    // Focus and select placeholder text for easy replacement
                    lastInput.focus();
                    lastInput.select();
                }
            }
            
            // Update add beat button state
            if (addBeatBtn) {
                addBeatBtn.disabled = beats.length >= MAX_BEATS;
            }
            
            // Update beat editor counters
            if (countersEl) {
                const totalChars = beats.reduce((sum, b) => sum + b.text.length, 0);
                countersEl.textContent = `Beats: ${beats.length} / ${MAX_BEATS} | Total: ${totalChars} / ${MAX_TOTAL_CHARS}`;
            }
        }
        
        // Update a specific beat in the textarea
        function updateBeatInTextarea(beatId, newText, filterEmpties = false, commit = false) {
            const beatList = document.getElementById('beat-list');
            if (!beatList) return;
            
            // âœ… Session mode: Update via API only on commit, preserve sentenceIndex alignment
            if (window.currentStorySession && window.currentStorySessionId) {
                // If not committing, just sync textarea for Raw view consistency (no API, no renderStoryboard)
                if (!commit) {
                    // Option 2: Sync textarea from current beat inputs (guarded, no API call)
                    const beatRows = Array.from(beatList.querySelectorAll('.beat-row'));
                    const beats = beatRows.map(row => {
                        const input = row.querySelector('[data-role="beat-input"]');
                        return input ? input.value : '';
                    });
                    syncTextareaFromBeats(beats);
                    return; // Early return - don't run pre-storyboard path
                }
                
                // Commit path: Update via API, preserve sentenceIndex alignment
                // Trim text (match commitBeatTextEdit behavior)
                const trimmedText = (newText || "").trim();
                
                // Block empty text commits in session mode (prevent beat deletion)
                // Only enforce when committing (allow empty temporarily while typing)
                if (!trimmedText) {
                    showToast('Cannot clear beat text after storyboard is created. Use storyboard card to edit or delete beats.');
                    return;
                }
                
                // Find sentenceIndex by locating the beat row containing this beatId
                const beatRows = Array.from(beatList.querySelectorAll('.beat-row'));
                let sentenceIndex = -1;
                
                for (let i = 0; i < beatRows.length; i++) {
                    const input = beatRows[i].querySelector('[data-role="beat-input"][data-beat-id="' + beatId + '"]');
                    if (input) {
                        sentenceIndex = i;
                        break;
                    }
                }
                
                // Validate sentenceIndex
                if (sentenceIndex < 0 || sentenceIndex >= window.currentStorySession.story.sentences.length) {
                    console.error('[beat-editor] Could not map beatId to sentenceIndex:', { beatId, sentenceIndex, sessionSentencesCount: window.currentStorySession.story.sentences.length });
                    showToast('Could not update beat. Please refresh the page.');
                    return;
                }
                
                // Commit text update using same API as commitBeatTextEdit()
                handleBeatEditorCommitInSessionMode(sentenceIndex, trimmedText);
                return; // Early return - don't run pre-storyboard path
            }
            
            // Pre-storyboard mode: Existing behavior (filter empties, sync textarea)
            // Collect all beat values in order (use .beat-row selector for safety)
            const beatRows = Array.from(beatList.querySelectorAll('.beat-row'));
            let beats = beatRows.map(row => {
                const input = row.querySelector('[data-role="beat-input"]');
                return input ? input.value : '';
            });
            
            // Only filter empty beats if explicitly requested (on commit)
            if (filterEmpties) {
                beats = beats.map(text => text.trim()).filter(text => text.length > 0);
            }
            
            // Sync to textarea (guarded)
            syncTextareaFromBeats(beats);
            
            // Only re-render if filtering empties (commit) to update numbering and button state
            if (filterEmpties && currentViewMode === 'beats') {
                renderBeatEditor();
            }
        }
        
        // Handle beat editor commit in session mode (reuses commitBeatTextEdit logic)
        async function handleBeatEditorCommitInSessionMode(sentenceIndex, text) {
            try {
                const { apiFetch } = await import('/api.mjs');
                
                const resp = await apiFetch('/story/update-beat-text', {
                    method: 'POST',
                    body: {
                        sessionId: window.currentStorySessionId,
                        sentenceIndex: sentenceIndex,
                        text: text,
                    }
                });
                
                if (!resp.success) {
                    console.error("[beat-editor] Update beat failed:", resp);
                    showToast(resp.detail || "Failed to update beat");
                    return;
                }
                
                const { sentences, shots } = resp.data;
                
                // Keep session in sync (match commitBeatTextEdit behavior)
                if (!window.currentStorySession.story) {
                    window.currentStorySession.story = {};
                }
                window.currentStorySession.story.sentences = sentences;
                window.currentStorySession.shots = shots;
                
                console.log(
                    "[beat-editor] Update beat: sentenceIndex=%d, newText=%s",
                    sentenceIndex,
                    text.slice(0, 80)
                );
                
                // Re-render storyboard from canonical data
                await renderStoryboard(window.currentStorySession);
                updateRenderArticleButtonState();
                
                // Sync textarea from returned sentences (guarded, won't trigger input handler)
                syncTextareaFromBeats(sentences);
                
                // Re-render beat editor to keep Beat View consistent
                if (currentViewMode === 'beats') {
                    renderBeatEditor();
                }
                
                // Trigger debounced preview (behind feature flag) - schedule after DOM update
                if (window.BEAT_PREVIEW_ENABLED) {
                    // explicitStyle: ONLY user/session overrides (empty object if none)
                    const rawStyle = window.currentStorySession.overlayCaption || window.currentStorySession.captionStyle || {};
                    requestAnimationFrame(async () => {
                        const { extractStyleOnly } = await import('/js/caption-style-helper.js');
                        const explicitStyle = extractStyleOnly(rawStyle);
                        const m = window.__beatPreviewModule || await window.__beatPreviewModulePromise;
                        if (m) {
                            // Pass numeric sentenceIndex directly (matches session.story.sentences[i])
                            m.generateBeatCaptionPreviewDebounced(sentenceIndex, text, explicitStyle);
                        }
                    });
                }
            } catch (err) {
                console.error("[beat-editor] Update beat error:", err);
                showToast("Could not update beat. Please try again.");
            }
        }
        
        // Toggle between Raw and Beat views (Phase 2: with Apply semantics)
        function toggleViewMode() {
            const textarea = document.getElementById('article-script-preview');
            const beatEditor = document.getElementById('beat-editor');
            const toggleBtn = document.getElementById('toggle-view-btn');
            
            if (!textarea || !beatEditor || !toggleBtn) return;
            
            if (currentViewMode === 'raw') {
                // Phase 2: Check if switching Raw â†’ Beats will change the text
                const rawText = window.rawDirty ? window.rawDraftText : textarea.value;
                const parseResult = willApplyChangeText(rawText);
                
                if (parseResult.willChange) {
                    // Show confirm UI
                    window.pendingBeatParseResult = parseResult;
                    showApplyConfirmDialog(parseResult, () => {
                        // Apply: Update textarea with normalized text
                        window._syncingTextarea = true;
                        textarea.value = parseResult.normalizedText;
                        setTimeout(() => {
                            window._syncingTextarea = false;
                        }, 0);
                        
                        // Update counters
                        updateScriptCounters();
                        
                        // Clear dirty state
                        window.rawDirty = false;
                        window.rawDraftText = textarea.value;
                        window.pendingBeatParseResult = null;
                        
                        // Switch to Beat view
                        currentViewMode = 'beats';
                        textarea.classList.add('hidden');
                        beatEditor.classList.remove('hidden');
                        const countersEl = document.getElementById('script-preview-counters');
                        if (countersEl) countersEl.classList.add('hidden');
                        toggleBtn.textContent = 'Raw';
                        
                        // Render beats from normalized textarea value
                        renderBeatEditor();
                    }, () => {
                        // Cancel: Do nothing, stay in Raw view
                        window.pendingBeatParseResult = null;
                    });
                } else {
                    // No changes needed, switch immediately
                    currentViewMode = 'beats';
                    textarea.classList.add('hidden');
                    beatEditor.classList.remove('hidden');
                    const countersEl = document.getElementById('script-preview-counters');
                    if (countersEl) countersEl.classList.add('hidden');
                    toggleBtn.textContent = 'Raw';
                    
                    // Clear dirty state
                    window.rawDirty = false;
                    window.rawDraftText = '';
                    
                    // Render beats from current textarea value
                    renderBeatEditor();
                }
            } else {
                // Switch to Raw view (always immediate)
                currentViewMode = 'raw';
                textarea.classList.remove('hidden');
                beatEditor.classList.add('hidden');
                const countersEl = document.getElementById('script-preview-counters');
                if (countersEl) countersEl.classList.remove('hidden');
                toggleBtn.textContent = 'Beat View';
                
                // Clear any pending confirm UI
                const existing = document.getElementById('beat-apply-confirm');
                if (existing) {
                    existing.remove();
                }
                window.pendingBeatParseResult = null;
                
                // Textarea is already up to date (beats sync to it on every edit)
            }
        }
        
        // Handle add beat button
        function handleAddBeat() {
            const textarea = document.getElementById('article-script-preview');
            const addBeatBtn = document.getElementById('add-beat-btn');
            
            if (!textarea) {
                return;
            }
            
            // Check if at max beats
            const currentBeats = parseBeatsFromTextarea(textarea.value);
            
            if (currentBeats.length >= MAX_BEATS) {
                return; // Button should be disabled, but guard anyway
            }
            
            // Add placeholder beat (non-empty so it creates visible row)
            const currentValue = textarea.value.trim();
            let newValue;
            if (currentValue.length === 0) {
                // Empty textarea: set placeholder directly
                newValue = NEW_BEAT_PLACEHOLDER;
            } else {
                // Append newline + placeholder (ensure exactly one newline boundary)
                const needsNewline = !currentValue.endsWith('\n');
                newValue = currentValue + (needsNewline ? '\n' : '') + NEW_BEAT_PLACEHOLDER;
            }
            
            // Set guard flag
            window._syncingTextarea = true;
            textarea.value = newValue;
            setTimeout(() => {
                window._syncingTextarea = false;
            }, 0);
            
            // Update counters
            updateScriptCounters();
            
            // Re-render beat editor if in beat view
            if (currentViewMode === 'beats') {
                renderBeatEditor();
            }
        }
        
        // Wire up Beat Editor event listeners
        (function() {
            // Wait for DOM to be ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    const toggleBtn = document.getElementById('toggle-view-btn');
                    const addBeatBtn = document.getElementById('add-beat-btn');
                    
                    if (toggleBtn) {
                        toggleBtn.addEventListener('click', toggleViewMode);
                    }
                    if (addBeatBtn) {
                        addBeatBtn.addEventListener('click', handleAddBeat);
                    }
                });
            } else {
                // DOM already ready
                const toggleBtn = document.getElementById('toggle-view-btn');
                const addBeatBtn = document.getElementById('add-beat-btn');
                
                if (toggleBtn) {
                    toggleBtn.addEventListener('click', toggleViewMode);
                }
                if (addBeatBtn) {
                    addBeatBtn.addEventListener('click', handleAddBeat);
                }
            }
        })();
        
        // Article mode functions
        async function summarizeArticle() {
            const inputEl = document.getElementById('article-input');
            const errorEl = document.getElementById('article-error');
            const scriptPreviewEl = document.getElementById('article-script-preview');
            const summarizeBtn = document.getElementById('summarize-article-btn');
            
            if (!inputEl || !scriptPreviewEl) {
                console.error('[article] Missing required elements');
                return;
            }
            
            const inputText = inputEl.value.trim();
            if (!inputText) {
                showError('article-error', 'Please paste an article link or text');
                return;
            }
            
            setLoading('summarize-article-btn', true);
            hideError('article-error');
            
            try {
                const { apiFetch } = await import('/api.mjs');
                
                // Detect if input is URL or text
                const inputType = isUrl(inputText) ? 'link' : 'paragraph';
                
                // Read style from dropdown
                const styleKey = document.getElementById('article-style-select')?.value || 'default';
                
                // Step 1: Create story session
                const startResp = await apiFetch('/story/start', {
                    method: 'POST',
                    body: {
                        input: inputText,
                        inputType: inputType,
                        styleKey: styleKey
                    }
                });
                
                if (!startResp.success || !startResp.data?.id) {
                    throw new Error(startResp.error || 'Failed to create story session');
                }
                
                const sessionId = startResp.data.id;
                window.currentStorySessionId = sessionId; // Reuse existing global
                
                // Step 2: Generate story
                const generateResp = await apiFetch('/story/generate', {
                    method: 'POST',
                    body: {
                        sessionId: sessionId
                    }
                });
                
                if (!generateResp.success) {
                    if (generateResp.error === 'AUTH_REQUIRED') {
                        showAuthRequiredModal();
                        return;
                    }
                    if (generateResp.error === 'FREE_LIMIT_REACHED') {
                        showFreeLimitModal();
                        return;
                    }
                    throw new Error(generateResp.error || generateResp.message || 'Failed to generate story');
                }
                
                if (!generateResp.data?.story?.sentences) {
                    throw new Error('Failed to generate story');
                }
                
                // Display sentences in script preview (one per line)
                const sentences = generateResp.data.story.sentences;
                const scriptText = Array.isArray(sentences) ? sentences.join('\n') : String(sentences);
                
                // Set guard flag to prevent input handler from firing
                window._syncingTextarea = true;
                scriptPreviewEl.value = scriptText;
                setTimeout(() => {
                    window._syncingTextarea = false;
                }, 0);
                
                // Phase 2: Clear raw draft state
                window.rawDirty = false;
                window.rawDraftText = '';
                
                // Phase 2: Remove any pending confirm banner
                const existingBanner = document.getElementById('beat-apply-confirm');
                if (existingBanner) {
                    existingBanner.remove();
                }
                window.pendingBeatParseResult = null;
                
                // Store original sentences to detect edits
                window.currentStoryOriginalSentences = Array.isArray(sentences) ? [...sentences] : [String(sentences)];
                
                // Set script source flag
                window.scriptSource = 'llm';
                
                // Update counters
                updateScriptCounters();
                
                // If in beat view, render beat editor
                if (currentViewMode === 'beats') {
                    renderBeatEditor();
                }
                
                console.log('[article] Story generated successfully:', sentences.length, 'sentences');
                
            } catch (error) {
                console.error('[article] Summarize failed:', error);
                showError('article-error', error.message || 'Failed to summarize article');
            } finally {
                setLoading('summarize-article-btn', false);
            }
        }
        
        /**
         * Preserve client caption overrides only if server session doesn't have them.
         * Server is SSOT - only carry forward client overrides when server has nothing meaningful.
         * @param {object} nextSession - Session object from server
         * @param {object} prevSession - Previous window.currentStorySession (may be null)
         */
        function preserveCaptionOverrides(nextSession, prevSession) {
            // CRITICAL: Only preserve if same session (prevent style bleed)
            if (!prevSession || nextSession?.id !== prevSession?.id) {
                return; // Different session - don't preserve
            }
            
            const hasOwn = Object.prototype.hasOwnProperty;
            for (const key of ['overlayCaption', 'captionStyle']) {
                const nextHasNonEmpty =
                    hasOwn.call(nextSession || {}, key) &&
                    nextSession[key] &&
                    Object.keys(nextSession[key]).length > 0;

                const prevHasNonEmpty =
                    prevSession &&
                    prevSession[key] &&
                    Object.keys(prevSession[key]).length > 0;

                // Server wins if it has a non-empty object; otherwise carry forward client overrides.
                if (!nextHasNonEmpty && prevHasNonEmpty) {
                    nextSession[key] = prevSession[key];
                }
            }
        }
        
        /**
         * Apply caption style settings to current session
         * Extracts style-only fields from UI and POSTs to server
         */
        async function applyCaptionStyle() {
            try {
                // Ensure session exists
                if (!window.currentStorySession || !window.currentStorySession.id) {
                    showToast("No active session. Please create or load a story first.");
                    return;
                }
                
                const sessionId = window.currentStorySession.id;
                
                // Build raw style from UI controls (reuse existing captionStyle builder logic)
                const sizePx = 54; // Default - will be overridden by server SSOT
                const opacityPct = parseInt(document.getElementById('caption-opacity')?.value || '85', 10);
                const placement = (document.getElementById('caption-placement')?.value || 'bottom').toLowerCase();
                const selectedWeight = document.getElementById('caption-weight')?.value || 'bold';
                
                const placementToServerFormat = (uiPlacement) => {
                    const mapping = {
                        'top': { placement: 'top', yPct: 0.10 },
                        'middle': { placement: 'center', yPct: 0.50 },
                        'bottom': { placement: 'bottom', yPct: 0.90 }
                    };
                    return mapping[uiPlacement] || mapping['bottom'];
                };
                
                const placementData = placementToServerFormat(placement);
                
                const fontMapping = {
                    'system': { family: 'DejaVu Sans', weightCss: 'normal' },
                    'bold': { family: 'DejaVu Sans', weightCss: 'bold' },
                    'cinematic': { family: 'DejaVu Sans', weightCss: 'bold' },
                    'minimal': { family: 'DejaVu Sans', weightCss: 'normal' }
                };
                
                const selectedFont = document.getElementById('caption-font')?.value || 'system';
                const fontConfig = fontMapping[selectedFont] || fontMapping['system'];
                
                const rawStyle = {
                    fontFamily: fontConfig.family,
                    weightCss: fontConfig.weightCss,
                    fontPx: sizePx,
                    color: "#FFFFFF",
                    opacity: opacityPct / 100,
                    placement: placementData.placement,
                    yPct: placementData.yPct
                };
                
                // Extract style-only fields (safety guard)
                const { extractStyleOnly } = await import('/js/caption-style-helper.js');
                const styleOnly = extractStyleOnly(rawStyle);
                
                // Avoid writing empty objects
                if (Object.keys(styleOnly).length === 0) {
                    showToast("No caption style settings to save.");
                    return;
                }
                
                // POST to server
                const { apiFetch } = await import('/api.mjs');
                const response = await apiFetch('/story/update-caption-style', {
                    method: 'POST',
                    body: {
                        sessionId,
                        overlayCaption: styleOnly
                    }
                });
                
                if (!response.success) {
                    throw new Error(response.error || response.detail || 'Failed to update caption style');
                }
                
                // Update local session object (optimistic update)
                if (response.data && response.data.overlayCaption) {
                    window.currentStorySession.overlayCaption = response.data.overlayCaption;
                }
                
                showToast("Caption settings applied successfully!");
                
                // Refresh beat previews with new style
                if (window.BEAT_PREVIEW_ENABLED && window.currentStorySession) {
                    const sentences = window.currentStorySession.story?.sentences || [];
                    if (sentences.length > 0) {
                        const explicitStyle = window.currentStorySession.overlayCaption || window.currentStorySession.captionStyle || {};
                        const { extractStyleOnly: extractStyleOnlyRefresh } = await import('/js/caption-style-helper.js');
                        const safeStyle = extractStyleOnlyRefresh(explicitStyle);
                        BeatPreviewManager.applyAllPreviews(sentences, safeStyle);
                    }
                }
            } catch (err) {
                console.error("[apply-caption-style] error:", err);
                showToast("Failed to apply caption settings. Please try again.");
            }
        }
        
        async function prepareStoryboard() {
            const scriptPreviewEl = document.getElementById('article-script-preview');
            const prepareBtn = document.getElementById('prepare-storyboard-btn');
            const storyboardEl = document.getElementById('storyboard');
            const scriptSection = document.getElementById('article-script-section');
            
            if (!scriptPreviewEl || !prepareBtn) {
                console.error('[article] Missing required elements');
                return;
            }
            
            // Check if storyboard is dirty and show confirm if needed
            const dirty = isStoryboardDirty();
            if (dirty) {
                const confirmed = window.confirm("Auto-fill will replace your current storyboard and overwrite any manual changes. Continue?");
                if (!confirmed) {
                    return;
                }
            }
            
            setLoading('prepare-storyboard-btn', true);
            hideError('article-error');
            
            try {
                const { apiFetch } = await import('/api.mjs');
                
                // Explicit priority order
                const sessionId = window.currentStorySessionId;
                const scriptSource = window.scriptSource;
                const scriptText = scriptPreviewEl.value.trim();
                
                // Priority 1: LLM + Session
                if (scriptSource === 'llm' && sessionId) {
                    // Keep existing LLM flow unchanged
                    const currentSentences = scriptText.split('\n')
                        .map(s => s.trim())
                        .filter(s => s.length > 0);
                    
                    if (currentSentences.length === 0) {
                        throw new Error('Script is empty');
                    }
                    
                    // Validate no placeholder beats before proceeding
                    const hasPlaceholder = currentSentences.some(s => s.trim() === NEW_BEAT_PLACEHOLDER);
                    if (hasPlaceholder) {
                        setLoading('prepare-storyboard-btn', false);
                        showToast(`Replace or delete the '${NEW_BEAT_PLACEHOLDER}' placeholder before building storyboard.`, 5000);
                        return;
                    }
                    
                    // Check if script was edited
                    const originalSentences = window.currentStoryOriginalSentences || [];
                    const sentencesChanged = originalSentences.length !== currentSentences.length ||
                        originalSentences.some((s, i) => s !== currentSentences[i]);
                    
                    // Update script if changed
                    if (sentencesChanged) {
                        console.log('[article] Script was edited, updating...');
                        const updateResp = await apiFetch('/story/update-script', {
                            method: 'POST',
                            body: {
                                sessionId: sessionId,
                                sentences: currentSentences
                            }
                        });
                        
                        if (!updateResp.success) {
                            throw new Error(updateResp.error || 'Failed to update script');
                        }
                        
                        // Update stored original
                        window.currentStoryOriginalSentences = [...currentSentences];
                    }
                    
                    // Step 1: Plan shots
                    const planResp = await apiFetch('/story/plan', {
                        method: 'POST',
                        body: { sessionId: sessionId }
                    });
                    
                    if (!planResp.success) {
                        throw new Error(planResp.error || 'Failed to plan shots');
                    }
                    
                    // Step 2: Search clips
                    const searchResp = await apiFetch('/story/search', {
                        method: 'POST',
                        body: { sessionId: sessionId }
                    });
                    
                    if (!searchResp.success) {
                        throw new Error(searchResp.error || 'Failed to search clips');
                    }
                    
                    const session = searchResp.data;
                    
                    // Preserve client caption overrides if server doesn't have them
                    const prev = window.currentStorySession;
                    preserveCaptionOverrides(session, prev);
                    
                    // Store session for clip picker access
                    window.currentStorySession = session;
                    
                    // Render storyboard
                    await renderStoryboard(session);
                    
                    // Clear draft state (session is now source of truth)
                    // Phase 1: Reset to 1 empty beat
                    window.draftStoryboard = { beats: [{ id: generateBeatId(), text: '', selectedClip: null }] };
                    
                    // Update render button state (session now exists)
                    updateRenderArticleButtonState();
                    
                    console.log('[article] Storyboard prepared successfully');
                    return;
                }
                
                // Priority 2: Manual Script (textarea has text)
                if (scriptText.length > 0) {
                    // Validate no placeholder beats before normalization
                    const rawLines = scriptText.split('\n').map(s => s.trim()).filter(s => s.length > 0);
                    const hasPlaceholder = rawLines.some(s => s === NEW_BEAT_PLACEHOLDER);
                    if (hasPlaceholder) {
                        setLoading('prepare-storyboard-btn', false);
                        showToast(`Replace or delete the '${NEW_BEAT_PLACEHOLDER}' placeholder before building storyboard.`, 5000);
                        return;
                    }
                    
                    // Get original text before normalization
                    const originalText = scriptText;
                    
                    // Normalize script
                    const { normalizedBeats, trimmedChars, didSplitLongBeat, didTruncateBeats } = normalizeScript(originalText);
                    
                    // Write normalized beats back into textarea (guarded)
                    const normalizedText = normalizedBeats.join('\n');
                    window._syncingTextarea = true;
                    scriptPreviewEl.value = normalizedText;
                    setTimeout(() => {
                        window._syncingTextarea = false;
                    }, 0);
                    
                    // Update counters
                    updateScriptCounters();
                    
                    // Show toast if normalization occurred
                    if (trimmedChars > 0 || didSplitLongBeat || didTruncateBeats) {
                        let message = 'Auto-formatted: ';
                        if (trimmedChars > 0) {
                            message += `trimmed ${trimmedChars} characters `;
                        }
                        message += 'to fit the max length (8 beats / 850 chars for <1 minute).';
                        showToast(message);
                    }
                    
                    // Validate
                    if (normalizedBeats.length === 0) {
                        throw new Error('Script is empty after normalization');
                    }
                    
                    // Call manual endpoint
                    const manualResp = await apiFetch('/story/manual', {
                        method: 'POST',
                        body: {
                            scriptText: normalizedText
                        }
                    });
                    
                    if (!manualResp.success) {
                        throw new Error(manualResp.error || 'Failed to create manual story session');
                    }
                    
                    const newSessionId = manualResp.data.sessionId;
                    window.currentStorySessionId = newSessionId;
                    window.scriptSource = 'llm'; // Session now exists, treat as LLM path
                    
                    // Store original sentences
                    window.currentStoryOriginalSentences = [...normalizedBeats];
                    
                    // Step 1: Plan shots
                    const planResp = await apiFetch('/story/plan', {
                        method: 'POST',
                        body: { sessionId: newSessionId }
                    });
                    
                    if (!planResp.success) {
                        throw new Error(planResp.error || 'Failed to plan shots');
                    }
                    
                    // Step 2: Search clips
                    const searchResp = await apiFetch('/story/search', {
                        method: 'POST',
                        body: { sessionId: newSessionId }
                    });
                    
                    if (!searchResp.success) {
                        throw new Error(searchResp.error || 'Failed to search clips');
                    }
                    
                    const session = searchResp.data;
                    
                    // Preserve client caption overrides if server doesn't have them
                    const prev = window.currentStorySession;
                    preserveCaptionOverrides(session, prev);
                    
                    // Store session for clip picker access
                    window.currentStorySession = session;
                    
                    // Render storyboard
                    await renderStoryboard(session);
                    
                    // Clear draft state (session is now source of truth)
                    // Phase 1: Reset to 1 empty beat
                    window.draftStoryboard = { beats: [{ id: generateBeatId(), text: '', selectedClip: null }] };
                    
                    // Update render button state (session now exists)
                    updateRenderArticleButtonState();
                    
                    console.log('[article] Storyboard prepared successfully (manual mode)');
                    return;
                }
                
                // Priority 3: Empty
                showError('article-error', 'Please enter a script or summarize an article first');
                return;
                
            } catch (error) {
                console.error('[article] Prepare storyboard failed:', error);
                showError('article-error', error.message || 'Failed to prepare storyboard');
            } finally {
                setLoading('prepare-storyboard-btn', false);
            }
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        // Beat preview manager (behind feature flag)
        const BeatPreviewManager = {
            /**
             * Apply preview to beat card
             * @param {HTMLElement} beatCardEl - Beat card DOM element
             * @param {number} beatIndex - Beat index in story.sentences array (numeric, required for SSOT)
             * @param {string} text - Beat text
             * @param {object} style - Session-level caption style
             */
            async applyPreview(beatCardEl, beatIndex, text, style) {
                if (!window.BEAT_PREVIEW_ENABLED) return;
                
                try {
                    const { generateBeatCaptionPreview } = await import('/js/caption-preview.js');
                    // beatIndex must be numeric (matches session.story.sentences[i])
                    const numericBeatIndex = typeof beatIndex === 'number' ? beatIndex :
                        (typeof beatIndex === 'string' && /^\d+$/.test(beatIndex) ? parseInt(beatIndex, 10) : null);
                    const result = await generateBeatCaptionPreview(numericBeatIndex ?? beatIndex, text, style);
                    
                    if (!result || !result.rasterUrl) return;
                    
                    // Find or create overlay img element
                    let overlayImg = beatCardEl.querySelector('.beat-caption-overlay');
                    if (!overlayImg) {
                        overlayImg = document.createElement('img');
                        overlayImg.className = 'beat-caption-overlay';
                        // Insert into video container (first .relative element)
                        const videoContainer = beatCardEl.querySelector('.relative.w-full.h-40');
                        if (videoContainer) {
                            videoContainer.appendChild(overlayImg);
                        } else {
                            beatCardEl.appendChild(overlayImg);
                        }
                    }
                    
                    // Set CSS variables for positioning
                    const meta = result.meta;
                    const yPct = Math.max(0, Math.min(1, meta.yPx_png / meta.frameH));
                    const rasterWRatio = meta.rasterW / meta.frameW;
                    const rasterHRatio = meta.rasterH / meta.frameH;
                    
                    overlayImg.style.setProperty('--y-pct', yPct);
                    overlayImg.style.setProperty('--raster-w-ratio', rasterWRatio);
                    overlayImg.style.setProperty('--raster-h-ratio', rasterHRatio);
                    
                    // Set image source
                    overlayImg.src = result.rasterUrl;
                    overlayImg.style.display = 'block';
                } catch (err) {
                    if (window.__parityAudit || window.__parityDebug) {
                        console.warn('[beat-preview] Failed to apply preview:', err);
                    }
                    // Graceful degradation - don't block UI
                }
            },
            
            /**
             * Apply previews to all beats in storyboard
             */
            async applyAllPreviews(beats, style) {
                if (!window.BEAT_PREVIEW_ENABLED) return;
                
                for (let idx = 0; idx < beats.length; idx++) {
                    const beat = beats[idx];
                    // Handle both draft beats (object with id/text) and session sentences (string)
                    const beatId = beat.id || beat.sentenceIndex || idx;
                    const text = beat.text || (typeof beat === 'string' ? beat : '');
                    // beatIndex must be numeric array index (matches session.story.sentences[i])
                    const beatIndex = typeof beat.sentenceIndex === 'number' ? beat.sentenceIndex : idx;
                    const beatCardEl = document.querySelector(`[data-beat-id="${beatId}"]`) || 
                                      document.querySelector(`[data-sentence-index="${idx}"]`);
                    if (beatCardEl && text) {
                        // Pass numeric beatIndex (matches session.story.sentences[i])
                        await BeatPreviewManager.applyPreview(beatCardEl, beatIndex, text, style);
                    }
                }
            }
        };
        
        // Feature flag (default true)
        if (typeof window.BEAT_PREVIEW_ENABLED === 'undefined') {
            window.BEAT_PREVIEW_ENABLED = true;  // Enable by default
        }
        
        // Preload caption-preview module at boot (deterministic init)
        window.__beatPreviewModulePromise = import('/js/caption-preview.js')
            .then(m => (window.__beatPreviewModule = m, m))
            .catch(err => (console.warn('[beat-preview] Module load failed:', err), null));
        
        // Optional debug exposure (only if flag is set)
        if (window.__beatPreviewDebug === true) {
            window.BeatPreviewManager = BeatPreviewManager;
        }
        
        async function renderStoryboard(session) {
            const storyboardRow = document.getElementById('storyboard-row');
            const storyboardEl = document.getElementById('storyboard');
            
            if (!storyboardRow || !storyboardEl) {
                console.error('[article] Storyboard elements not found');
                return;
            }
            
            // Clear existing cards
            storyboardRow.innerHTML = '';
            
            const sentences = session.story?.sentences || [];
            const shots = session.shots || [];
            
            // Guard: handle mismatched counts gracefully
            if (sentences.length !== shots.length) {
                console.warn(`[article] Mismatched counts: ${sentences.length} sentences, ${shots.length} shots`);
            }
            
            sentences.forEach((sentence, idx) => {
                // Find matching shot by sentenceIndex
                const shot = shots.find(s => s.sentenceIndex === idx) || shots[idx];
                
                const card = document.createElement('div');
                card.className = 'beat-card relative w-40 h-[420px] flex-shrink-0 bg-black rounded-lg overflow-hidden border border-gray-700';
                card.setAttribute('data-sentence-index', idx);
                
                if (!shot || !shot.selectedClip) {
                    // Placeholder for missing clip
                    card.innerHTML = `
                        <div class="relative w-full h-40 beat-video-container bg-gray-800 flex items-center justify-center">
                            <p class="text-xs text-gray-400 text-center px-2">No clip found</p>
                            <div class="beat-controls">
                                <button
                                    class="delete-beat-btn absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs flex items-center justify-center z-50"
                                    data-sentence-index="${idx}"
                                    title="Delete beat"
                                >âœ•</button>
                            </div>
                        </div>
                        <div 
                            class="beat-text p-2 text-xs text-gray-200 h-24 overflow-hidden cursor-text"
                            data-sentence-index="${idx}"
                            title="Click to edit"
                        >
                            ${escapeHtml(sentence)}
                        </div>
                        <button
                            class="swap-clip-btn mt-1 mx-2 mb-2 w-[calc(100%-1rem)] text-xs py-1 rounded bg-slate-700 hover:bg-slate-600 text-white"
                            data-sentence-index="${idx}"
                        >
                            Swap clip
                        </button>
                    `;
                } else {
                    const clip = shot.selectedClip;
                    const videoUrl = clip.url || '';
                    const thumbUrl = clip.thumbUrl || '';
                    
                    card.innerHTML = `
                        <div class="relative w-full h-40 beat-video-container overflow-hidden">
                            <video
                                src="${videoUrl}"
                                ${thumbUrl ? `poster="${thumbUrl}"` : ''}
                                muted
                                loop
                                preload="none"
                                class="w-full h-full object-cover transition-transform duration-150 storyboard-video"
                                data-index="${idx}"
                                aria-label="Preview for: ${sentence.substring(0, 50)}"
                            ></video>
                            <div class="beat-controls">
                                <button
                                    class="delete-beat-btn absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs flex items-center justify-center z-50"
                                    data-sentence-index="${idx}"
                                    title="Delete beat"
                                >âœ•</button>
                            </div>
                        </div>
                        <div 
                            class="beat-text p-2 text-xs text-gray-200 h-24 overflow-hidden cursor-text"
                            data-sentence-index="${idx}"
                            title="Click to edit"
                        >
                            ${escapeHtml(sentence)}
                        </div>
                        <button
                            class="swap-clip-btn mt-1 mx-2 mb-2 w-[calc(100%-1rem)] text-xs py-1 rounded bg-slate-700 hover:bg-slate-600 text-white"
                            data-sentence-index="${idx}"
                        >
                            Swap clip
                        </button>
                    `;
                }
                
                storyboardRow.appendChild(card);
                
                // Add "Add beat" button after each card
                const addBtn = document.createElement('button');
                addBtn.className = 'add-beat-btn mx-2 flex-shrink-0';
                addBtn.setAttribute('data-insert-after-index', idx);
                addBtn.setAttribute('title', 'Add clip');
                addBtn.textContent = '+';
                storyboardRow.appendChild(addBtn);
            });
            
            // Add final "Add beat" button after the last card
            if (sentences.length > 0) {
                const finalAddBtn = document.createElement('button');
                finalAddBtn.className = 'add-beat-btn mx-2 flex-shrink-0';
                finalAddBtn.setAttribute('data-insert-after-index', sentences.length - 1);
                finalAddBtn.setAttribute('title', 'Add clip');
                finalAddBtn.textContent = '+';
                storyboardRow.appendChild(finalAddBtn);
            }
            
            // Show storyboard
            storyboardEl.classList.remove('hidden');
            
            // Setup hover interactions (desktop-only)
            setupStoryboardHover();
            
            // Setup swap button click handlers
            setupSwapButtonHandlers();
            
            // Update render button state (session exists)
            updateRenderArticleButtonState();
            
            // Video Cuts (beta) panel: show and refresh when storyboard is rendered
            refreshVideoCutsPanel();
            
            // Apply beat previews (behind feature flag)
            if (window.BEAT_PREVIEW_ENABLED) {
                // explicitStyle: ONLY user/session overrides (empty object if none)
                const rawStyle = session.overlayCaption || session.captionStyle || {};
                const { extractStyleOnly } = await import('/js/caption-style-helper.js');
                const explicitStyle = extractStyleOnly(rawStyle);
                await BeatPreviewManager.applyAllPreviews(sentences, explicitStyle);
            }
        }
        
        let videoCutsPanelListenersAttached = false;
        function refreshVideoCutsPanel() {
            const panel = document.getElementById('video-cuts-panel');
            if (!panel) return;
            const session = window.currentStorySession;
            const enabled = !!(window.ENABLE_VIDEO_CUTS_UI && session?.story?.sentences?.length >= 2);
            if (!enabled) {
                panel.classList.add('hidden');
                return;
            }
            const N = session.story.sentences.length;
            panel.classList.remove('hidden');
            if (!videoCutsPanelListenersAttached) {
                setupVideoCutsPanelListeners();
                videoCutsPanelListenersAttached = true;
            }
            // Boundary select: 0..N-2
            const boundarySelect = document.getElementById('video-cuts-boundary-index');
            if (boundarySelect) {
                boundarySelect.innerHTML = '';
                for (let i = 0; i <= N - 2; i++) {
                    const opt = document.createElement('option');
                    opt.value = i;
                    opt.textContent = 'Between beat ' + i + 'â€“' + (i + 1);
                    boundarySelect.appendChild(opt);
                }
            }
            const editIdx = boundarySelect ? parseInt(boundarySelect.value, 10) || 0 : 0;
            const beatIndexInput = document.getElementById('video-cuts-beat-index');
            if (beatIndexInput) {
                beatIndexInput.min = editIdx + 1;
                beatIndexInput.max = N - 1;
                const val = parseInt(beatIndexInput.value, 10);
                if (isNaN(val) || val < editIdx + 1 || val > N - 1) {
                    beatIndexInput.value = editIdx + 1;
                }
            }
            const pctEl = document.getElementById('video-cuts-pct-value');
            const pctSlider = document.getElementById('video-cuts-pct');
            if (pctEl && pctSlider) pctEl.textContent = pctSlider.value;
            // Warning: any beat missing selectedClip.url
            const shots = session.shots || [];
            const missing = [];
            for (let i = 0; i < N; i++) {
                const shot = shots.find(s => s.sentenceIndex === i) || shots[i];
                if (!shot?.selectedClip?.url) missing.push(i);
            }
            const warningEl = document.getElementById('video-cuts-warning');
            if (warningEl) {
                if (missing.length > 0) {
                    warningEl.textContent = 'Some beats have no clip (beat ' + missing.join(', ') + '). Backend will fall back; video cuts may not apply.';
                    warningEl.classList.remove('hidden');
                } else {
                    warningEl.textContent = '';
                    warningEl.classList.add('hidden');
                }
            }
            const debugPre = document.getElementById('video-cuts-debug');
            if (debugPre) {
                debugPre.textContent = JSON.stringify(session.videoCutsV1 ?? null, null, 2);
            }
        }
        
        function setupVideoCutsPanelListeners() {
            const boundarySelect = document.getElementById('video-cuts-boundary-index');
            const beatIndexInput = document.getElementById('video-cuts-beat-index');
            const pctSlider = document.getElementById('video-cuts-pct');
            const pctValue = document.getElementById('video-cuts-pct-value');
            if (pctSlider && pctValue) {
                pctSlider.addEventListener('input', function () {
                    pctValue.textContent = pctSlider.value;
                });
            }
            if (boundarySelect && beatIndexInput) {
                boundarySelect.addEventListener('change', function () {
                    refreshVideoCutsPanel();
                });
            }
            const saveBtn = document.getElementById('video-cuts-save-btn');
            const resetBtn = document.getElementById('video-cuts-reset-btn');
            if (saveBtn) {
                saveBtn.addEventListener('click', async function () {
                    const session = window.currentStorySession;
                    const sessionId = window.currentStorySessionId;
                    if (!session || !sessionId) {
                        if (typeof showToast === 'function') showToast('No session. Create or load a story first.');
                        return;
                    }
                    const N = session.story?.sentences?.length ?? 0;
                    if (N < 2) return;
                    const boundarySelectEl = document.getElementById('video-cuts-boundary-index');
                    const beatIndexEl = document.getElementById('video-cuts-beat-index');
                    const pctEl = document.getElementById('video-cuts-pct');
                    const editIdx = boundarySelectEl ? parseInt(boundarySelectEl.value, 10) || 0 : 0;
                    const beatIndex = beatIndexEl ? parseInt(beatIndexEl.value, 10) : editIdx + 1;
                    const pct = pctEl ? parseFloat(pctEl.value) : 0.35;
                    const minBeat = editIdx + 1;
                    const clampedBeatIndex = Math.max(minBeat, Math.min(N - 1, beatIndex));
                    const boundaries = [];
                    for (let i = 0; i <= N - 2; i++) {
                        boundaries.push({
                            leftBeat: i,
                            pos: i === editIdx ? { beatIndex: clampedBeatIndex, pct: pct } : { beatIndex: i + 1, pct: 0 }
                        });
                    }
                    try {
                        const { apiFetch } = await import('/api.mjs');
                        const resp = await apiFetch('/story/update-video-cuts', {
                            method: 'POST',
                            body: { sessionId, videoCutsV1: { version: 1, boundaries } }
                        });
                        if (resp.success && resp.data) {
                            window.currentStorySession = resp.data;
                            if (typeof showToast === 'function') showToast('Saved video cuts');
                            refreshVideoCutsPanel();
                        } else {
                            const msg = resp.error || resp.detail || 'Failed to save video cuts';
                            if (typeof showToast === 'function') showToast(msg);
                            else console.error('[video-cuts]', msg);
                        }
                    } catch (e) {
                        if (typeof showToast === 'function') showToast(e?.message || 'Failed to save video cuts');
                        console.error('[video-cuts]', e);
                    }
                });
            }
            if (resetBtn) {
                resetBtn.addEventListener('click', async function () {
                    const sessionId = window.currentStorySessionId;
                    if (!sessionId) {
                        if (typeof showToast === 'function') showToast('No session.');
                        return;
                    }
                    try {
                        const { apiFetch } = await import('/api.mjs');
                        const resp = await apiFetch('/story/update-video-cuts', {
                            method: 'POST',
                            body: { sessionId, videoCutsV1: { version: 1, boundaries: [] } }
                        });
                        if (resp.success && resp.data) {
                            window.currentStorySession = resp.data;
                            if (typeof showToast === 'function') showToast('Reset video cuts');
                            refreshVideoCutsPanel();
                        } else {
                            const msg = resp.error || resp.detail || 'Failed to reset video cuts';
                            if (typeof showToast === 'function') showToast(msg);
                            else console.error('[video-cuts]', msg);
                        }
                    } catch (e) {
                        if (typeof showToast === 'function') showToast(e?.message || 'Failed to reset video cuts');
                        console.error('[video-cuts]', e);
                    }
                });
            }
        }
        
        function renderDraftStoryboard() {
            const storyboardRow = document.getElementById('storyboard-row');
            const storyboardEl = document.getElementById('storyboard');
            
            if (!storyboardRow || !storyboardEl) {
                console.error('[article] Storyboard elements not found');
                return;
            }
            
            // Clear existing cards
            storyboardRow.innerHTML = '';
            
            const beats = window.draftStoryboard.beats || [];
            
            // Phase 1: Use beat IDs instead of indices
            beats.forEach((beat) => {
                if (!beat.id) {
                    // Migrate old beats without IDs
                    beat.id = generateBeatId();
                }
                
                const card = document.createElement('div');
                card.className = 'beat-card relative w-40 h-[420px] flex-shrink-0 bg-black rounded-lg overflow-hidden border border-gray-700';
                card.setAttribute('data-beat-id', beat.id);
                card.setAttribute('data-draft', 'true');
                
                if (!beat.selectedClip) {
                    // Placeholder for missing clip
                    card.innerHTML = `
                        <div 
                            class="relative w-full h-40 beat-video-container bg-gray-800 flex items-center justify-center cursor-pointer hover:bg-gray-700 transition"
                            data-beat-id="${beat.id}"
                            data-draft="true"
                            data-add-clip="true"
                            title="Click to add clip"
                        >
                            <p class="text-xs text-gray-400 text-center px-2">+ Add clip</p>
                            <div class="beat-controls">
                                <button
                                    class="delete-beat-btn absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs flex items-center justify-center z-50"
                                    data-beat-id="${beat.id}"
                                    data-draft="true"
                                    title="Delete beat"
                                >âœ•</button>
                            </div>
                        </div>
                        <div 
                            class="beat-text p-2 text-xs text-gray-200 h-24 overflow-hidden cursor-text"
                            data-beat-id="${beat.id}"
                            data-draft="true"
                            title="Click to edit"
                        >
                            ${escapeHtml(beat.text || 'Add textâ€¦')}
                        </div>
                        <button
                            class="swap-clip-btn mt-1 mx-2 mb-2 w-[calc(100%-1rem)] text-xs py-1 rounded bg-slate-700 hover:bg-slate-600 text-white"
                            data-beat-id="${beat.id}"
                            data-draft="true"
                        >
                            Swap clip
                        </button>
                    `;
                } else {
                    const clip = beat.selectedClip;
                    const videoUrl = clip.url || '';
                    const thumbUrl = clip.thumbUrl || '';
                    
                    card.innerHTML = `
                        <div class="relative w-full h-40 beat-video-container overflow-hidden">
                            <video
                                src="${videoUrl}"
                                ${thumbUrl ? `poster="${thumbUrl}"` : ''}
                                muted
                                loop
                                preload="none"
                                class="w-full h-full object-cover transition-transform duration-150 storyboard-video"
                                data-beat-id="${beat.id}"
                                aria-label="Preview for: ${(beat.text || '').substring(0, 50)}"
                            ></video>
                            <div class="beat-controls">
                                <button
                                    class="delete-beat-btn absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs flex items-center justify-center z-50"
                                    data-beat-id="${beat.id}"
                                    data-draft="true"
                                    title="Delete beat"
                                >âœ•</button>
                            </div>
                        </div>
                        <div 
                            class="beat-text p-2 text-xs text-gray-200 h-24 overflow-hidden cursor-text"
                            data-beat-id="${beat.id}"
                            data-draft="true"
                            title="Click to edit"
                        >
                            ${escapeHtml(beat.text || 'Add textâ€¦')}
                        </div>
                        <button
                            class="swap-clip-btn mt-1 mx-2 mb-2 w-[calc(100%-1rem)] text-xs py-1 rounded bg-slate-700 hover:bg-slate-600 text-white"
                            data-beat-id="${beat.id}"
                            data-draft="true"
                        >
                            Swap clip
                        </button>
                    `;
                }
                
                storyboardRow.appendChild(card);
            });
            
            // Phase 1: Add "+ Add beat" button after last beat (if under max)
            if (beats.length < MAX_BEATS) {
                const addBtn = document.createElement('button');
                addBtn.className = 'add-beat-btn mx-2 flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-lg flex items-center justify-center';
                addBtn.setAttribute('data-draft', 'true');
                addBtn.setAttribute('title', 'Add beat');
                addBtn.textContent = '+';
                storyboardRow.appendChild(addBtn);
            }
            
            // Show storyboard
            storyboardEl.classList.remove('hidden');
            
            // Setup hover interactions (desktop-only)
            setupStoryboardHover();
            
            // Setup swap button click handlers
            setupSwapButtonHandlers();
            
            // Update render button state (draft mode)
            updateRenderArticleButtonState();
            
            // Apply beat previews (behind feature flag)
            if (window.BEAT_PREVIEW_ENABLED) {
                const style = window.draftStoryboard?.captionStyle || {
                    fontFamily: 'DejaVu Sans',
                    weightCss: 'bold',
                    fontPx: 48,
                    yPct: 0.5,
                    wPct: 0.8,
                    opacity: 1,
                    color: '#FFFFFF'
                };
                BeatPreviewManager.applyAllPreviews(beats, style);
            }
        }
        
        function setupSwapButtonHandlers() {
            const storyboardRow = document.getElementById('storyboard-row');
            if (!storyboardRow) return;
            
            // Remove existing listener to avoid duplicates
            storyboardRow.removeEventListener('click', handleSwapButtonClick);
            
            // Add click handler
            storyboardRow.addEventListener('click', handleSwapButtonClick);
        }
        
        function handleSwapButtonClick(e) {
            const isDraft = !window.currentStorySessionId;
            
            // Handle swap clip button
            const swapBtn = e.target.closest('.swap-clip-btn');
            if (swapBtn) {
                if (isDraft) {
                    // Phase 1: Draft mode uses beatId
                    const beatId = swapBtn.dataset.beatId;
                    if (!beatId) {
                        console.error('[article] Invalid beat ID:', swapBtn.dataset.beatId);
                        return;
                    }
                    openClipPicker(beatId, true);
                } else {
                    // Session mode uses sentenceIndex
                    const sentenceIndex = Number(swapBtn.dataset.sentenceIndex);
                    if (isNaN(sentenceIndex)) {
                        console.error('[article] Invalid sentence index:', swapBtn.dataset.sentenceIndex);
                        return;
                    }
                    openClipPicker(sentenceIndex, false);
                }
                return;
            }
            
            // Handle "+ Add clip" placeholder click
            const addClipPlaceholder = e.target.closest('[data-add-clip="true"]');
            if (addClipPlaceholder) {
                if (isDraft) {
                    // Phase 1: Draft mode uses beatId
                    const beatId = addClipPlaceholder.dataset.beatId;
                    if (!beatId) {
                        console.error('[article] Invalid beat ID:', addClipPlaceholder.dataset.beatId);
                        return;
                    }
                    openClipPicker(beatId, true);
                } else {
                    // Session mode uses sentenceIndex
                    const sentenceIndex = Number(addClipPlaceholder.dataset.sentenceIndex);
                    if (isNaN(sentenceIndex)) {
                        console.error('[article] Invalid sentence index:', addClipPlaceholder.dataset.sentenceIndex);
                        return;
                    }
                    openClipPicker(sentenceIndex, false);
                }
                return;
            }
            
            // Phase 1: Handle add beat button (draft mode only)
            const addBtn = e.target.closest('.add-beat-btn');
            if (addBtn && addBtn.dataset.draft === 'true') {
                if (window.draftStoryboard.beats.length >= MAX_BEATS) {
                    alert(`Maximum of ${MAX_BEATS} beats allowed`);
                    return;
                }
                handleAddDraftBeat();
                return;
            }
            
            // Handle add beat button (session mode)
            if (addBtn && !isDraft) {
                const insertAfterIndex = Number(addBtn.dataset.insertAfterIndex);
                if (isNaN(insertAfterIndex)) {
                    console.error('[article] Invalid insert after index:', addBtn.dataset.insertAfterIndex);
                    return;
                }
                
                const text = prompt('New beat text:');
                if (!text || !text.trim()) {
                    return;
                }
                
                handleInsertBeat(insertAfterIndex, text.trim());
                return;
            }
            
            // Phase 1: Handle delete beat button (draft mode)
            const deleteBtn = e.target.closest('.delete-beat-btn');
            if (deleteBtn && deleteBtn.dataset.draft === 'true') {
                const beatId = deleteBtn.dataset.beatId;
                if (!beatId) {
                    console.error('[article] Invalid beat ID:', deleteBtn.dataset.beatId);
                    return;
                }
                
                if (!confirm('Delete this beat?')) {
                    return;
                }
                
                handleDeleteDraftBeat(beatId);
                return;
            }
            
            // Handle delete beat button (session mode)
            if (deleteBtn && !isDraft) {
                const sentenceIndex = Number(deleteBtn.dataset.sentenceIndex);
                if (isNaN(sentenceIndex)) {
                    console.error('[article] Invalid sentence index:', deleteBtn.dataset.sentenceIndex);
                    return;
                }
                
                if (!confirm('Delete this beat?')) {
                    return;
                }
                
                handleDeleteBeat(sentenceIndex);
                return;
            }
            
            // Handle click on beat text (NEW)
            const textEl = e.target.closest('.beat-text');
            if (textEl) {
                handleEditBeatInline(textEl);
                return;
            }
            
            // Handle click on beat card (Focus Preview)
            const card = e.target.closest('[data-beat-id], [data-sentence-index]');
            if (card) {
                // Ignore clicks on interactive elements
                const interactive = e.target.closest('button, .beat-text, input, textarea, select, [contenteditable="true"]');
                if (!interactive) {
                    showBeatFocusPreview(card);
                    return;
                }
            }
        }
        
        // Beat Focus Preview Modal
        function showBeatFocusPreview(card) {
            if (window.__beatFocusDebug) {
                console.log('[beat-focus] Showing preview for card:', card);
            }
            
            const modal = document.getElementById('beat-focus-modal');
            const videoEl = document.getElementById('beat-focus-video');
            const overlayImg = document.getElementById('beat-focus-overlay');
            const textEl = document.getElementById('beat-focus-text');
            const noteEl = document.getElementById('beat-focus-preview-note');
            
            if (!modal || !videoEl || !overlayImg || !textEl || !noteEl) {
                console.error('[beat-focus] Modal elements not found');
                return;
            }
            
            // Extract video source and poster
            const cardVideo = card.querySelector('video.storyboard-video');
            if (cardVideo && cardVideo.src) {
                videoEl.src = cardVideo.src;
                
                // Copy poster to match thumbnail still
                const poster = cardVideo.getAttribute('poster');
                if (poster) {
                    videoEl.setAttribute('poster', poster);
                } else {
                    videoEl.removeAttribute('poster');
                }
                
                videoEl.load();
                videoEl.pause();  // Show poster initially
                videoEl.currentTime = 0;
            } else {
                if (window.__beatFocusDebug) {
                    console.warn('[beat-focus] No video source found');
                }
            }
            
            // Extract caption overlay if present
            const cardOverlay = card.querySelector('.beat-caption-overlay');
            if (cardOverlay && cardOverlay.src) {
                overlayImg.src = cardOverlay.src;
                overlayImg.style.display = 'block';
                
                // Copy CSS variables
                const yPct = cardOverlay.style.getPropertyValue('--y-pct') || 
                            getComputedStyle(cardOverlay).getPropertyValue('--y-pct');
                const rasterWRatio = cardOverlay.style.getPropertyValue('--raster-w-ratio') || 
                                    getComputedStyle(cardOverlay).getPropertyValue('--raster-w-ratio');
                const rasterHRatio = cardOverlay.style.getPropertyValue('--raster-h-ratio') || 
                                     getComputedStyle(cardOverlay).getPropertyValue('--raster-h-ratio');
                
                if (yPct) overlayImg.style.setProperty('--y-pct', yPct);
                if (rasterWRatio) overlayImg.style.setProperty('--raster-w-ratio', rasterWRatio);
                if (rasterHRatio) overlayImg.style.setProperty('--raster-h-ratio', rasterHRatio);
                
                noteEl.style.display = 'none';
            } else {
                overlayImg.style.display = 'none';
                noteEl.style.display = 'block';
            }
            
            // Extract text
            const cardText = card.querySelector('.beat-text');
            if (cardText) {
                textEl.textContent = cardText.textContent || '';
            } else {
                textEl.textContent = '';
            }
            
            // Show modal
            modal.classList.add('show');
            
            // Video is paused initially to show poster (matching thumbnail behavior)
            // User can interact to play if desired
        }
        
        function hideBeatFocusPreview() {
            const modal = document.getElementById('beat-focus-modal');
            const videoEl = document.getElementById('beat-focus-video');
            
            if (modal) {
                modal.classList.remove('show');
            }
            
            if (videoEl) {
                videoEl.pause();
                videoEl.currentTime = 0;
            }
        }
        
        // Setup modal close handlers
        function setupBeatFocusModal() {
            const modal = document.getElementById('beat-focus-modal');
            const closeBtn = document.getElementById('beat-focus-close');
            
            if (!modal || !closeBtn) return;
            
            // Close button
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                hideBeatFocusPreview();
            });
            
            // Backdrop click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    hideBeatFocusPreview();
                }
            });
            
            // ESC key
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && modal.classList.contains('show')) {
                    hideBeatFocusPreview();
                }
            });
        }
        
        // Initialize modal on DOM ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setupBeatFocusModal);
        } else {
            setupBeatFocusModal();
        }
        
        // Phase 1: Add beat to draft storyboard
        function handleAddDraftBeat() {
            if (!window.draftStoryboard || !window.draftStoryboard.beats) {
                window.draftStoryboard = { beats: [{ id: generateBeatId(), text: '', selectedClip: null }] };
            }
            
            if (window.draftStoryboard.beats.length >= MAX_BEATS) {
                alert(`Maximum of ${MAX_BEATS} beats allowed`);
                return;
            }
            
            // Add new beat at the end
            window.draftStoryboard.beats.push({
                id: generateBeatId(),
                text: '',
                selectedClip: null
            });
            
            // Re-render draft storyboard
            renderDraftStoryboard();
            updateRenderArticleButtonState();
        }
        
        // Phase 1: Delete beat from draft storyboard
        function handleDeleteDraftBeat(beatId) {
            if (!window.draftStoryboard || !window.draftStoryboard.beats) {
                return;
            }
            
            // Remove beat by ID
            const index = window.draftStoryboard.beats.findIndex(b => b.id === beatId);
            if (index === -1) {
                console.error('[article] Beat not found:', beatId);
                return;
            }
            
            window.draftStoryboard.beats.splice(index, 1);
            
            // If no beats left, add one empty beat
            if (window.draftStoryboard.beats.length === 0) {
                window.draftStoryboard.beats.push({
                    id: generateBeatId(),
                    text: '',
                    selectedClip: null
                });
            }
            
            // Re-render draft storyboard
            renderDraftStoryboard();
            updateRenderArticleButtonState();
        }
        
        async function handleInsertBeat(insertAfterIndex, text) {
            const sessionId = window.currentStorySessionId;
            if (!sessionId) {
                showError('article-error', 'Session not found');
                return;
            }
            
            try {
                const { apiFetch } = await import('/api.mjs');
                
                const resp = await apiFetch('/story/insert-beat', {
                    method: 'POST',
                    body: {
                        sessionId: sessionId,
                        insertAfterIndex: insertAfterIndex,
                        text: text
                    }
                });
                
                if (!resp.success) {
                    throw new Error(resp.error || 'Failed to insert beat');
                }
                
                // Update local session
                if (window.currentStorySession) {
                    if (!window.currentStorySession.story) {
                        window.currentStorySession.story = {};
                    }
                    window.currentStorySession.story.sentences = resp.data.sentences;
                    window.currentStorySession.shots = resp.data.shots;
                }
                
                // Re-render storyboard
                renderStoryboard(window.currentStorySession);
                
                console.log(`[article] Insert beat: insertAfterIndex=${insertAfterIndex}, new length=${resp.data.sentences.length}`);
            } catch (error) {
                console.error('[article] Insert beat failed:', error);
                showError('article-error', error.message || 'Failed to insert beat');
            }
        }
        
        async function handleDeleteBeat(sentenceIndex) {
            const sessionId = window.currentStorySessionId;
            if (!sessionId) {
                showError('article-error', 'Session not found');
                return;
            }
            
            try {
                const { apiFetch } = await import('/api.mjs');
                
                const resp = await apiFetch('/story/delete-beat', {
                    method: 'POST',
                    body: {
                        sessionId: sessionId,
                        sentenceIndex: sentenceIndex
                    }
                });
                
                if (!resp.success) {
                    throw new Error(resp.error || 'Failed to delete beat');
                }
                
                // Update local session
                if (window.currentStorySession) {
                    if (!window.currentStorySession.story) {
                        window.currentStorySession.story = {};
                    }
                    window.currentStorySession.story.sentences = resp.data.sentences;
                    window.currentStorySession.shots = resp.data.shots;
                }
                
                // Re-render storyboard
                renderStoryboard(window.currentStorySession);
                
                console.log(`[article] Delete beat: sentenceIndex=${sentenceIndex}, new length=${resp.data.sentences.length}`);
            } catch (error) {
                console.error('[article] Delete beat failed:', error);
                showError('article-error', error.message || 'Failed to delete beat');
            }
        }
        
        // Inline editing state
        let currentBeatEditing = null; // { el, sentenceIndex, originalText } or null
        
        function isStoryboardDirty() {
            // If session exists, check session beats
            if (window.currentStorySessionId && window.currentStorySession) {
                const shots = window.currentStorySession.shots || [];
                const sentences = window.currentStorySession.story?.sentences || [];
                
                for (let i = 0; i < Math.max(shots.length, sentences.length); i++) {
                    const shot = shots.find(s => s.sentenceIndex === i) || shots[i];
                    const sentence = sentences[i] || '';
                    
                    if (shot?.selectedClip || (sentence && sentence.trim().length > 0)) {
                        return true;
                    }
                }
                return false;
            }
            
            // Draft mode: check draftStoryboard
            const beats = window.draftStoryboard?.beats || [];
            for (const beat of beats) {
                if (beat.selectedClip || (beat.text && beat.text.trim().length > 0)) {
                    return true;
                }
            }
            return false;
        }
        
        function updateRenderArticleButtonState() {
            const renderBtn = document.getElementById('render-article-btn');
            if (!renderBtn) return;
            
            // Enable if session exists OR draft is dirty
            const hasSession = !!window.currentStorySessionId;
            const draftDirty = isStoryboardDirty();
            
            if (hasSession || draftDirty) {
                renderBtn.disabled = false;
                renderBtn.title = '';
            } else {
                renderBtn.disabled = true;
                renderBtn.title = 'Please add at least one clip or text to render';
            }
        }
        
        function handleEditBeatInline(textEl) {
            // Avoid starting multiple edits at once
            if (currentBeatEditing && currentBeatEditing.el !== textEl) {
                // Finish or cancel the other one first
                currentBeatEditing.el.blur();
            }
            
            const isDraft = textEl.dataset.draft === 'true';
            let currentText = "";
            let identifier = null;
            
            if (isDraft && !window.currentStorySessionId) {
                // Phase 1: Draft mode uses beatId
                const beatId = textEl.dataset.beatId;
                if (!beatId) {
                    console.error('[article] Missing beatId in draft mode');
                    return;
                }
                const beat = window.draftStoryboard?.beats?.find(b => b.id === beatId);
                currentText = beat?.text ?? textEl.textContent ?? "";
                identifier = beatId;
            } else {
                // Session mode uses sentenceIndex
                const sentenceIndex = Number(textEl.dataset.sentenceIndex ?? -1);
                if (sentenceIndex < 0) return;
                const sentences = window.currentStorySession?.story?.sentences || [];
                currentText = sentences[sentenceIndex] ?? textEl.textContent ?? "";
                identifier = sentenceIndex;
            }
            
            currentBeatEditing = {
                el: textEl,
                identifier, // Phase 1: Can be beatId (string) or sentenceIndex (number)
                isDraft,
                originalText: currentText,
            };
            
            textEl.contentEditable = "true";
            textEl.classList.add("beat-text-editing");
            textEl.focus();
            
            // Place caret at end
            const range = document.createRange();
            range.selectNodeContents(textEl);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            
            // Attach key handler once
            textEl.addEventListener("keydown", handleBeatTextKeydown);
            textEl.addEventListener("blur", handleBeatTextBlur);
        }
        
        async function commitBeatTextEdit() {
            if (!currentBeatEditing) return;
            
            const { el, identifier, isDraft, originalText } = currentBeatEditing;
            const newText = (el.textContent || "").trim();
            
            // Clean up editing state UI
            el.contentEditable = "false";
            el.classList.remove("beat-text-editing");
            el.removeEventListener("keydown", handleBeatTextKeydown);
            el.removeEventListener("blur", handleBeatTextBlur);
            
            currentBeatEditing = null;
            
            if (!newText || newText === originalText) {
                // No change â†’ nothing to do
                el.textContent = originalText;
                return;
            }
            
            // Draft mode: update draftStoryboard directly, no API call
            if (isDraft && !window.currentStorySessionId) {
                if (!window.draftStoryboard || !window.draftStoryboard.beats) {
                    // Phase 1: Initialize with 1 empty beat if missing
                    window.draftStoryboard = { beats: [{ id: generateBeatId(), text: '', selectedClip: null }] };
                }
                // Phase 1: Find beat by ID
                const beat = window.draftStoryboard.beats.find(b => b.id === identifier);
                if (beat) {
                    beat.text = newText;
                } else {
                    console.error('[article] Beat not found:', identifier);
                }
                el.textContent = newText;
                updateRenderArticleButtonState();
                
                // Trigger debounced preview (behind feature flag)
                if (window.BEAT_PREVIEW_ENABLED) {
                    const style = window.draftStoryboard?.captionStyle || {
                        fontFamily: 'DejaVu Sans',
                        weightCss: 'bold',
                        fontPx: 48,
                        yPct: 0.5,
                        wPct: 0.8,
                        opacity: 1,
                        color: '#FFFFFF'
                    };
                    const m = window.__beatPreviewModule || await window.__beatPreviewModulePromise;
                    if (m) {
                        m.generateBeatCaptionPreviewDebounced(identifier, newText, style);
                    }
                }
                return;
            }
            
            // Session mode: use existing API flow
            try {
                const { apiFetch } = await import('/api.mjs');
                
                const resp = await apiFetch('/story/update-beat-text', {
                    method: 'POST',
                    body: {
                        sessionId: window.currentStorySessionId,
                        sentenceIndex: identifier, // Phase 1: identifier is sentenceIndex in session mode
                        text: newText,
                    }
                });
                
                if (!resp.success) {
                    console.error("[article] Update beat failed:", resp);
                    showError("article-error", resp.detail || "Failed to update beat");
                    // Revert text if backend failed
                    el.textContent = originalText;
                    return;
                }
                
                const { sentences, shots } = resp.data;
                
                // Keep session in sync
                if (!window.currentStorySession.story) {
                    window.currentStorySession.story = {};
                }
                window.currentStorySession.story.sentences = sentences;
                window.currentStorySession.shots = shots;
                
                console.log(
                    "[article] Update beat: sentenceIndex=%d, newText=%s",
                    identifier,
                    newText.slice(0, 80)
                );
                
                // Re-render storyboard from canonical data
                renderStoryboard(window.currentStorySession);
                updateRenderArticleButtonState();
                
                // Trigger debounced preview (behind feature flag) - schedule after DOM update
                if (window.BEAT_PREVIEW_ENABLED) {
                    // explicitStyle: ONLY user/session overrides (empty object if none)
                    const rawStyle = window.currentStorySession.overlayCaption || window.currentStorySession.captionStyle || {};
                    requestAnimationFrame(async () => {
                        const { extractStyleOnly } = await import('/js/caption-style-helper.js');
                        const explicitStyle = extractStyleOnly(rawStyle);
                        const m = window.__beatPreviewModule || await window.__beatPreviewModulePromise;
                        if (m) {
                            m.generateBeatCaptionPreviewDebounced(identifier, newText, explicitStyle);
                        }
                    });
                }
            } catch (err) {
                console.error("[article] Update beat error:", err);
                showError("article-error", "Could not update beat. Please try again.");
                el.textContent = originalText;
            }
        }
        
        function handleBeatTextKeydown(e) {
            if (!currentBeatEditing) return;
            
            if (e.key === "Enter") {
                e.preventDefault();
                commitBeatTextEdit();
            } else if (e.key === "Escape") {
                e.preventDefault();
                // Cancel and revert
                const { el, originalText } = currentBeatEditing;
                el.textContent = originalText;
                el.blur(); // will trigger blur handler cleanup
            }
        }
        
        function handleBeatTextBlur(e) {
            // When focus leaves, commit the change
            commitBeatTextEdit();
        }
        
        function renderClipPickerGrid(shot, pageInfo = null) {
            const grid = document.getElementById('clip-picker-grid');
            if (!grid) return;
            
            // Remove existing sentinel if present
            const existingSentinel = document.getElementById('clip-picker-sentinel');
            if (existingSentinel) {
                existingSentinel.remove();
            }
            
            // Show all candidates from current page (backend returns 12 per page)
            const candidates = shot.candidates || [];
            
            if (candidates.length === 0) {
                grid.innerHTML = '<div class="text-sm text-gray-500 dark:text-gray-400 col-span-full text-center py-4">No clips found. Try a different search.</div>';
                // Hide pagination if no results
                const paginationBar = document.getElementById('clip-picker-pagination');
                if (paginationBar) {
                    paginationBar.classList.add('hidden');
                }
                return;
            }
            
            grid.innerHTML = candidates.map(clip => {
                const isSelected = shot.selectedClip?.id === clip.id;
                return `
                    <div
                        class="clip-option rounded overflow-hidden bg-gray-100 dark:bg-gray-800 border ${isSelected ? 'border-blue-500' : 'border-gray-300 dark:border-gray-700'} cursor-pointer hover:border-blue-500 transition"
                        data-clip-id="${clip.id}"
                    >
                        <video
                            class="w-full h-40 object-cover pointer-events-none"
                            src="${clip.url || ''}"
                            ${clip.thumbUrl ? `poster="${clip.thumbUrl}"` : ''}
                            playsinline
                            muted
                            preload="none"
                        ></video>
                        <div class="p-1 text-[11px] truncate text-gray-600 dark:text-gray-300">
                            ${clip.photographer || ''}
                        </div>
                    </div>
                `;
            }).join('');
            
            // Add sentinel element if there are more pages
            if (pageInfo && pageInfo.hasMore) {
                const sentinel = document.createElement('div');
                sentinel.id = 'clip-picker-sentinel';
                sentinel.className = 'h-4 w-full';
                grid.appendChild(sentinel);
            }
            
            // Update pagination controls
            updatePaginationControls(pageInfo);
        }
        
        function updatePaginationControls(pageInfo) {
            const paginationBar = document.getElementById('clip-picker-pagination');
            if (!paginationBar) return;
            
            if (!pageInfo) {
                paginationBar.classList.add('hidden');
                return;
            }
            
            const { currentPage, hasMore } = pageInfo;
            const prevBtn = document.getElementById('clip-picker-prev');
            const nextBtn = document.getElementById('clip-picker-more');
            
            // Show pagination bar
            paginationBar.classList.remove('hidden');
            
            // Update Previous button
            if (prevBtn) {
                if (currentPage === 1) {
                    prevBtn.disabled = true;
                    prevBtn.classList.add('opacity-50', 'cursor-not-allowed');
                } else {
                    prevBtn.disabled = false;
                    prevBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                }
            }
            
            // Update More clips button
            if (nextBtn) {
                if (!hasMore) {
                    nextBtn.disabled = true;
                    nextBtn.classList.add('opacity-50', 'cursor-not-allowed');
                } else {
                    nextBtn.disabled = false;
                    nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                }
            }
        }
        
        // Phase 1: Updated to accept beatId (string) for draft mode or sentenceIndex (number) for session mode
        function openClipPicker(beatIdOrIndex, isDraft = null) {
            // Auto-detect draft mode if not specified
            if (isDraft === null) {
                isDraft = !window.currentStorySessionId;
            }
            
            if (isDraft) {
                // Phase 1: Draft mode uses beatId (string)
                window.clipPickerIsDraft = true;
                window.clipPickerBeatId = beatIdOrIndex; // Now expects string ID
                window.draftClipPickerPage = 1;
                window.draftClipPickerCandidates = [];
                
                // TEMP: Log for debugging
                console.log('[clip-picker][draft] open', { beatId: beatIdOrIndex });
            } else {
                // Session mode: use existing flow
                const session = window.currentStorySession;
                if (!session || !session.shots) {
                    console.error('[article] No session or shots available');
                    showError('article-error', 'Please prepare the storyboard first');
                    return;
                }
                
                const shot = session.shots.find(s => s.sentenceIndex === beatIdOrIndex);
                if (!shot) {
                    console.error('[article] Shot not found for sentence index:', beatIdOrIndex);
                    return;
                }
                
                window.clipPickerIsDraft = false;
                window.currentClipPickerSentence = beatIdOrIndex;
                
                // Initialize pagination state
                window.clipPickerPagination = { currentPage: 1, hasMore: false };
            }
            
            // Get picker elements
            const picker = document.getElementById('clip-picker');
            const searchInput = document.getElementById('clip-search-input');
            const closeBtn = document.getElementById('clip-picker-close');
            
            if (!picker) {
                console.error('[article] Clip picker element not found');
                return;
            }
            
            // Store target context on picker element (single source of truth)
            if (isDraft) {
                picker.dataset.targetKind = "beat";
                picker.dataset.targetId = String(beatIdOrIndex);
            } else {
                picker.dataset.targetKind = "sentence";
                picker.dataset.targetId = String(beatIdOrIndex);
            }
            
            // Clear search input
            if (searchInput) {
                searchInput.value = '';
            }
            
            // Render grid - draft or session mode
            if (window.clipPickerIsDraft) {
                // Phase 1: Draft mode: find beat by ID
                const beat = window.draftStoryboard?.beats?.find(b => b.id === window.clipPickerBeatId);
                const fakeShot = {
                    candidates: window.draftClipPickerCandidates || [],
                    selectedClip: beat?.selectedClip || null
                };
                renderClipPickerGrid(fakeShot, { currentPage: window.draftClipPickerPage || 1, hasMore: false });
            } else {
                // Session mode: use existing shot
                const shot = window.currentStorySession.shots.find(s => s.sentenceIndex === beatIdOrIndex);
                renderClipPickerGrid(shot, window.clipPickerPagination);
                
                // Trigger initial search to get pagination metadata (hasMore)
                if (shot && shot.searchQuery && shot.searchQuery.trim()) {
                    runClipSearch(1, { append: false });
                } else {
                    // Even without initial search, setup observer if sentinel exists
                    if (document.getElementById('clip-picker-sentinel')) {
                        setupClipPickerInfiniteScroll();
                    }
                }
            }
            
            // Show picker
            picker.classList.remove('hidden');
            
            // Setup close button
            if (closeBtn) {
                closeBtn.onclick = () => {
                    // Clean up infinite scroll observer
                    if (window.clipPickerInfinite?.observer) {
                        window.clipPickerInfinite.observer.disconnect();
                        window.clipPickerInfinite.observer = null;
                    }
                    picker.classList.add('hidden');
                    window.currentClipPickerSentence = null;
                    window.clipPickerIsDraft = false;
                    window.clipPickerBeatId = null; // Phase 1: Clear beatId instead of sentenceIndex
                    // Clear dataset
                    delete picker.dataset.targetKind;
                    delete picker.dataset.targetId;
                    // Remove click handler when picker is closed
                    picker.removeEventListener('click', handleClipOptionClick);
                };
            }
            
            // Setup hover interactions (delegated on drawer)
            setupClipPickerHover();
            
            // Setup click handler on drawer (not grid) for clip selection
            // (picker already declared above at line 6071)
            if (picker) {
                picker.removeEventListener('click', handleClipOptionClick);
                picker.addEventListener('click', handleClipOptionClick);
            }
            
            // Setup search button and Enter key
            const searchBtn = document.getElementById('clip-search-btn');
            // (searchInput already declared above at line 6072)
            
            if (searchBtn) {
                searchBtn.onclick = () => {
                    if (window.clipPickerIsDraft) {
                        window.draftClipPickerPage = 1;
                        runDraftClipSearch(1, { append: false });
                    } else {
                        // Reset to page 1 for new search
                        if (window.clipPickerPagination) {
                            window.clipPickerPagination.currentPage = 1;
                        }
                        runClipSearch(1, { append: false });
                    }
                };
            }
            
            if (searchInput) {
                searchInput.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        if (window.clipPickerIsDraft) {
                            window.draftClipPickerPage = 1;
                            runDraftClipSearch(1, { append: false });
                        } else {
                            // Reset to page 1 for new search
                            if (window.clipPickerPagination) {
                                window.clipPickerPagination.currentPage = 1;
                            }
                            runClipSearch(1, { append: false });
                        }
                    }
                };
            }
            
            // Setup pagination buttons
            const prevBtn = document.getElementById('clip-picker-prev');
            const nextBtn = document.getElementById('clip-picker-more');
            
            if (prevBtn) {
                prevBtn.onclick = () => {
                    if (window.clipPickerIsDraft) {
                        if (window.draftClipPickerPage > 1) {
                            window.draftClipPickerPage--;
                            runDraftClipSearch(window.draftClipPickerPage);
                        }
                    } else {
                        if (window.clipPickerPagination && window.clipPickerPagination.currentPage > 1) {
                            window.clipPickerPagination.currentPage--;
                            runClipSearch(window.clipPickerPagination.currentPage);
                        }
                    }
                };
            }
            
            if (nextBtn) {
                nextBtn.onclick = () => {
                    if (window.clipPickerIsDraft) {
                        const nextPage = (window.draftClipPickerPage || 1) + 1;
                        runDraftClipSearch(nextPage, { append: true });
                    } else {
                        if (window.clipPickerPagination && window.clipPickerPagination.hasMore) {
                            const nextPage = window.clipPickerPagination.currentPage + 1;
                            runClipSearch(nextPage, { append: true });
                        }
                    }
                };
            }
        }
        
        function setupClipPickerHover() {
            const picker = document.getElementById('clip-picker');
            if (!picker) return;
            
            // Robustness guard: prevent double-binding
            const grid = document.getElementById('clip-picker-grid');
            if (grid?.dataset?.hoverBound === '1') return;
            if (grid) grid.dataset.hoverBound = '1';
            
            // Check hover capability (desktop only)
            const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
            if (!canHover) return;
            
            // Remove existing listeners to avoid duplicates
            picker.removeEventListener('mouseenter', handleClipPickerMouseEnter, true);
            picker.removeEventListener('mouseleave', handleClipPickerMouseLeave, true);
            
            picker.addEventListener('mouseenter', handleClipPickerMouseEnter, true);
            picker.addEventListener('mouseleave', handleClipPickerMouseLeave, true);
        }
        
        function handleClipPickerMouseEnter(e) {
            const card = e.target.closest('.clip-option');
            if (!card) return;
            const video = card.querySelector('video');
            if (!video) return;
            video.play().catch(() => {});
        }
        
        function handleClipPickerMouseLeave(e) {
            const card = e.target.closest('.clip-option');
            if (!card) return;
            const video = card.querySelector('video');
            if (!video) return;
            video.pause();
            video.currentTime = 0;
        }
        
        function setClipPickerBusy(busy) {
            const drawer = document.getElementById('clip-picker');
            if (!drawer) return;
            drawer.dataset.busy = busy ? '1' : '0';
            
            // Exclude pagination buttons - they are managed exclusively by updatePaginationControls
            const buttons = drawer.querySelectorAll('button:not(#clip-picker-prev):not(#clip-picker-more), .clip-option');
            buttons.forEach((el) => {
                el.toggleAttribute('disabled', busy);
                if (busy) {
                    el.classList.add('opacity-60', 'pointer-events-none');
                } else {
                    el.classList.remove('opacity-60', 'pointer-events-none');
                }
            });
        }
        
        function setupClipPickerInfiniteScroll() {
            const grid = document.getElementById('clip-picker-grid');
            const sentinel = document.getElementById('clip-picker-sentinel');
            const drawer = document.getElementById('clip-picker');
            if (!grid || !sentinel || !drawer) return;
            
            // Clean up any old observer
            if (window.clipPickerInfinite?.observer) {
                window.clipPickerInfinite.observer.disconnect();
            }
            
            const state = window.clipPickerInfinite || (window.clipPickerInfinite = { loadingNext: false, observer: null });
            
            const observer = new IntersectionObserver((entries) => {
                const entry = entries[0];
                if (!entry.isIntersecting) return;
                
                const busy = drawer.dataset.busy === '1';
                const pagination = window.clipPickerPagination || { currentPage: 1, hasMore: false };
                if (busy || state.loadingNext || !pagination.hasMore) return;
                
                state.loadingNext = true;
                const nextPage = (pagination.currentPage || 1) + 1;
                console.log('[clip-picker] infinite scroll â†’ loading page', nextPage);
                runClipSearch(nextPage, { append: true }).finally(() => {
                    state.loadingNext = false;
                });
            }, {
                root: grid,
                rootMargin: '0px 0px 200px 0px',
                threshold: 0.1,
            });
            
            observer.observe(sentinel);
            state.observer = observer;
        }
        
        async function handleClipOptionClick(e) {
            // Only handle clicks when picker is visible
            const picker = document.getElementById('clip-picker');
            if (!picker || picker.classList.contains('hidden')) {
                return;
            }
            
            const card = e.target.closest('.clip-option[data-clip-id]');
            if (!card) return;
            
            // Stop propagation to prevent interfering with other click handlers
            e.stopPropagation();
            
            const clipId = card.getAttribute('data-clip-id');
            const isDraft = window.clipPickerIsDraft;
            
            if (!clipId) {
                console.error('[article] Missing clipId');
                return;
            }
            
            // Read target context from picker dataset (with fallback to legacy globals)
            const kind = picker?.dataset?.targetKind;
            const id = picker?.dataset?.targetId;
            
            // Optional debug log
            if (window.__clipPickerDebug) {
                console.log('[clip-picker] target', kind, id);
            }
            
            // Draft mode: update draftStoryboard directly, no API call
            if (isDraft) {
                // Phase 1: Use beatId instead of sentenceIndex
                // Prefer dataset, fallback to legacy global
                const beatId = (kind === "beat" && id) ? id : window.clipPickerBeatId;
                if (!beatId) {
                    console.error('[clip-picker][draft] Missing beatId in draft mode');
                    return;
                }
                
                // Find clip from candidates
                const clip = window.draftClipPickerCandidates?.find(c => c.id === clipId);
                if (!clip) {
                    console.error('[article] Clip not found in draft candidates');
                    return;
                }
                
                // TEMP: Log for debugging
                console.log('[clip-picker][draft] select', { beatId, clipId: clip?.id });
                
                // Update draftStoryboard
                if (!window.draftStoryboard || !window.draftStoryboard.beats) {
                    // Phase 1: Initialize with 1 empty beat if missing
                    window.draftStoryboard = { beats: [{ id: generateBeatId(), text: '', selectedClip: null }] };
                }
                // Phase 1: Find beat by ID
                const beat = window.draftStoryboard.beats.find(b => b.id === beatId);
                if (!beat) {
                    console.error('[clip-picker][draft] Beat not found:', beatId);
                    return;
                }
                
                // Update beat with selected clip
                beat.selectedClip = clip;
                
                // Re-render draft storyboard immediately to show the change
                renderDraftStoryboard();
                
                // Close picker
                picker.classList.add('hidden');
                window.clipPickerIsDraft = false;
                window.clipPickerBeatId = null; // Phase 1: Clear beatId
                // Clear dataset
                delete picker.dataset.targetKind;
                delete picker.dataset.targetId;
                
                // Update render button state
                updateRenderArticleButtonState();
                return;
            }
            
            // Session mode: use existing API flow
            const sessionId = window.currentStorySessionId;
            if (!sessionId) {
                showError('article-error', 'Session not found');
                return;
            }
            
            // Read sentenceIndex from dataset (with fallback to legacy global)
            let sentenceIndex;
            if (kind === "sentence" && id) {
                sentenceIndex = Number(id);
            } else {
                // Fallback to legacy global
                sentenceIndex = window.currentClipPickerSentence;
            }
            
            if (sentenceIndex === undefined || sentenceIndex === null || isNaN(sentenceIndex)) {
                console.error('[clip-picker] Invalid sentenceIndex context');
                showError('article-error', 'Invalid clip selection context');
                return;
            }
            
            try {
                setClipPickerBusy(true);
                
                const { apiFetch } = await import('/api.mjs');
                
                // Call API to update selected clip
                const resp = await apiFetch('/story/update-shot', {
                    method: 'POST',
                    body: {
                        sessionId: sessionId,
                        sentenceIndex: sentenceIndex,
                        clipId: clipId
                    }
                });
                
                if (!resp.success) {
                    throw new Error(resp.error || 'Failed to update clip');
                }
                
                // Update local session
                const updatedShot = resp.data.shots?.find(s => s.sentenceIndex === sentenceIndex);
                if (updatedShot && window.currentStorySession && window.currentStorySession.shots) {
                    const idx = window.currentStorySession.shots.findIndex(s => s.sentenceIndex === sentenceIndex);
                    if (idx !== -1) {
                        window.currentStorySession.shots[idx] = updatedShot;
                    }
                }
                
                // Update storyboard card
                if (updatedShot) {
                    updateStoryboardCardForSentence(updatedShot);
                }
                
                // Close picker
                // (picker already declared above at line 6179)
                if (picker) {
                    picker.classList.add('hidden');
                    // Clear dataset
                    delete picker.dataset.targetKind;
                    delete picker.dataset.targetId;
                }
                
                // Update render button state
                updateRenderArticleButtonState();
                window.currentClipPickerSentence = null;
                
                console.log('[article] Clip swapped successfully');
                
            } catch (error) {
                console.error('[article] Swap clip failed:', error);
                showError('article-error', error.message || 'Failed to swap clip');
            } finally {
                setClipPickerBusy(false);
            }
        }
        
        function updateStoryboardCardForSentence(shot) {
            if (!shot || !shot.selectedClip) return;
            
            const card = document.querySelector(`#storyboard-row [data-sentence-index="${shot.sentenceIndex}"]`);
            if (!card) return;
            
            const video = card.querySelector('video');
            if (!video) return;
            
            const clip = shot.selectedClip;
            video.src = clip.url || '';
            if (clip.thumbUrl) {
                video.setAttribute('poster', clip.thumbUrl);
            } else {
                video.removeAttribute('poster');
            }
            video.load();
        }
        
        async function runClipSearch(pageOverride = null, options = {}) {
            const { append = false } = options;
            const input = document.getElementById('clip-search-input');
            const query = input?.value.trim() || '';
            const sentenceIndex = window.currentClipPickerSentence;
            
            if (sentenceIndex === undefined || sentenceIndex === null) {
                console.error('[article] No sentence index for search');
                return;
            }
            
            const sessionId = window.currentStorySessionId;
            if (!sessionId) {
                showError('article-error', 'Session not found');
                return;
            }
            
            // Initialize pagination state if not exists
            if (!window.clipPickerPagination) {
                window.clipPickerPagination = { currentPage: 1, hasMore: false, lastQuery: null };
            }
            
            // Reset to page 1 if query changed (new search) - but only if not appending
            const lastQuery = window.clipPickerPagination.lastQuery;
            if (!append && lastQuery !== null && lastQuery !== query) {
                window.clipPickerPagination.currentPage = 1;
                window.clipPickerPagination.hasMore = false;
            }
            window.clipPickerPagination.lastQuery = query;
            
            // Use override page if provided, otherwise use current page
            const currentPage = pageOverride !== null ? pageOverride : window.clipPickerPagination.currentPage;
            
            // If appending, save existing candidates before API call
            let existingCandidates = [];
            if (append && window.currentStorySession && window.currentStorySession.shots) {
                const existingShot = window.currentStorySession.shots.find(s => s.sentenceIndex === sentenceIndex);
                if (existingShot && existingShot.candidates) {
                    existingCandidates = existingShot.candidates;
                }
            }
            
            try {
                setClipPickerBusy(true);
                
                const { apiFetch } = await import('/api.mjs');
                
                const resp = await apiFetch('/story/search-shot', {
                    method: 'POST',
                    body: {
                        sessionId: sessionId,
                        sentenceIndex: sentenceIndex,
                        query: query, // can be empty = use original sentence
                        page: currentPage
                    }
                });
                
                if (!resp.success) {
                    throw new Error(resp.error || 'Search failed');
                }
                
                const shot = resp.data.shot;
                const page = resp.data.page || currentPage;
                const hasMore = resp.data.hasMore || false;
                
                // If append mode, merge new candidates with existing ones (dedupe by id)
                if (append && existingCandidates.length > 0) {
                    const existingIds = new Set(existingCandidates.map(c => c.id).filter(id => id != null));
                    const newCandidates = (shot.candidates || []).filter(c => c.id == null || !existingIds.has(c.id));
                    shot.candidates = [...existingCandidates, ...newCandidates];
                }
                
                // Update pagination state
                window.clipPickerPagination.currentPage = page;
                window.clipPickerPagination.hasMore = hasMore;
                
                // Log pagination state for debugging
                console.log(`[clip-picker] page=${page} hasMore=${hasMore} append=${append}`);
                
                // Update session model
                if (window.currentStorySession && window.currentStorySession.shots) {
                    const idx = window.currentStorySession.shots.findIndex(s => s.sentenceIndex === shot.sentenceIndex);
                    if (idx !== -1) {
                        window.currentStorySession.shots[idx] = shot;
                    }
                }
                
                // Re-render candidate grid with pagination info
                renderClipPickerGrid(shot, window.clipPickerPagination);
                
                // Update pagination controls after rendering
                updatePaginationControls(window.clipPickerPagination);
                
                // Re-setup infinite scroll observer if sentinel exists (it may have been removed/re-added)
                if (document.getElementById('clip-picker-sentinel')) {
                    setupClipPickerInfiniteScroll();
                }
                
            } catch (error) {
                console.error('[article] Search failed:', error);
                showError('article-error', error.message || 'Could not search clips. Please try again.');
            } finally {
                setClipPickerBusy(false);
            }
        }
        
        async function runDraftClipSearch(pageOverride = null, options = {}) {
            const { append = false } = options;
            const input = document.getElementById('clip-search-input');
            const query = input?.value.trim() || '';
            // Phase 1: Use beatId instead of sentenceIndex
            const beatId = window.clipPickerBeatId;
            
            if (!beatId) {
                console.error('[article] No beatId for draft search');
                return;
            }
            
            // Use override page if provided, otherwise use current page
            const currentPage = pageOverride !== null ? pageOverride : (window.draftClipPickerPage || 1);
            window.draftClipPickerPage = currentPage;
            
            // If appending, save existing candidates before API call
            let existingCandidates = [];
            if (append && window.draftClipPickerCandidates) {
                existingCandidates = window.draftClipPickerCandidates;
            }
            
            try {
                setClipPickerBusy(true);
                
                const { apiFetch } = await import('/api.mjs');
                
                // Use /api/assets/options for draft mode (session-free)
                const resp = await apiFetch('/assets/options', {
                    method: 'POST',
                    body: {
                        type: 'videos',
                        query: query || (window.draftStoryboard?.beats?.find(b => b.id === beatId)?.text || '').trim(),
                        page: currentPage,
                        perPage: 12
                    }
                });
                
                // Robust check: handle both { ok: true } (success) and { success: false } (error) response shapes
                const ok = resp?.ok ?? resp?.success;
                if (!ok) {
                    throw new Error(resp?.error || resp?.reason || resp?.message || 'Search failed');
                }
                
                // Temporary diagnostic log (gated)
                if (window.__DEBUG_DRAFT_SEARCH) {
                    console.log('[draft-search] Response:', {
                        ok: resp?.ok,
                        itemsCount: resp?.data?.items?.length || 0,
                        nextPage: resp?.data?.nextPage ?? null
                    });
                }
                
                // Map response to candidate shape expected by renderClipPickerGrid
                const candidates = (resp.data.items || []).map(item => ({
                    id: item.id,
                    url: item.fileUrl,  // CRITICAL: renderClipPickerGrid expects 'url', not 'fileUrl'
                    thumbUrl: item.thumbUrl,
                    photographer: item.photographer || '',
                    duration: item.duration,
                    width: item.width,
                    height: item.height,
                    sourceUrl: item.sourceUrl,
                    provider: item.provider || 'pexels'
                }));
                
                // Map pagination
                const pageInfo = {
                    currentPage: currentPage,
                    hasMore: resp.data.nextPage !== null
                };
                
                // If append mode, merge new candidates with existing ones (dedupe by id)
                let finalCandidates = candidates;
                if (append && existingCandidates.length > 0) {
                    const existingIds = new Set(existingCandidates.map(c => c.id).filter(id => id != null));
                    const newCandidates = candidates.filter(c => c.id == null || !existingIds.has(c.id));
                    finalCandidates = [...existingCandidates, ...newCandidates];
                }
                
                // Store candidates
                window.draftClipPickerCandidates = finalCandidates;
                
                // Phase 1: Get current beat by ID
                const beat = window.draftStoryboard?.beats?.find(b => b.id === beatId);
                const fakeShot = {
                    candidates: finalCandidates,
                    selectedClip: beat?.selectedClip || null
                };
                
                // Re-render candidate grid with pagination info
                renderClipPickerGrid(fakeShot, pageInfo);
                
                // Update pagination controls after rendering
                updatePaginationControls(pageInfo);
                
            } catch (error) {
                console.error('[article] Draft search failed:', error);
                showError('article-error', error.message || 'Could not search clips. Please try again.');
            } finally {
                setClipPickerBusy(false);
            }
        }
        
        function setupStoryboardHover() {
            // Idempotent guard: prevent duplicate listener binding
            if (window.__beatBalloonHoverBound === true) return;
            window.__beatBalloonHoverBound = true;
            
            const storyboardRow = document.getElementById('storyboard-row');
            const storyboardEl = document.getElementById('storyboard');
            if (!storyboardRow) return;
            
            // Check hover capability (desktop only)
            const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
            if (!canHover) return;
            
            // Track currently hovered card for cleanup
            let activeHoveredCard = null;
            
            // Cleanup function: remove all hover and squish classes from a card
            function cleanupCardState(card) {
                if (!card) return;
                card.classList.remove('beat-hovered', 'squish-left-1', 'squish-left-2', 'squish-right-1', 'squish-right-2');
                const video = card.querySelector('.storyboard-video');
                if (video) {
                    video.pause();
                    video.currentTime = 0;
                }
                storyboardEl?.classList.remove('storyboard-hovering');
            }
            
            // Cleanup all cards: remove all squish classes from all cards
            function cleanupAllSquish() {
                const allCards = storyboardRow.querySelectorAll('[data-beat-id], [data-sentence-index]');
                allCards.forEach(card => {
                    card.classList.remove('squish-left-1', 'squish-left-2', 'squish-right-1', 'squish-right-2');
                });
            }
            
            // Apply hover state to a card and squish neighbors
            function applyHoverState(card) {
                if (activeHoveredCard === card) return; // Already hovering this card
                
                // Clean up previous hovered card if switching
                if (activeHoveredCard && activeHoveredCard !== card) {
                    cleanupCardState(activeHoveredCard);
                }
                
                // Clean up all squish classes first to prevent collisions
                cleanupAllSquish();
                
                // Get all beat cards (exclude add-beat buttons)
                const allCards = Array.from(storyboardRow.querySelectorAll('[data-beat-id], [data-sentence-index]'));
                const hoveredIndex = allCards.indexOf(card);
                
                if (hoveredIndex === -1) return;
                
                // Apply hover class to current card
                card.classList.add('beat-hovered');
                
                // Add hover class to storyboard wrapper for extra padding
                storyboardEl?.classList.add('storyboard-hovering');
                
                // Apply squish classes to neighbors (with bounds checking)
                if (hoveredIndex > 0) {
                    allCards[hoveredIndex - 1].classList.add('squish-right-1');
                }
                if (hoveredIndex > 1) {
                    allCards[hoveredIndex - 2].classList.add('squish-right-2');
                }
                if (hoveredIndex < allCards.length - 1) {
                    allCards[hoveredIndex + 1].classList.add('squish-left-1');
                }
                if (hoveredIndex < allCards.length - 2) {
                    allCards[hoveredIndex + 2].classList.add('squish-left-2');
                }
                
                // Start video playback
                const video = card.querySelector('.storyboard-video');
                if (video) {
                    video.play().catch(e => console.warn('[article] Video play failed:', e));
                }
                
                activeHoveredCard = card;
            }
            
            // Handle pointerover (entering card area)
            function handleCardHover(e) {
                // Find the card container
                const card = e.target.closest('[data-beat-id], [data-sentence-index]');
                if (!card) return;
                
                // Exclude interactive elements
                if (e.target.closest('button, .beat-text, [contenteditable="true"]')) return;
                
                // Guard against internal child transitions
                if (e.relatedTarget && card.contains(e.relatedTarget)) return;
                
                applyHoverState(card);
            }
            
            // Handle pointerout (leaving card area)
            function handleCardLeave(e) {
                const card = e.target.closest('[data-beat-id], [data-sentence-index]');
                if (!card) return;
                
                // Guard: if moving to child within same card, don't leave
                if (e.relatedTarget && card.contains(e.relatedTarget)) return;
                
                // Clean up this card's hover state
                cleanupCardState(card);
                cleanupAllSquish();
                
                // Ensure hover class is removed
                storyboardEl?.classList.remove('storyboard-hovering');
                
                if (activeHoveredCard === card) {
                    activeHoveredCard = null;
                }
            }
            
            // Use event delegation with pointerover/pointerout (they bubble, unlike mouseenter/mouseleave)
            storyboardRow.addEventListener('pointerover', handleCardHover, true);
            storyboardRow.addEventListener('pointerout', handleCardLeave, true);
        }
        
        // ========================================
        // Render Status Banner Management
        // ========================================
        // Shows a 3-step progress banner during /api/story/finalize execution:
        // - Immediately: "Preparing video..."
        // - After 3s: "Adding speech..."
        // - After 6s: "Finalizing video..."
        // 
        // To modify timing or messages, update:
        // - showRenderStatus() timeout values (3000ms, 6000ms)
        // - Status text strings in showRenderStatus()
        // - Banner HTML element (#render-status-banner) near end of body
        // ========================================
        
        let renderStatusTimeouts = [];
        let renderStatusActive = false;
        
        function showRenderStatus() {
            // Clear any existing timeouts
            hideRenderStatus();
            
            const banner = document.getElementById('render-status-banner');
            const textEl = document.getElementById('render-status-text');
            
            if (!banner || !textEl) {
                console.warn('[render-status] Banner elements not found');
                return;
            }
            
            renderStatusActive = true;
            
            // Show banner and set initial text
            banner.classList.remove('hidden');
            textEl.textContent = 'Preparing video...';
            
            // After 3 seconds, change to "Adding speech..."
            const timeout1 = setTimeout(() => {
                if (renderStatusActive && textEl) {
                    textEl.textContent = 'Adding speech...';
                }
            }, 3000);
            renderStatusTimeouts.push(timeout1);
            
            // After 6 seconds, change to "Finalizing video..."
            const timeout2 = setTimeout(() => {
                if (renderStatusActive && textEl) {
                    textEl.textContent = 'Finalizing video...';
                }
            }, 6000);
            renderStatusTimeouts.push(timeout2);
        }
        
        function hideRenderStatus() {
            renderStatusActive = false;
            
            // Clear all timeouts
            renderStatusTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
            renderStatusTimeouts = [];
            
            // Hide banner
            const banner = document.getElementById('render-status-banner');
            if (banner) {
                banner.classList.add('hidden');
            }
            
            // Reset text
            const textEl = document.getElementById('render-status-text');
            if (textEl) {
                textEl.textContent = 'Preparing video...';
            }
        }
        
        async function ensureSessionFromDraft() {
            // Validate draft is dirty (before any API calls or UI changes)
            if (!isStoryboardDirty()) {
                throw new Error('Please add at least one clip or text to render');
            }
            
            // Filter valid beats early (before any API calls)
            const validBeats = window.draftStoryboard.beats.filter(isValidBeat);
            
            if (validBeats.length === 0) {
                throw new Error('Add text + a clip to at least one beat to render. (Clip-only beats aren\'t supported yet.)');
            }
            
            // Pure session creation - NO UI mutations
            const { apiFetch } = await import('/api.mjs');
            
            // Call backend to create session from draft (only valid beats)
            const resp = await apiFetch('/story/create-manual-session', {
                method: 'POST',
                body: {
                    beats: validBeats.map(b => ({
                        text: b.text || '',
                        selectedClip: b.selectedClip || null
                    }))
                }
            });
            
            if (!resp.success) {
                throw new Error(resp.error || resp.detail || 'Failed to create session');
            }
            
            const { sessionId, session } = resp.data;
            
            // Preserve client caption overrides if server doesn't have them
            const prev = window.currentStorySession;
            preserveCaptionOverrides(session, prev);
            
            // Set globals
            window.currentStorySessionId = sessionId;
            window.currentStorySession = session;
            
            // Replace draft UI with session UI
            await renderStoryboard(session);
            
            // Clear draft state (session is now source of truth)
            // Phase 1: Reset to 1 empty beat
            window.draftStoryboard = { beats: [{ id: generateBeatId(), text: '', selectedClip: null }] };
            
            return sessionId;
        }
        
        async function renderArticle() {
            const errorEl = document.getElementById('article-error');
            const renderBtn = document.getElementById('render-article-btn');
            const originalText = renderBtn?.textContent || 'Render video';
            const voicePresetEl = document.getElementById('article-voice-preset');
            const resultDiv = document.getElementById('article-render-result');
            const videoEl = document.getElementById('article-render-video');
            const videoUrlEl = document.getElementById('article-video-url');
            
            try {
                // Set loading state INSIDE try (ensures finally always runs)
                setLoading('render-article-btn', true);
                hideError('article-error');
                
                // Manual-first render: auto-create session from draft if no sessionId exists
                if (!window.currentStorySessionId) {
                    try {
                        await ensureSessionFromDraft();
                    } catch (error) {
                        // Ensure no partial session state
                        window.currentStorySessionId = null;
                        window.currentStorySession = null;
                        
                        showBlockingError(
                            'Can\'t render yet',
                            error?.message || 'Please complete at least one beat before rendering.'
                        );
                        return; // Exit early, but finally will still run
                    }
                }
                
                showRenderStatus();
                const voicePreset = voicePresetEl?.value || 'male_calm';
                
                const { apiFetch } = await import('/api.mjs');
                
                // Call finalize with voice preset
                const finalizeResp = await apiFetch('/story/finalize', {
                    method: 'POST',
                    headers: { 'X-Idempotency-Key': window.currentStorySessionId },
                    body: {
                        sessionId: window.currentStorySessionId,
                        options: {
                            voicePreset: voicePreset
                        }
                    }
                });
                
                if (!finalizeResp.success) {
                    if (finalizeResp.error === 'AUTH_REQUIRED') {
                        showAuthRequiredModal();
                        return;
                    }
                    if (finalizeResp.error === 'FREE_LIMIT_REACHED') {
                        showFreeLimitModal();
                        return;
                    }
                    throw new Error(finalizeResp.error || finalizeResp.message || finalizeResp.detail || 'Failed to finalize story');
                }
                
                const session = finalizeResp.data;
                
                // Check if video is already ready
                if (session.finalVideo?.url) {
                    // Render complete immediately!
                    if (videoEl) {
                        videoEl.src = session.finalVideo.url;
                    }
                    if (videoUrlEl) {
                        videoUrlEl.href = session.finalVideo.url;
                    }
                    if (resultDiv) {
                        resultDiv.classList.remove('hidden');
                    }
                    console.log('[article] Render complete:', session.finalVideo.url);
                    
                    // Redirect to My Shorts after brief preview
                    const jobId = session.finalVideo?.jobId;
                    if (jobId) {
                        setTimeout(() => {
                            window.location.assign(`/my-shorts.html?id=${encodeURIComponent(jobId)}`);
                        }, 800);
                    } else {
                        // Fallback: try to extract from URL path
                        const urlMatch = session.finalVideo?.url?.match(/artifacts\/[^/]+\/([^/]+)\//);
                        if (urlMatch) {
                            setTimeout(() => {
                                window.location.assign(`/my-shorts.html?id=${encodeURIComponent(urlMatch[1])}`);
                            }, 800);
                        }
                    }
                } else {
                    // Poll for completion (similar to oneClickShortFromLink)
                    const sessionId = window.currentStorySessionId;
                    let attempts = 0;
                    const maxAttempts = 60; // 5 minutes max
                    
                    while (attempts < maxAttempts) {
                        await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5 seconds
                        
                        const statusResp = await apiFetch(`/story/${sessionId}`, {
                            method: 'GET'
                        });
                        
                        if (!statusResp.success || !statusResp.data) {
                            throw new Error('Failed to check render status');
                        }
                        
                        const polledSession = statusResp.data;
                        
                        if (polledSession.finalVideo?.url) {
                            // Render complete!
                            if (videoEl) {
                                videoEl.src = polledSession.finalVideo.url;
                            }
                            if (videoUrlEl) {
                                videoUrlEl.href = polledSession.finalVideo.url;
                            }
                            if (resultDiv) {
                                resultDiv.classList.remove('hidden');
                            }
                            
                            console.log('[article] Render complete:', polledSession.finalVideo.url);
                            
                            // Redirect to My Shorts after brief preview
                            const jobId = polledSession.finalVideo?.jobId;
                            if (jobId) {
                                setTimeout(() => {
                                    window.location.assign(`/my-shorts.html?id=${encodeURIComponent(jobId)}`);
                                }, 800);
                            } else {
                                // Fallback: try to extract from URL path
                                const urlMatch = polledSession.finalVideo?.url?.match(/artifacts\/[^/]+\/([^/]+)\//);
                                if (urlMatch) {
                                    setTimeout(() => {
                                        window.location.assign(`/my-shorts.html?id=${encodeURIComponent(urlMatch[1])}`);
                                    }, 800);
                                }
                            }
                            break;
                        }
                        
                        attempts++;
                    }
                    
                    if (attempts >= maxAttempts) {
                        throw new Error('Render timed out - please try again');
                    }
                }
                
            } catch (error) {
                console.error('[article] Render failed:', error);
                showError('article-error', error.message || 'Failed to render video');
            } finally {
                // ALWAYS restore button state (runs even on early returns)
                // Order matters: setLoading(false) first, then restore text, then restore disabled state
                hideRenderStatus();
                setLoading('render-article-btn', false);
                
                if (renderBtn) {
                    renderBtn.textContent = originalText;
                }
                
                // Use centralized button state function (handles disabled state intelligently)
                if (typeof updateRenderArticleButtonState === 'function') {
                    updateRenderArticleButtonState();
                }
            }
        }
        
        // Initialize script preview input handler
        (function() {
            const scriptPreviewEl = document.getElementById('article-script-preview');
            if (scriptPreviewEl) {
                let debounceTimer = null;
                scriptPreviewEl.addEventListener('input', () => {
                    // Guard: Skip if syncing programmatically (prevents scriptSource flip)
                    if (window._syncingTextarea) {
                        return;
                    }
                    
                    // Phase 2: Track raw draft state (only in raw mode)
                    if (currentViewMode === 'raw') {
                        window.rawDraftText = scriptPreviewEl.value;
                        window.rawDirty = true;
                    }
                    
                    // Debounce updates
                    if (debounceTimer) clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        updateScriptCounters();
                        window.scriptSource = 'manual';
                        
                        // If in beat view, re-render to reflect textarea changes
                        if (currentViewMode === 'beats') {
                            renderBeatEditor();
                        }
                    }, 300);
                });
                
                // Update counters on page load if textarea has content
                if (scriptPreviewEl.value.trim()) {
                    updateScriptCounters();
                }
                
                // Phase 2: Initialize raw draft state
                window.rawDraftText = scriptPreviewEl.value;
                window.rawDirty = false;
            }
        })();

        // Expose to window scope for ui-actions.js
        window.summarizeArticle = summarizeArticle;
        window.renderArticle = renderArticle;
        window.prepareStoryboard = prepareStoryboard;


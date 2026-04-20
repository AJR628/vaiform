import dotenv from 'dotenv';

dotenv.config();

import { registerDejaVuFonts } from './src/caption/canvas-fonts.js';
import { startStoryPreviewWorkerRuntime } from './src/workers/story-preview.worker.js';

console.log('[worker] Registering DejaVu fonts...');
const fontStatus = registerDejaVuFonts();
console.log('[worker] Font registration result:', fontStatus);

const runtime = startStoryPreviewWorkerRuntime({ installSignalHandlers: true });

console.log(`[worker] Story preview worker started (runnerId=${runtime.runnerId})`);

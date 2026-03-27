import dotenv from 'dotenv';

dotenv.config();

import { registerDejaVuFonts } from './src/caption/canvas-fonts.js';
import { startStoryFinalizeWorkerRuntime } from './src/workers/story-finalize.worker.js';

console.log('[worker] Registering DejaVu fonts...');
const fontStatus = registerDejaVuFonts();
console.log('[worker] Font registration result:', fontStatus);

const runtime = startStoryFinalizeWorkerRuntime({ installSignalHandlers: true });

console.log(`[worker] Story finalize worker started (runnerId=${runtime.runnerId})`);

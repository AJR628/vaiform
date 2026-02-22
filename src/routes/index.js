import generateRouter from './generate.routes.js';
import creditsRouter from './credits.routes.js';
import webhookRouter from './stripe.webhook.js';
import checkoutRouter from './checkout.routes.js';
import diagRouter from './diag.routes.js';
import whoamiRouter from './whoami.routes.js';
import shortsRouter from './shorts.routes.js';
import assetsRouter from './assets.routes.js';
import limitsRouter from './limits.routes.js';
import storyRouter from './story.routes.js';

export default {
  credits: creditsRouter,
  whoami: whoamiRouter,
  generate: generateRouter,
  webhook: webhookRouter,
  checkout: checkoutRouter,
  diag: diagRouter,
  shorts: shortsRouter,
  assets: assetsRouter,
  limits: limitsRouter,
  story: storyRouter,
};

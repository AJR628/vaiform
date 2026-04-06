import '../instrument.mjs';
import * as Sentry from '@sentry/node';

if (!Sentry.isEnabled()) {
  console.log('[sentry:verify] Skipped: SENTRY_DSN is not configured, so Sentry is disabled.');
  process.exit(0);
}

const verificationError = new Error('Vaiform backend Sentry verification event');
verificationError.name = 'VaiformSentryVerificationError';

const eventId = Sentry.captureException(verificationError, {
  tags: {
    verification: 'manual',
    surface: 'backend-api',
  },
});

const flushed = await Sentry.flush(5000);

if (!flushed) {
  console.error(
    '[sentry:verify] Capture reached Sentry.flush(), but the flush timed out before confirmation.'
  );
  process.exit(1);
}

console.log(
  `[sentry:verify] Sent verification event ${eventId}. Check Sentry issues and traces for the backend API project.`
);

import assert from 'node:assert/strict';
import test from 'node:test';

import { generateStoryFromInput } from '../../src/services/story.llm.service.js';

const FOUR_LINE_STORY = {
  hook: ['Your calendar is full because priorities never earned a gate.'],
  beats: [
    'Name the one outcome that makes today successful.',
    'Decline work that cannot change that outcome.',
  ],
  outro: ['A clear no protects the one yes that matters.'],
  totalDurationSec: 20,
};

const SIX_LINE_STORY = {
  hook: [
    'Your team is slow because every decision waits for consensus.',
    'Speed returns when ownership is visible.',
  ],
  beats: [
    'Give one person the final call before debate begins.',
    'Ask for risks, not permission, during review.',
    'Publish the decision so future work has a reference point.',
  ],
  outro: ['Clear owners turn meetings back into momentum.'],
  totalDurationSec: 24,
};

const EIGHT_LINE_STORY = {
  hook: [
    'Your onboarding fails when every lesson arrives at once.',
    'New users need one useful win first.',
  ],
  beats: [
    'Start with the action that proves the product matters.',
    'Hide advanced choices until the first result is visible.',
    'Use the next prompt to deepen the habit.',
    'Show progress with concrete language, not vague encouragement.',
    'Remove anything that delays the first completed task.',
  ],
  outro: ['A shorter first session can create a longer customer relationship.'],
  totalDurationSec: 36,
};

function openAiResponse(content) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        choices: [
          {
            message: {
              content: typeof content === 'string' ? content : JSON.stringify(content),
            },
          },
        ],
      };
    },
  };
}

async function withMockedOpenAi(contents, fn) {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    const content = contents[Math.min(calls.length - 1, contents.length - 1)];
    return openAiResponse(content);
  };

  try {
    const result = await fn(calls);
    return { calls, result };
  } finally {
    global.fetch = originalFetch;
  }
}

async function generateWithResponses(...responses) {
  return await withMockedOpenAi(
    responses,
    async () =>
      await generateStoryFromInput({
        input: 'Improve product onboarding without adding more screens.',
        inputType: 'idea',
        styleKey: 'default',
      })
  );
}

test('generateStoryFromInput accepts a 4-line hook/beats/outro story', async () => {
  const { result } = await generateWithResponses(FOUR_LINE_STORY);

  assert.equal(result.sentences.length, 4);
  assert.deepEqual(result.sentences, [
    ...FOUR_LINE_STORY.hook,
    ...FOUR_LINE_STORY.beats,
    ...FOUR_LINE_STORY.outro,
  ]);
  assert.equal(result.totalDurationSec, 20);
});

test('generateStoryFromInput accepts a 6-line hook/beats/outro story', async () => {
  const { result } = await generateWithResponses(SIX_LINE_STORY);

  assert.equal(result.sentences.length, 6);
  assert.deepEqual(result.sentences, [
    ...SIX_LINE_STORY.hook,
    ...SIX_LINE_STORY.beats,
    ...SIX_LINE_STORY.outro,
  ]);
  assert.equal(result.totalDurationSec, 24);
});

test('generateStoryFromInput accepts an 8-line hook/beats/outro story', async () => {
  const { result } = await generateWithResponses(EIGHT_LINE_STORY);

  assert.equal(result.sentences.length, 8);
  assert.deepEqual(result.sentences, [
    ...EIGHT_LINE_STORY.hook,
    ...EIGHT_LINE_STORY.beats,
    ...EIGHT_LINE_STORY.outro,
  ]);
  assert.equal(result.totalDurationSec, 36);
});

test('generateStoryFromInput retries a 3-line structured story before accepting output', async () => {
  const threeLineStory = {
    hook: ['The setup is too short to ship.'],
    beats: ['It has only one middle beat.'],
    outro: ['The result must be retried.'],
    totalDurationSec: 18,
  };

  const { calls, result } = await generateWithResponses(threeLineStory, FOUR_LINE_STORY);

  assert.equal(calls.length, 2);
  assert.equal(result.sentences.length, 4);
  assert.deepEqual(result.sentences, [
    ...FOUR_LINE_STORY.hook,
    ...FOUR_LINE_STORY.beats,
    ...FOUR_LINE_STORY.outro,
  ]);
});

test('generateStoryFromInput retries a 9-line structured story before accepting output', async () => {
  const nineLineStory = {
    hook: ['Too much setup slows the idea.', 'The script should not fill every slot by default.'],
    beats: [
      'This beat is useful.',
      'This beat is useful too.',
      'This beat adds detail.',
      'This beat adds more detail.',
      'This beat proves the cap.',
      'This beat exceeds the approved shape.',
    ],
    outro: ['The model should choose the cleaner shorter version.'],
    totalDurationSec: 45,
  };

  const { calls, result } = await generateWithResponses(nineLineStory, SIX_LINE_STORY);

  assert.equal(calls.length, 2);
  assert.equal(result.sentences.length, 6);
});

test('generateStoryFromInput retries a line over 160 characters', async () => {
  const overLineCapStory = {
    hook: ['x'.repeat(161)],
    beats: ['A compact beat keeps the story usable.', 'Another compact beat keeps it clear.'],
    outro: ['The retry should remove the oversized line.'],
    totalDurationSec: 20,
  };

  const { calls, result } = await generateWithResponses(overLineCapStory, FOUR_LINE_STORY);

  assert.equal(calls.length, 2);
  assert.equal(result.sentences.length, 4);
});

test('generateStoryFromInput retries a story over 850 total characters', async () => {
  const longLine = 'x'.repeat(120);
  const overTotalCapStory = {
    hook: [longLine, longLine],
    beats: [longLine, longLine, longLine, longLine, longLine],
    outro: [longLine],
    totalDurationSec: 45,
  };

  const { calls, result } = await generateWithResponses(overTotalCapStory, EIGHT_LINE_STORY);

  assert.equal(calls.length, 2);
  assert.equal(result.sentences.length, 8);
});

test('generateStoryFromInput uses generic-template phrases as soft retry pressure only', async () => {
  const genericButHardValidStory = {
    hook: ['Your launch drifts when no one owns the next decision.'],
    beats: [
      'Step 1 is to name the blocker before adding another meeting.',
      'Then assign one owner.',
    ],
    outro: ['Progress gets easier when the handoff is visible.'],
    totalDurationSec: 21,
  };

  const { calls, result } = await generateWithResponses(genericButHardValidStory, FOUR_LINE_STORY);

  assert.equal(calls.length, 2);
  assert.deepEqual(result.sentences, [
    ...FOUR_LINE_STORY.hook,
    ...FOUR_LINE_STORY.beats,
    ...FOUR_LINE_STORY.outro,
  ]);
});

test('generateStoryFromInput does not duplicate source text when fallback has fewer than 4 usable lines', async () => {
  await assert.rejects(
    async () => {
      await generateWithResponses({ unexpected: true });
    },
    {
      message: 'STORY_OUTPUT_INVALID',
    }
  );
});

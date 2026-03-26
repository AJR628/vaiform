import assert from 'node:assert/strict';
import test from 'node:test';

import { createMetricsRegistry } from '../../src/observability/metrics-registry.js';

test('metrics registry records counters, gauges, and histograms with labels', () => {
  const registry = createMetricsRegistry({ now: () => Date.UTC(2026, 2, 26, 10, 0, 0) });
  registry.registerDefinition({
    name: 'example_counter_total',
    type: 'counter',
    labels: ['outcome'],
  });
  registry.registerDefinition({
    name: 'example_depth',
    type: 'gauge',
  });
  registry.registerDefinition({
    name: 'example_duration_ms',
    type: 'histogram',
    labels: ['stage'],
  });

  registry.incrementCounter('example_counter_total', 2, { outcome: 'ok' });
  registry.setGauge('example_depth', 4);
  registry.observeHistogram('example_duration_ms', 125, { stage: 'render_video' });
  registry.observeHistogram('example_duration_ms', 250, { stage: 'render_video' });

  const snapshot = registry.snapshot();
  assert.deepEqual(snapshot.definitions.map((definition) => definition.name), [
    'example_counter_total',
    'example_depth',
    'example_duration_ms',
  ]);
  assert.deepEqual(snapshot.counters, [
    {
      name: 'example_counter_total',
      type: 'counter',
      labels: { outcome: 'ok' },
      value: 2,
      updatedAt: '2026-03-26T10:00:00.000Z',
    },
  ]);
  assert.deepEqual(snapshot.gauges, [
    {
      name: 'example_depth',
      type: 'gauge',
      labels: {},
      value: 4,
      updatedAt: '2026-03-26T10:00:00.000Z',
    },
  ]);
  assert.deepEqual(snapshot.histograms, [
    {
      name: 'example_duration_ms',
      type: 'histogram',
      labels: { stage: 'render_video' },
      count: 2,
      sum: 375,
      min: 125,
      max: 250,
      lastValue: 250,
      updatedAt: '2026-03-26T10:00:00.000Z',
    },
  ]);
});

test('metrics registry rejects definition drift for the same metric name', () => {
  const registry = createMetricsRegistry();
  registry.registerDefinition({
    name: 'example_counter_total',
    type: 'counter',
    labels: ['outcome'],
  });

  assert.throws(
    () =>
      registry.registerDefinition({
        name: 'example_counter_total',
        type: 'counter',
        labels: ['status'],
      }),
    /Metric definition drift detected/
  );
});

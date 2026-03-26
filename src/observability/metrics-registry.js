function normalizeMetricName(name) {
  const normalized = typeof name === 'string' ? name.trim() : '';
  if (!normalized) {
    throw new Error('Metric name must be a non-empty string.');
  }
  return normalized;
}

function normalizeMetricType(type) {
  const normalized = typeof type === 'string' ? type.trim().toLowerCase() : '';
  if (!['counter', 'gauge', 'histogram'].includes(normalized)) {
    throw new Error(`Unsupported metric type: ${type}`);
  }
  return normalized;
}

function normalizeLabels(labels = {}) {
  if (!labels || typeof labels !== 'object') return {};
  return Object.fromEntries(
    Object.entries(labels)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [String(key), String(value)])
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function labelKey(labels = {}) {
  const normalized = normalizeLabels(labels);
  return JSON.stringify(normalized);
}

function cloneSeries(seriesMap) {
  return Array.from(seriesMap.values()).map((series) => ({
    ...series,
    labels: { ...series.labels },
  }));
}

export function createMetricsRegistry({ now = () => Date.now() } = {}) {
  const definitions = new Map();
  const counters = new Map();
  const gauges = new Map();
  const histograms = new Map();
  const sinks = new Set();

  function registerDefinition(definition) {
    const name = normalizeMetricName(definition?.name);
    const type = normalizeMetricType(definition?.type);
    const labels = Array.isArray(definition?.labels)
      ? definition.labels.map((label) => String(label))
      : [];
    const next = {
      name,
      type,
      description:
        typeof definition?.description === 'string' && definition.description.trim().length > 0
          ? definition.description.trim()
          : null,
      labels,
    };
    const existing = definitions.get(name);
    if (existing) {
      if (
        existing.type !== next.type ||
        JSON.stringify(existing.labels) !== JSON.stringify(next.labels) ||
        existing.description !== next.description
      ) {
        throw new Error(`Metric definition drift detected for ${name}`);
      }
      return existing;
    }
    definitions.set(name, next);
    return next;
  }

  function getDefinition(name) {
    const normalized = normalizeMetricName(name);
    const definition = definitions.get(normalized);
    if (!definition) {
      throw new Error(`Metric ${normalized} is not registered.`);
    }
    return definition;
  }

  function emitToSinks(record) {
    for (const sink of sinks) {
      sink(record);
    }
  }

  function incrementCounter(name, value = 1, labels = {}) {
    const definition = getDefinition(name);
    if (definition.type !== 'counter') {
      throw new Error(`Metric ${definition.name} is not a counter.`);
    }
    const normalizedLabels = normalizeLabels(labels);
    const key = `${definition.name}:${labelKey(normalizedLabels)}`;
    const current =
      counters.get(key) || {
        name: definition.name,
        type: definition.type,
        labels: normalizedLabels,
        value: 0,
        updatedAt: null,
      };
    current.value += Number(value);
    current.updatedAt = new Date(now()).toISOString();
    counters.set(key, current);
    emitToSinks({
      kind: 'counter',
      name: definition.name,
      value: Number(value),
      labels: normalizedLabels,
      ts: current.updatedAt,
    });
    return current;
  }

  function setGauge(name, value, labels = {}) {
    const definition = getDefinition(name);
    if (definition.type !== 'gauge') {
      throw new Error(`Metric ${definition.name} is not a gauge.`);
    }
    const normalizedLabels = normalizeLabels(labels);
    const key = `${definition.name}:${labelKey(normalizedLabels)}`;
    const current = {
      name: definition.name,
      type: definition.type,
      labels: normalizedLabels,
      value: Number(value),
      updatedAt: new Date(now()).toISOString(),
    };
    gauges.set(key, current);
    emitToSinks({
      kind: 'gauge',
      name: definition.name,
      value: Number(value),
      labels: normalizedLabels,
      ts: current.updatedAt,
    });
    return current;
  }

  function observeHistogram(name, value, labels = {}) {
    const definition = getDefinition(name);
    if (definition.type !== 'histogram') {
      throw new Error(`Metric ${definition.name} is not a histogram.`);
    }
    const normalizedLabels = normalizeLabels(labels);
    const key = `${definition.name}:${labelKey(normalizedLabels)}`;
    const current =
      histograms.get(key) || {
        name: definition.name,
        type: definition.type,
        labels: normalizedLabels,
        count: 0,
        sum: 0,
        min: null,
        max: null,
        lastValue: null,
        updatedAt: null,
      };
    const numericValue = Number(value);
    current.count += 1;
    current.sum += numericValue;
    current.min = current.min == null ? numericValue : Math.min(current.min, numericValue);
    current.max = current.max == null ? numericValue : Math.max(current.max, numericValue);
    current.lastValue = numericValue;
    current.updatedAt = new Date(now()).toISOString();
    histograms.set(key, current);
    emitToSinks({
      kind: 'histogram',
      name: definition.name,
      value: numericValue,
      labels: normalizedLabels,
      ts: current.updatedAt,
    });
    return current;
  }

  function addSink(listener) {
    if (typeof listener !== 'function') {
      throw new Error('Metrics sink must be a function.');
    }
    sinks.add(listener);
    return () => sinks.delete(listener);
  }

  function reset() {
    counters.clear();
    gauges.clear();
    histograms.clear();
  }

  function snapshot() {
    return {
      generatedAt: new Date(now()).toISOString(),
      definitions: Array.from(definitions.values()).map((definition) => ({
        ...definition,
        labels: [...definition.labels],
      })),
      counters: cloneSeries(counters),
      gauges: cloneSeries(gauges),
      histograms: cloneSeries(histograms),
    };
  }

  return {
    addSink,
    getDefinition,
    incrementCounter,
    observeHistogram,
    registerDefinition,
    reset,
    setGauge,
    snapshot,
  };
}

export default createMetricsRegistry;

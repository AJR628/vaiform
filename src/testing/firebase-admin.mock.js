import fs from 'node:fs';

const STATE_KEY = Symbol.for('vaiform.test.firebaseState');

function ensureState() {
  if (!globalThis[STATE_KEY]) {
    globalThis[STATE_KEY] = {
      collections: new Map(),
      storage: new Map(),
      authTokens: new Map(),
      queryLog: [],
      bucketName: process.env.FIREBASE_STORAGE_BUCKET?.trim() || 'vaiform-test.appspot.com',
    };
  }
  return globalThis[STATE_KEY];
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value) && !isTimestamp(value);
}

function makeTimestamp(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  const iso = date.toISOString();
  const ms = date.getTime();
  return {
    __vaiformTimestampMs: ms,
    toDate() {
      return new Date(ms);
    },
    toMillis() {
      return ms;
    },
    toJSON() {
      return iso;
    },
    valueOf() {
      return ms;
    },
  };
}

function isTimestamp(value) {
  return value != null && typeof value === 'object' && Number.isFinite(value.__vaiformTimestampMs);
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (isTimestamp(value)) {
    return makeTimestamp(value.__vaiformTimestampMs);
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = cloneValue(entry);
    }
    return out;
  }
  return value;
}

function makeServerTimestampSentinel() {
  return { __vaiformServerTimestamp: true };
}

function isServerTimestampSentinel(value) {
  return value != null && typeof value === 'object' && value.__vaiformServerTimestamp === true;
}

function materializeValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => materializeValue(item));
  }
  if (isServerTimestampSentinel(value)) {
    return makeTimestamp();
  }
  if (isTimestamp(value)) {
    return makeTimestamp(value.__vaiformTimestampMs);
  }
  if (value instanceof Date) {
    return makeTimestamp(value);
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = materializeValue(entry);
    }
    return out;
  }
  return value;
}

function deepMerge(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) {
    return cloneValue(source);
  }
  const out = cloneValue(target);
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = cloneValue(value);
    }
  }
  return out;
}

function getCollectionMap(name) {
  const state = ensureState();
  if (!state.collections.has(name)) {
    state.collections.set(name, new Map());
  }
  return state.collections.get(name);
}

function toComparable(value) {
  if (isTimestamp(value)) return value.__vaiformTimestampMs;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  return value;
}

function getFieldValue(data, field) {
  if (!field.includes('.')) return data?.[field];
  return field.split('.').reduce((acc, key) => acc?.[key], data);
}

class FakeDocSnapshot {
  constructor(id, data) {
    this.id = id;
    this._data = data == null ? null : cloneValue(data);
  }

  get exists() {
    return this._data != null;
  }

  data() {
    return this._data == null ? undefined : cloneValue(this._data);
  }
}

class FakeQuerySnapshot {
  constructor(docs) {
    this.docs = docs;
  }
}

class FakeDocRef {
  constructor(collectionName, id) {
    this.collectionName = collectionName;
    this.id = id;
    this.path = `${collectionName}/${id}`;
  }

  async get() {
    const data = getCollectionMap(this.collectionName).get(this.id) ?? null;
    return new FakeDocSnapshot(this.id, data);
  }

  async set(data, options = {}) {
    const collection = getCollectionMap(this.collectionName);
    const current = collection.get(this.id);
    const nextData = materializeValue(cloneValue(data));
    if (options?.merge && current != null) {
      collection.set(this.id, deepMerge(current, nextData));
      return;
    }
    collection.set(this.id, nextData);
  }

  async delete() {
    getCollectionMap(this.collectionName).delete(this.id);
  }

  async update(data) {
    const collection = getCollectionMap(this.collectionName);
    const current = collection.get(this.id);
    if (current == null) {
      const error = new Error(`Missing document for update: ${this.path}`);
      error.code = 5;
      throw error;
    }
    const nextData = materializeValue(cloneValue(data));
    collection.set(this.id, deepMerge(current, nextData));
  }
}

class FakeQuery {
  constructor(collectionName, config = {}) {
    this.collectionName = collectionName;
    this.filters = config.filters || [];
    this.order = config.order || null;
    this.limitCount = config.limitCount ?? null;
    this.cursor = config.cursor ?? null;
  }

  where(field, op, value) {
    if (op !== '==' && op !== 'in') {
      throw new Error(`Unsupported fake Firestore operator: ${op}`);
    }
    if (op === 'in' && !Array.isArray(value)) {
      throw new Error('Fake Firestore "in" operator requires an array value');
    }
    return new FakeQuery(this.collectionName, {
      ...this,
      filters: [...this.filters, { field, op, value: cloneValue(value) }],
    });
  }

  orderBy(field, direction = 'asc') {
    return new FakeQuery(this.collectionName, {
      ...this,
      order: { field, direction },
    });
  }

  limit(count) {
    return new FakeQuery(this.collectionName, {
      ...this,
      limitCount: count,
    });
  }

  startAfter(value) {
    return new FakeQuery(this.collectionName, {
      ...this,
      cursor: value,
    });
  }

  async get() {
    const collection = getCollectionMap(this.collectionName);
    let docs = [...collection.entries()].map(([id, data]) => ({ id, data: cloneValue(data) }));

    for (const filter of this.filters) {
      docs = docs.filter((entry) => {
        const fieldValue = getFieldValue(entry.data, filter.field);
        if (filter.op === 'in') return filter.value.includes(fieldValue);
        return fieldValue === filter.value;
      });
    }

    if (this.order) {
      const direction = this.order.direction === 'desc' ? -1 : 1;
      docs.sort((a, b) => {
        const left = toComparable(getFieldValue(a.data, this.order.field));
        const right = toComparable(getFieldValue(b.data, this.order.field));
        if (left === right) return 0;
        if (left == null) return 1;
        if (right == null) return -1;
        return left < right ? -1 * direction : 1 * direction;
      });
    }

    if (this.cursor != null && this.order) {
      const cursorValue = toComparable(this.cursor);
      docs = docs.filter((entry) => {
        const value = toComparable(getFieldValue(entry.data, this.order.field));
        if (value == null) return false;
        if (this.order.direction === 'desc') return value < cursorValue;
        return value > cursorValue;
      });
    }

    if (Number.isInteger(this.limitCount) && this.limitCount >= 0) {
      docs = docs.slice(0, this.limitCount);
    }

    ensureState().queryLog.push({
      atMs: Date.now(),
      collectionName: this.collectionName,
      filters: cloneValue(this.filters),
      order: cloneValue(this.order),
      limitCount: this.limitCount,
      returnedDocCount: docs.length,
    });

    return new FakeQuerySnapshot(docs.map((entry) => new FakeDocSnapshot(entry.id, entry.data)));
  }
}

class FakeCollectionRef extends FakeQuery {
  constructor(collectionName) {
    super(collectionName);
    this.collectionName = collectionName;
  }

  doc(id) {
    return new FakeDocRef(this.collectionName, id);
  }
}

class FakeStorageFile {
  constructor(filePath) {
    this.path = filePath;
  }

  async save(buffer, options = {}) {
    const state = ensureState();
    state.storage.set(this.path, {
      body: Buffer.isBuffer(buffer) ? Buffer.from(buffer) : Buffer.from(String(buffer)),
      metadata: cloneValue(options.metadata || {}),
      contentType: options.contentType || options.metadata?.contentType || null,
    });
  }

  async download() {
    const entry = ensureState().storage.get(this.path);
    if (!entry) {
      const error = new Error(`Storage object not found: ${this.path}`);
      error.code = 404;
      throw error;
    }
    return [Buffer.from(entry.body)];
  }

  async exists() {
    return [ensureState().storage.has(this.path)];
  }

  async getMetadata() {
    const entry = ensureState().storage.get(this.path);
    if (!entry) {
      const error = new Error(`Storage object not found: ${this.path}`);
      error.code = 404;
      throw error;
    }
    return [
      {
        metadata: cloneValue(entry.metadata?.metadata || {}),
        contentType: entry.contentType,
      },
    ];
  }
}

const fakeDb = {
  collection(name) {
    return new FakeCollectionRef(name);
  },
  async runTransaction(handler) {
    const operations = [];
    const tx = {
      async get(ref) {
        return await ref.get();
      },
      set(ref, data, options) {
        operations.push(async () => ref.set(data, options));
      },
      update(ref, data) {
        operations.push(async () => ref.update(data));
      },
      delete(ref) {
        operations.push(async () => ref.delete());
      },
    };
    const result = await handler(tx);
    for (const operation of operations) {
      await operation();
    }
    return result;
  },
};

const fakeBucket = {
  get name() {
    return ensureState().bucketName;
  },
  file(filePath) {
    return new FakeStorageFile(filePath);
  },
  async upload(localPath, options = {}) {
    const body = fs.readFileSync(localPath);
    const destination = options.destination;
    if (!destination) {
      throw new Error('Fake bucket upload requires destination');
    }
    ensureState().storage.set(destination, {
      body,
      metadata: cloneValue(options.metadata || {}),
      contentType: options.metadata?.contentType || null,
    });
    return [{ name: destination }];
  },
};

const firestore = Object.assign(() => fakeDb, {
  FieldValue: {
    serverTimestamp() {
      return makeServerTimestampSentinel();
    },
  },
});

const mockAdmin = {
  apps: [{}],
  credential: {
    cert(value) {
      return value;
    },
    applicationDefault() {
      return {};
    },
  },
  initializeApp() {
    return mockAdmin;
  },
  auth() {
    return {
      async verifyIdToken(token) {
        const decoded = ensureState().authTokens.get(token);
        if (!decoded) {
          const error = new Error('AUTH_INVALID');
          error.code = 'auth/invalid-id-token';
          throw error;
        }
        return cloneValue(decoded);
      },
    };
  },
  firestore,
  storage() {
    return {
      bucket() {
        return fakeBucket;
      },
    };
  },
};

export function resetMockFirebase() {
  const state = ensureState();
  state.collections.clear();
  state.storage.clear();
  state.authTokens.clear();
  state.queryLog = [];
}

export function seedAuthToken(token, decoded) {
  ensureState().authTokens.set(token, cloneValue(decoded));
}

export function timestamp(value) {
  return makeTimestamp(value);
}

export function seedDoc(collectionName, id, data) {
  getCollectionMap(collectionName).set(id, materializeValue(cloneValue(data)));
}

export function readDoc(collectionName, id) {
  const value = getCollectionMap(collectionName).get(id);
  return value == null ? null : cloneValue(value);
}

export function readQueryLog() {
  return cloneValue(ensureState().queryLog);
}

export function seedStorageObject(filePath, body, metadata = {}) {
  const content =
    body == null
      ? Buffer.alloc(0)
      : Buffer.isBuffer(body)
        ? Buffer.from(body)
        : typeof body === 'string'
          ? Buffer.from(body, 'utf8')
          : Buffer.from(JSON.stringify(body), 'utf8');
  ensureState().storage.set(filePath, {
    body: content,
    metadata: cloneValue(metadata),
    contentType: metadata.contentType || null,
  });
}

export function readStorageObject(filePath) {
  const entry = ensureState().storage.get(filePath);
  if (!entry) return null;
  return {
    body: Buffer.from(entry.body),
    metadata: cloneValue(entry.metadata),
    contentType: entry.contentType,
  };
}

export const db = fakeDb;
export const bucket = fakeBucket;
export default mockAdmin;

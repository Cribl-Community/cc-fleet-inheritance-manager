import assert from 'node:assert/strict';
import test from 'node:test';

import * as api from './api.ts';
import { isReusablePackSource } from './packSource.ts';
import { buildCrbl, extractCrbl } from './test/crblFixture.ts';

const ENOENT_EXPORT_ERROR = JSON.stringify({
  status: 'error',
  message: "ENOENT: no such file or directory, rename '.../package.json' -> '/opt/cribl_config/state/packs/demo-pack.tmp/package.json'",
});

function demoCrbl(): Uint8Array<ArrayBuffer> {
  return buildCrbl({
    'package.json': JSON.stringify({ name: 'demo-pack', version: '1.2.7', displayName: 'Demo Pack', description: 'Old' }),
    'default/pipelines/main/conf.yml': 'id: main\n',
  });
}

async function readBody(init?: RequestInit): Promise<Uint8Array> {
  return new Uint8Array(await (init?.body as Blob).arrayBuffer());
}

test('fetchPacks converts string source values to a usable pack source object', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => new Response(JSON.stringify([
    {
      id: 'demo-pack',
      displayName: 'Demo Pack',
      source: 'https://example.com/demo.crbl',
    },
  ]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch;

  try {
    const packs = await api.fetchPacks();

    assert.equal(packs.length, 1);
    assert.equal(packs[0].source?.location, 'https://example.com/demo.crbl');
    assert.equal(packs[0].source?.type, 'url');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('exportPack tries the group-scoped endpoint first and falls back to the root endpoint on 404', async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);

    if (url.startsWith('/api/v1/m/demo-group/')) {
      return new Response('Not Found', { status: 404 });
    }

    return new Response(new Blob(['pack-data']), { status: 200 });
  }) as typeof fetch;

  try {
    const blob = await api.exportPack('demo-pack', 'merge', 'demo-pack.crbl', 'demo-group');

    assert.equal(await blob.text(), 'pack-data');
    assert.deepEqual(urls, [
      '/api/v1/m/demo-group/packs/demo-pack/export?mode=merge&filename=demo-pack.crbl',
      '/api/v1/packs/demo-pack/export?mode=merge&filename=demo-pack.crbl',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('exportPack throws PackExportAssemblyError on the package.json ENOENT failure and does not switch modes', async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(ENOENT_EXPORT_ERROR, { status: 500 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => api.exportPack('demo-pack', 'merge', 'demo-pack.crbl', 'demo-group'),
      (error: unknown) => error instanceof api.PackExportAssemblyError && /demo-group/.test(error.message),
    );
    assert.deepEqual(urls, ['/api/v1/m/demo-group/packs/demo-pack/export?mode=merge&filename=demo-pack.crbl']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publishPackEdits exports, rewrites package.json, uploads to the group, and upgrades to the new version', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; url: string; init?: RequestInit }> = [];
  let uploadedArchive: Uint8Array | undefined;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, init });

    if (method === 'GET') {
      return new Response(demoCrbl(), { status: 200 });
    }

    if (method === 'PUT') {
      uploadedArchive = await readBody(init);
      return new Response(JSON.stringify({ source: 'demo-pack.crbl' }), { status: 200 });
    }

    return new Response(JSON.stringify({ id: 'demo-pack', version: '1.2.8' }), { status: 200 });
  }) as typeof fetch;

  try {
    const progress: string[] = [];
    const result = await api.publishPackEdits('demo-pack', { description: 'New description' }, {
      groupId: 'demo-group',
      onProgress: (step) => progress.push(step),
    });

    assert.deepEqual(calls.map(({ method, url }) => `${method} ${url}`), [
      'GET /api/v1/m/demo-group/packs/demo-pack/export?mode=merge&filename=demo-pack.crbl',
      'PUT /api/v1/m/demo-group/packs?filename=demo-pack.crbl',
      'PATCH /api/v1/m/demo-group/packs/demo-pack',
    ]);
    assert.deepEqual(JSON.parse(String(calls[2].init?.body)), {
      source: 'demo-pack.crbl',
      minor: true,
      allowCustomFunctions: true,
    });

    assert.ok(uploadedArchive);
    const files = extractCrbl(uploadedArchive);
    const packageJson = JSON.parse(files['package.json']);
    assert.equal(packageJson.description, 'New description');
    assert.equal(packageJson.version, '1.2.8');
    assert.equal(files['default/pipelines/main/conf.yml'], 'id: main\n');

    assert.equal(result.previousVersion, '1.2.7');
    assert.equal(result.newVersion, '1.2.8');
    assert.equal(result.pack.version, '1.2.8');
    assert.equal(result.exportMode, 'merge');
    assert.deepEqual(result.warnings, []);
    assert.equal(progress.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publishPackEdits only uses default_only export when explicitly allowed, and warns about it', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);

    if (method === 'GET' && url.includes('mode=merge')) {
      return new Response(ENOENT_EXPORT_ERROR, { status: 500 });
    }

    if (method === 'GET') {
      return new Response(demoCrbl(), { status: 200 });
    }

    if (method === 'PUT') {
      return new Response(JSON.stringify({ source: 'demo-pack.crbl' }), { status: 200 });
    }

    return new Response(JSON.stringify({ id: 'demo-pack', version: '1.2.8' }), { status: 200 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => api.publishPackEdits('demo-pack', { description: 'x' }, { groupId: 'demo-group' }),
      api.PackExportAssemblyError,
    );
    assert.equal(calls.length, 1);

    calls.length = 0;
    const result = await api.publishPackEdits('demo-pack', { description: 'x' }, {
      groupId: 'demo-group',
      allowOriginalConfigExport: true,
    });

    assert.equal(calls[1], 'GET /api/v1/m/demo-group/packs/demo-pack/export?mode=default_only&filename=demo-pack.crbl');
    assert.equal(result.exportMode, 'default_only');
    assert.match(result.warnings.join(' '), /Local modifications to this pack were not included/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('updatePack issues a PATCH request to the pack upgrade endpoint', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ id: 'demo-pack', version: '2.0.0' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await api.updatePack('demo-pack', 'https://example.com/demo.crbl', { minor: true });

    assert.equal(calls.length, 1);
    assert.equal(String(calls[0].input), '/api/v1/packs/demo-pack');
    assert.equal(calls[0].init?.method, 'PATCH');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      source: 'https://example.com/demo.crbl',
      minor: true,
      allowCustomFunctions: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('updatePack treats an up-to-date upgrade response as a no-op and returns the current pack', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    const url = String(input);

    if (init?.method === 'PATCH') {
      assert.equal(url, '/api/v1/packs/demo-pack');
      return new Response(JSON.stringify({ message: 'failed to upgrade: Version 1.2.7 is up to date' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ id: 'demo-pack', displayName: 'Demo Pack', version: '1.2.7' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const pack = await api.updatePack('demo-pack', 'https://example.com/demo.crbl', { minor: true });

    assert.equal(pack.version, '1.2.7');
    assert.equal(calls.length, 2);
    assert.equal(String(calls[0].input), '/api/v1/packs/demo-pack');
    assert.equal(calls[0].init?.method, 'PATCH');
    assert.equal(String(calls[1].input), '/api/v1/packs/demo-pack');
    assert.equal(calls[1].init?.method, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('updatePack uses the selected group-scoped pack endpoint when a group context is available', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ id: 'demo-pack', displayName: 'Demo Pack', version: '2.0.0' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await api.updatePack('demo-pack', 'staged:demo-pack', { minor: true, groupId: 'demo-group' });

    assert.equal(calls.length, 1);
    assert.equal(String(calls[0].input), '/api/v1/m/demo-group/packs/demo-pack');
    assert.equal(calls[0].init?.method, 'PATCH');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      source: 'staged:demo-pack',
      minor: true,
      allowCustomFunctions: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('updatePack falls back to the root pack endpoint when the group-scoped overwrite route is not found', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    const url = String(input);

    if (url === '/api/v1/m/demo-group/packs/demo-pack') {
      return new Response(JSON.stringify({ message: 'Item not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ id: 'demo-pack', displayName: 'Demo Pack', version: '2.0.0' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const pack = await api.updatePack('demo-pack', 'staged:demo-pack', { minor: true, groupId: 'demo-group' });

    assert.equal(pack.version, '2.0.0');
    assert.equal(calls.length, 2);
    assert.equal(String(calls[0].input), '/api/v1/m/demo-group/packs/demo-pack');
    assert.equal(String(calls[1].input), '/api/v1/packs/demo-pack');
    assert.equal(calls[1].init?.method, 'PATCH');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('isReusablePackSource accepts uploaded .crbl source names created by the API', () => {
  assert.equal(isReusablePackSource('cribl_splunk_forwarder_windows_classic_events_to_json.crbl'), true);
  assert.equal(isReusablePackSource('https://example.com/demo.crbl'), true);
  assert.equal(isReusablePackSource('staged:demo-pack'), true);
  assert.equal(isReusablePackSource('file:///tmp/demo.crbl'), false);
  assert.equal(isReusablePackSource('/tmp/demo.crbl'), false);
});

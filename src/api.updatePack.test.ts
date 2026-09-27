import assert from 'node:assert/strict';
import test from 'node:test';

import * as api from './api.ts';
import { isReusablePackSource } from './components/PacksView.tsx';

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

test('exportPack falls back to the group-scoped pack endpoint when the root export is not found', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });

    const url = String(input);
    if (url === '/api/v1/packs/demo-pack/export?mode=merge&filename=demo-pack.crbl') {
      return new Response('Not Found', { status: 404 });
    }

    if (url === '/api/v1/m/demo-group/packs/demo-pack/export?mode=merge&filename=demo-pack.crbl') {
      return new Response(new Blob(['pack-data']), {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    }

    return new Response(JSON.stringify({ source: 'staged:demo-pack' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const source = await api.stagePackForUpgrade('demo-pack', 'demo-group');

    assert.equal(source, 'staged:demo-pack');
    assert.equal(calls.length, 2);
    assert.equal(String(calls[0].input), '/api/v1/m/demo-group/packs/demo-pack/export?mode=merge&filename=demo-pack.crbl');
    assert.equal(String(calls[1].input), '/api/v1/packs?filename=demo-pack.crbl');
    assert.equal(calls[1].init?.method, 'PUT');
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

test('isReusablePackSource accepts uploaded .crbl source names created by the API', () => {
  assert.equal(isReusablePackSource('cribl_splunk_forwarder_windows_classic_events_to_json.crbl'), true);
  assert.equal(isReusablePackSource('https://example.com/demo.crbl'), true);
  assert.equal(isReusablePackSource('staged:demo-pack'), true);
  assert.equal(isReusablePackSource('file:///tmp/demo.crbl'), false);
  assert.equal(isReusablePackSource('/tmp/demo.crbl'), false);
});

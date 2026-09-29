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

test('fetchPackRelationshipSummaries fetches each resource once and still detects route drift', async () => {
  const originalFetch = globalThis.fetch;
  const counts = new Map<string, number>();
  const responses: Record<string, unknown> = {
    '/api/v1/packs': [{ id: 'drift-pack' }],
    '/api/v1/products/stream/groups': [{ id: 'fleet-a' }, { id: 'fleet-b' }],
    '/api/v1/products/edge/groups': [],
    '/api/v1/m/fleet-a/packs': [{ id: 'drift-pack' }],
    '/api/v1/m/fleet-b/packs': [{ id: 'drift-pack' }],
    '/api/v1/m/fleet-a/p/drift-pack/routes': [{ routes: [{ id: 'r1', filter: 'true' }] }],
    '/api/v1/m/fleet-b/p/drift-pack/routes': [{ routes: [{ id: 'r1', filter: 'false' }] }],
  };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    counts.set(url, (counts.get(url) ?? 0) + 1);

    return url in responses
      ? new Response(JSON.stringify(responses[url]), { status: 200 })
      : new Response('Not Found', { status: 404 });
  }) as typeof fetch;

  try {
    const summaries = await api.fetchPackRelationshipSummaries();
    const summary = summaries.find((entry) => entry.id === 'drift-pack');

    assert.ok(summary);
    assert.deepEqual(summary.usageLocations.map((location) => location.fleetId), ['fleet-a', 'fleet-b']);
    assert.deepEqual([...counts.entries()].filter(([, count]) => count > 1), []);

    counts.clear();
    const packs = await api.fetchPacks();
    const pack = packs.find((entry) => entry.id === 'drift-pack');

    assert.equal(pack?.configDrift, true);
    assert.equal(pack?.status, 'inherited-modified');
    assert.deepEqual([...counts.entries()].filter(([, count]) => count > 1), []);
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

test('exportPack treats ENOENT inside the .tmp export folder (inheriting child fleet) as PackExportAssemblyError', async () => {
  const originalFetch = globalThis.fetch;
  const tmpDefaultError = JSON.stringify({
    status: 'error',
    message:
      "ENOENT: no such file or directory, rename '/opt/cribl_config/groups/child/default/demo-pack' -> '/opt/cribl_config/state/packs/demo-pack.bHx4a0O.tmp/default'",
  });

  globalThis.fetch = (async () => new Response(tmpDefaultError, { status: 500 })) as typeof fetch;

  try {
    await assert.rejects(
      () => api.exportPack('demo-pack', 'merge', 'demo-pack.crbl', 'child'),
      api.PackExportAssemblyError,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publishPackEdits installs an explicit shared version instead of bumping the exported one', async () => {
  const originalFetch = globalThis.fetch;
  let uploadedArchive: Uint8Array | undefined;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';

    if (method === 'GET') {
      return new Response(demoCrbl(), { status: 200 });
    }

    if (method === 'PUT') {
      uploadedArchive = await readBody(init);
      return new Response(JSON.stringify({ source: 'demo-pack.crbl' }), { status: 200 });
    }

    return new Response(JSON.stringify({ id: 'demo-pack', version: '1.2.12' }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await api.publishPackEdits('demo-pack', { description: 'x' }, { groupId: 'demo-group', version: '1.2.12' });

    assert.ok(uploadedArchive);
    assert.equal(JSON.parse(extractCrbl(uploadedArchive)['package.json']).version, '1.2.12');
    assert.equal(result.previousVersion, '1.2.7');
    assert.equal(result.newVersion, '1.2.12');
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

test('fetchPendingPackChanges separates this pack\'s files from other pending changes in the same groups', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        count: 1,
        items: [
          {
            files: [
              { path: 'groups/parentfleet/default/demo-pack/package.json', index: ' ', working_dir: 'M' },
              { path: 'groups/parentfleet/local/cribl/pipelines/other/conf.yml', index: ' ', working_dir: 'M' },
              { path: 'groups/unrelated/default/demo-pack/package.json', index: ' ', working_dir: 'M' },
            ],
            not_added: ['groups/parentfleet/default/demo-pack/default/pipelines/main/conf.yml'],
            created: [],
            deleted: [],
            modified: [],
            staged: [],
            renamed: [],
            conflicted: [],
          },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;

  try {
    const pending = await api.fetchPendingPackChanges('demo-pack', ['parentfleet', 'child_fleet2']);

    assert.deepEqual(pending.packFiles, [
      'groups/parentfleet/default/demo-pack/default/pipelines/main/conf.yml',
      'groups/parentfleet/default/demo-pack/package.json',
    ]);
    assert.deepEqual(pending.otherFiles, ['groups/parentfleet/local/cribl/pipelines/other/conf.yml']);
    assert.deepEqual(pending.conflictedFiles, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('commitConfigChanges commits only the given files and deployGroup deploys that commit', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });

    if (url.endsWith('/version/commit')) {
      return new Response(JSON.stringify({ count: 1, items: [{ commit: 'abc1234def', branch: 'main', summary: {} }] }), { status: 200 });
    }

    return new Response(JSON.stringify({ count: 1, items: [{ id: 'child_fleet2', configVersion: 'abc1234def' }] }), { status: 200 });
  }) as typeof fetch;

  try {
    const commit = await api.commitConfigChanges('Update pack demo-pack', ['groups/parentfleet/default/demo-pack/package.json']);
    const configVersion = await api.deployGroup('child_fleet2', commit, 'edge');

    assert.equal(commit, 'abc1234def');
    assert.equal(configVersion, 'abc1234def');
    assert.deepEqual(calls, [
      {
        method: 'POST',
        url: '/api/v1/version/commit',
        body: { message: 'Update pack demo-pack', files: ['groups/parentfleet/default/demo-pack/package.json'] },
      },
      { method: 'PATCH', url: '/api/v1/products/edge/groups/child_fleet2/deploy', body: { version: 'abc1234def' } },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('installEditedPack with replaceExisting reinstalls the archive over the target pack with force', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; url: string; body?: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url: String(input), body: method === 'POST' ? String(init?.body) : undefined });

    if (method === 'PUT') {
      return new Response(JSON.stringify({ source: 'demo-pack.crbl' }), { status: 200 });
    }

    return new Response(JSON.stringify({ items: [{ id: 'demo-pack', version: '1.2.9' }] }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await api.installEditedPack(
      'demo-pack',
      { archive: demoCrbl(), exportMode: 'merge', version: '1.2.7' },
      {},
      { groupId: 'target-group', version: '1.2.9', replaceExisting: true },
    );

    assert.deepEqual(calls.map(({ method, url }) => `${method} ${url}`), [
      'PUT /api/v1/m/target-group/packs?filename=demo-pack.crbl',
      'POST /api/v1/m/target-group/packs',
    ]);
    assert.deepEqual(JSON.parse(calls[1].body ?? '{}'), {
      id: 'demo-pack',
      source: 'demo-pack.crbl',
      force: true,
      allowCustomFunctions: true,
    });
    assert.equal(result.pack.version, '1.2.9');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('copyPackLookupFile copies the raw source file and keeps the target lookup metadata', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; url: string; body?: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? String(init.body) : undefined });

    if (url.endsWith('/content?raw=true')) {
      return new Response('host,owner\na,b\n', { status: 200 });
    }

    if (method === 'GET') {
      return new Response(JSON.stringify({ items: [{ id: 'hosts.csv', description: 'Target copy', mode: 'memory', size: 5 }] }), { status: 200 });
    }

    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  }) as typeof fetch;

  try {
    await api.copyPackLookupFile('demo-pack', 'hosts.csv', 'source-group', 'target-group');

    assert.deepEqual(calls.map(({ method, url }) => `${method} ${url}`), [
      'GET /api/v1/m/source-group/p/demo-pack/system/lookups/hosts.csv/content?raw=true',
      'GET /api/v1/m/target-group/p/demo-pack/system/lookups/hosts.csv',
      'PATCH /api/v1/m/target-group/p/demo-pack/system/lookups/hosts.csv',
    ]);
    assert.deepEqual(JSON.parse(calls[2].body ?? '{}'), {
      id: 'hosts.csv',
      content: 'host,owner\na,b\n',
      description: 'Target copy',
      mode: 'memory',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('copyPackPipelineBetweenGroups and copyPackRoutesBetweenGroups write the source definitions to the target', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; url: string; body?: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? String(init.body) : undefined });

    if (method === 'GET' && url.endsWith('/pipelines/main')) {
      return new Response(JSON.stringify({ items: [{ id: 'main', conf: { functions: [] }, __srcGroup: 'source-group' }] }), { status: 200 });
    }

    if (method === 'GET' && url.endsWith('/routes')) {
      return new Response(
        JSON.stringify({ items: [{ id: 'default', routes: [{ id: 'r1', name: 'Minimal', pipeline: 'main', __internal: 1 }] }] }),
        { status: 200 },
      );
    }

    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  }) as typeof fetch;

  try {
    await api.copyPackPipelineBetweenGroups('demo-pack', 'main', 'source-group', 'target-group', false);
    await api.copyPackRoutesBetweenGroups('demo-pack', 'source-group', 'target-group');

    assert.deepEqual(calls.map(({ method, url }) => `${method} ${url}`), [
      'GET /api/v1/m/source-group/p/demo-pack/pipelines/main',
      'POST /api/v1/m/target-group/p/demo-pack/pipelines',
      'GET /api/v1/m/source-group/p/demo-pack/routes',
      'PATCH /api/v1/m/target-group/p/demo-pack/routes/default',
    ]);
    assert.deepEqual(JSON.parse(calls[1].body ?? '{}'), { id: 'main', conf: { functions: [] } });
    assert.deepEqual(JSON.parse(calls[3].body ?? '{}'), {
      id: 'default',
      routes: [{ id: 'r1', name: 'Minimal', pipeline: 'main' }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('copyPackIoObjectBetweenGroups copies sources and destinations to the target', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; url: string; body?: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? String(init.body) : undefined });

    if (method === 'GET' && url.endsWith('/system/inputs/in_syslog')) {
      return new Response(JSON.stringify({ items: [{ id: 'in_syslog', type: 'syslog', port: 514, __srcGroup: 'source-group' }] }), { status: 200 });
    }

    if (method === 'GET' && url.endsWith('/system/outputs/out_s3')) {
      return new Response(JSON.stringify({ items: [{ id: 'out_s3', type: 's3', bucket: 'logs' }] }), { status: 200 });
    }

    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  }) as typeof fetch;

  try {
    await api.copyPackIoObjectBetweenGroups('demo-pack', 'source', 'in_syslog', 'source-group', 'target-group', false);
    await api.copyPackIoObjectBetweenGroups('demo-pack', 'destination', 'out_s3', 'source-group', 'target-group', true);

    assert.deepEqual(calls.map(({ method, url }) => `${method} ${url}`), [
      'GET /api/v1/m/source-group/p/demo-pack/system/inputs/in_syslog',
      'POST /api/v1/m/target-group/p/demo-pack/system/inputs',
      'GET /api/v1/m/source-group/p/demo-pack/system/outputs/out_s3',
      'PATCH /api/v1/m/target-group/p/demo-pack/system/outputs/out_s3',
    ]);
    assert.deepEqual(JSON.parse(calls[1].body ?? '{}'), { id: 'in_syslog', type: 'syslog', port: 514 });
    assert.deepEqual(JSON.parse(calls[3].body ?? '{}'), { id: 'out_s3', type: 's3', bucket: 'logs' });
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

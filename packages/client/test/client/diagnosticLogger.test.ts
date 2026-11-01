import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, expect, it } from 'vitest';

import { ensureBuilt } from '../helpers/ensureBuilt';

const pkgDir = fileURLToPath(new URL('../..', import.meta.url));

beforeAll(async () => {
    await ensureBuilt(fileURLToPath(new URL('../../../core', import.meta.url)));
    await ensureBuilt(pkgDir);
}, 240_000);

it('routes client and OAuth diagnostics to the instance sink without changing their contents', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mcp-diagnostics-'));
    const file = join(directory, 'diagnostics.log');
    const script = `
        import { appendFileSync } from 'node:fs';
        import { createServer } from 'node:http';
        import { auth, Client, StreamableHTTPClientTransport } from './dist/index.mjs';
        let origin;
        const server = createServer(async (request, response) => {
            const path = new URL(request.url, origin).pathname;
            if (path === '/token') {
                response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid_grant', error_description: 'revoked refresh token' }));
                return;
            }
            if (request.method !== 'POST') { response.writeHead(405).end(); return; }
            let body = ''; for await (const chunk of request) body += chunk;
            const frame = JSON.parse(body);
            const result = frame.method === 'server/discover'
                ? { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } }
                : { resultType: 'complete', ttlMs: 0, cacheScope: 'private', tools: [{ name: 'bad_header', inputSchema: { type: 'object', properties: { value: { type: 'string', 'x-mcp-header': '' } } } }] };
            response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }));
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        origin = 'http://127.0.0.1:' + server.address().port;
        const logger = process.argv[1] === 'custom'
            ? { debug: message => appendFileSync(${JSON.stringify(file)}, message + '\\n'), warn: message => appendFileSync(${JSON.stringify(file)}, message + '\\n') }
            : undefined;
        const client = new Client({ name: 'diagnostics', version: '1.0.0' }, { logger, versionNegotiation: { mode: { pin: '2026-07-28' } } });
        try {
            await client.connect(new StreamableHTTPClientTransport(new URL(origin + '/mcp')));
            await client.listTools();
            let tokens = { access_token: 'expired', refresh_token: 'revoked', token_type: 'Bearer', issuer: origin };
            await auth({
                logger,
                redirectUrl: 'http://localhost:19876/callback',
                clientMetadata: { redirect_uris: ['http://localhost:19876/callback'] },
                clientInformation: () => ({ client_id: 'test-client', issuer: origin }),
                tokens: () => tokens,
                saveTokens: value => { tokens = value; },
                invalidateCredentials: () => { tokens = undefined; },
                discoveryState: () => ({ authorizationServerUrl: origin, resourceMetadata: { resource: origin + '/mcp', authorization_servers: [origin] }, authorizationServerMetadata: { issuer: origin, authorization_endpoint: origin + '/authorize', token_endpoint: origin + '/token', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] } }),
                saveDiscoveryState: () => {},
                saveCodeVerifier: () => {},
                codeVerifier: () => 'verifier',
                redirectToAuthorization: () => {},
            }, { serverUrl: origin + '/mcp' });
        } finally {
            await client.close();
            await new Promise(resolve => server.close(resolve));
        }
    `;
    const run = (mode: string) =>
        spawnSync(process.execPath, ['--input-type=module', '-e', script, mode], {
            cwd: pkgDir,
            encoding: 'utf8',
            timeout: 5_000
        });
    try {
        const baseline = run('default');
        expect({ status: baseline.status, signal: baseline.signal, error: baseline.error }).toEqual({
            status: 0,
            signal: null,
            error: undefined
        });
        const routed = run('custom');
        expect({ status: routed.status, signal: routed.signal, error: routed.error, stdout: routed.stdout, stderr: routed.stderr }).toEqual(
            { status: 0, signal: null, error: undefined, stdout: '', stderr: '' }
        );
        expect(readFileSync(file, 'utf8').trim().split('\n').sort()).toEqual((baseline.stdout + baseline.stderr).trim().split('\n').sort());
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

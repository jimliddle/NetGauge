const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const html = readFileSync(`${__dirname}/../index.html`, 'utf8');
const source = html.slice(html.indexOf('class NDT7Tester'), html.indexOf('// --- 4. UI Controller'));

function setup() {
    let now = 0;
    let nextTimer = 0;
    const timers = new Map();
    const sockets = [];
    const progress = [];
    const warnings = [];
    class WebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        constructor() { this.readyState = 0; sockets.push(this); }
        close() { this.readyState = 3; this.closed = true; }
        open() { this.readyState = 1; this.onopen(); }
        message(data, time) { now = time; this.onmessage({ data }); }
    }
    const context = vm.createContext({
        WebSocket, performance: { now: () => now },
        setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
        clearTimeout: (id) => timers.delete(id),
        console: { warn: (...args) => warnings.push(args), error: () => {} }
    });
    const Tester = vm.runInContext(`${source}\nNDT7Tester`, context);
    const tester = new Tester({ onProgress: value => progress.push(value) });
    return { tester, sockets, progress, warnings, timers,
        tick(time) { now = time; },
        fireTimer(delay, time) {
            now = time;
            const entry = [...timers.values()].find(t => t.delay === delay);
            assert.ok(entry, `Expected a ${delay}ms timer`);
            entry.callback();
        }
    };
}

for (const ending of ['clean close', 'abnormal close', 'error', 'timeout']) {
    test(`preserves measured speed after ${ending} and cleans up`, async () => {
        const h = setup();
        const result = h.tester.runDownload('wss://test/download');
        const socket = h.sockets[0];
        assert.equal(socket.binaryType, 'arraybuffer');
        socket.open();
        socket.message(new ArrayBuffer(1000000), 1000);
        socket.message({ size: 1000000 }, 2000); // Blob fallback
        const lateClose = socket.onclose;
        const lateError = socket.onerror;
        h.tick(5000); // teardown delay must not reduce throughput
        if (ending === 'error') socket.onerror({});
        else if (ending === 'timeout') h.fireTimer(13000, 13000);
        else socket.onclose({ code: ending === 'clean close' ? 1000 : 1006 });
        assert.equal(await result, '8.00');
        assert.equal(h.progress.at(-1), '8.00');
        assert.equal(h.timers.size, 0);
        assert.equal(socket.onmessage, null);
        lateClose({ code: 1006 });
        lateError({});
        assert.equal(h.warnings.length, ending === 'clean close' ? 0 : 1);
    });
}

for (const ending of ['close', 'error', 'connect timeout', 'test timeout']) {
    test(`rejects ${ending} without binary data`, async () => {
        const h = setup();
        const result = h.tester.runDownload('wss://test/download');
        const rejected = assert.rejects(result, error => Boolean(error.message && !error.message.includes('Test Failed')));
        const socket = h.sockets[0];
        if (ending !== 'connect timeout') {
            socket.open();
            socket.message('{"TCPInfo":{"MinRTT":12000}}', 1000);
        }
        if (ending === 'close') socket.onclose({ code: 1000 });
        else if (ending === 'error') socket.onerror({});
        else h.fireTimer(ending === 'connect timeout' ? 10000 : 13000, 13000);
        await rejected;
        assert.equal(h.timers.size, 0);
        assert.equal(socket.onmessage, null);
    });
}

test('ignores malformed metadata and tracks minimum RTT, resetting between runs', async () => {
    const h = setup();
    const result = h.tester.runDownload('wss://test/download');
    const socket = h.sockets[0];
    socket.open();
    socket.message('not json', 100);
    socket.message('{"TCPInfo":{"MinRTT":"bad"}}', 200);
    socket.message('{"TCPInfo":{"MinRTT":20000}}', 300);
    socket.message('{"TCPInfo":{"MinRTT":12000}}', 400);
    socket.message(new ArrayBuffer(1000000), 1000);
    socket.onclose({ code: 1000 });
    await result;
    assert.equal(h.tester.minRTT, 12);
    const next = h.tester.runDownload('wss://test/download');
    assert.equal(h.tester.minRTT, null);
    const rejected = assert.rejects(next);
    h.sockets[1].onerror({});
    await rejected;
});

test('interrupted download continues through upload and returns a complete history result', async () => {
    const h = setup();
    const statuses = [];
    let download;
    h.tester.ui = {
        onStatusChange: value => statuses.push(value), onProgress() {},
        onDownloadResult: value => { download = value; }, onUploadResult() {}, onPingResult() {}
    };
    h.tester.locateServer = async () => ({ 'wss:///ndt/v7/download': 'wss://test/download', 'wss:///ndt/v7/upload': 'wss://test/upload' });
    h.tester.runUpload = async url => { assert.equal(url, 'wss://test/upload'); return '4.00'; };
    h.tester.measurePing = async () => 25;
    const run = h.tester.run();
    await new Promise(setImmediate);
    const socket = h.sockets[0];
    socket.open();
    socket.message(new ArrayBuffer(1000000), 1000);
    socket.onerror({});
    // Allow the runDownload and run promise continuations to schedule the pause.
    await new Promise(setImmediate);
    h.fireTimer(500, 1500);
    const result = await run;
    assert.equal(download, '8.00');
    assert.equal(result.download, '8.00');
    assert.equal(result.upload, '4.00');
    assert.equal(result.ping, 25);
    assert.equal(statuses.at(-1), 'Test Complete');
});

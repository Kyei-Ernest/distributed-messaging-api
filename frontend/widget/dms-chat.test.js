'use strict';

/**
 * Node unit tests for the pure, DOM-free helpers in dms-chat.js.
 *
 * Run with:  node dms-chat.test.js
 */
const assert = require('assert');
const dms = require('./dms-chat.js');

let passed = 0;
function t(name, fn) {
    try {
        fn();
        passed += 1;
        console.log('ok - ' + name);
    } catch (e) {
        console.error('FAIL - ' + name + '\n  ' + e.message);
        process.exitCode = 1;
    }
}

// --- normalizeConfig -------------------------------------------------------
t('normalizeConfig: requires a container', () => {
    assert.throws(() => dms.normalizeConfig({ token: 'x', chatType: 'group', chatId: '1', userId: 'u' }),
        /container/);
});

t('normalizeConfig: requires token or tokenProvider', () => {
    assert.throws(() => dms.normalizeConfig({ container: '#w', chatType: 'group', chatId: '1', userId: 'u' }),
        /token/);
});

t('normalizeConfig: requires valid chatType', () => {
    assert.throws(() => dms.normalizeConfig({ container: '#w', token: 'x', chatType: 'bogus', chatId: '1', userId: 'u' }),
        /chatType/);
});

t('normalizeConfig: applies apiBase default and keeps provided values', () => {
    const cfg = dms.normalizeConfig({
        container: '#w', token: 'jwt', chatType: 'private', chatId: 'peer', userId: 'me', pageSize: 10,
    });
    assert.strictEqual(cfg.apiBase, '/api');
    assert.strictEqual(cfg.pageSize, 10);
    assert.strictEqual(cfg.chatId, 'peer');
});

t('normalizeConfig: accepts a tokenProvider function', () => {
    const cfg = dms.normalizeConfig({
        container: '#w', tokenProvider: async () => 'fresh', chatType: 'group', chatId: 'g', userId: 'me',
    });
    assert.strictEqual(typeof cfg.tokenProvider, 'function');
});

// --- authHeaders -----------------------------------------------------------
t('authHeaders: sets Bearer Authorization and Content-Type', () => {
    const h = dms.authHeaders('abc');
    assert.strictEqual(h.Authorization, 'Bearer abc');
    assert.strictEqual(h['Content-Type'], 'application/json');
});

// --- buildWsSubprotocols ---------------------------------------------------
t('buildWsSubprotocols: token rides in a token. subprotocol (never the URL)', () => {
    const sp = dms.buildWsSubprotocols('tok');
    assert.deepStrictEqual(sp, ['chat', 'token.tok']);
});

// --- parseIncomingFrames ---------------------------------------------------
t('parseIncomingFrames: parses a single JSON frame', () => {
    const out = dms.parseIncomingFrames('{"type":"hello","data":{}}');
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].type, 'hello');
});

t('parseIncomingFrames: parses newline-delimited frames', () => {
    const out = dms.parseIncomingFrames('{"type":"a"}\n{"type":"b"}\n');
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].type, 'a');
    assert.strictEqual(out[1].type, 'b');
});

t('parseIncomingFrames: returns [] for empty input and skips junk lines', () => {
    assert.deepStrictEqual(dms.parseIncomingFrames('   '), []);
    const out = dms.parseIncomingFrames('not-json\n{"type":"c"}');
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].type, 'c');
});

// --- buildMessageQuery -----------------------------------------------------
t('buildMessageQuery: group conversations query by group', () => {
    const q = dms.buildMessageQuery('group', 'g1', 25);
    assert.strictEqual(q.group, 'g1');
    assert.strictEqual(q.page_size, '25');
    assert.strictEqual(q.message_type, undefined);
});

t('buildMessageQuery: private conversations query by recipient', () => {
    const q = dms.buildMessageQuery('private', 'p1', 25);
    assert.strictEqual(q.recipient, 'p1');
    assert.strictEqual(q.message_type, 'private');
});

// --- eventMatchesConversation ----------------------------------------------
t('eventMatchesConversation: group event matches the subscribed group', () => {
    assert.strictEqual(
        dms.eventMatchesConversation('group', 'g1', 'me', { data: { group_id: 'g1' } }),
        true);
    assert.strictEqual(
        dms.eventMatchesConversation('group', 'g1', 'me', { data: { group_id: 'other' } }),
        false);
});

t('eventMatchesConversation: private event matches the peer conversation', () => {
    const match = { data: { sender_id: 'peer', recipient_id: 'me', content: 'hi' } };
    assert.strictEqual(dms.eventMatchesConversation('private', 'peer', 'me', match), true);
    const nonMatch = { data: { sender_id: 'someoneElse', recipient_id: 'me', content: 'hi' } };
    assert.strictEqual(dms.eventMatchesConversation('private', 'peer', 'me', nonMatch), false);
});

// --- escapeHtml ------------------------------------------------------------
t('escapeHtml: escapes HTML metacharacters', () => {
    assert.strictEqual(dms.escapeHtml('<script>alert("x&\'y")</script>'),
        '&lt;script&gt;alert(&quot;x&amp;&#39;y&quot;)&lt;/script&gt;');
});

// --- init is browser-only --------------------------------------------------
t('init(): rejects outside a browser', async () => {
    let rejected = false;
    try {
        await dms.init({});
    } catch (e) {
        rejected = true;
    }
    assert.strictEqual(rejected, true);
});

console.log('\n' + passed + ' tests passed.');
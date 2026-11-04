'use strict';

const assert = require('assert');
const {
  parseYouTubeInput,
  buildEmbedUrl,
  sanitizeEmbedSrc,
} = require('../lib/youtube-url');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('smoke-parse: YouTube URL helpers\n');

check('bare video id', () => {
  const r = parseYouTubeInput('dQw4w9WgXcQ');
  assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
  assert.strictEqual(r.listId, undefined);
});

check('watch URL', () => {
  const r = parseYouTubeInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
});

check('watch URL without scheme', () => {
  const r = parseYouTubeInput('youtube.com/watch?v=dQw4w9WgXcQ');
  assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
});

check('youtu.be short link', () => {
  const r = parseYouTubeInput('https://youtu.be/dQw4w9WgXcQ');
  assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
});

check('youtu.be with query', () => {
  const r = parseYouTubeInput('https://youtu.be/dQw4w9WgXcQ?t=42');
  assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
});

check('Shorts URL', () => {
  const r = parseYouTubeInput('https://www.youtube.com/shorts/dQw4w9WgXcQ');
  assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
});

check('embed URL', () => {
  const r = parseYouTubeInput('https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
});

check('watch + playlist', () => {
  const r = parseYouTubeInput(
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLtestPlaylist123'
  );
  assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
  assert.strictEqual(r.listId, 'PLtestPlaylist123');
});

check('playlist-only URL', () => {
  const r = parseYouTubeInput(
    'https://www.youtube.com/playlist?list=PLtestPlaylist123'
  );
  assert.ok(r);
  assert.strictEqual(r.listId, 'PLtestPlaylist123');
});

check('music.youtube.com', () => {
  const r = parseYouTubeInput('https://music.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.strictEqual(r.videoId, 'dQw4w9WgXcQ');
});

check('empty → null', () => {
  assert.strictEqual(parseYouTubeInput(''), null);
  assert.strictEqual(parseYouTubeInput('   '), null);
  assert.strictEqual(parseYouTubeInput(null), null);
});

check('invalid host → null', () => {
  assert.strictEqual(parseYouTubeInput('https://example.com/watch?v=dQw4w9WgXcQ'), null);
});

check('invalid id length → null', () => {
  assert.strictEqual(parseYouTubeInput('https://youtu.be/short'), null);
  assert.strictEqual(parseYouTubeInput('not-valid'), null);
  assert.strictEqual(parseYouTubeInput('toolongvideoid1'), null);
});

check('garbage → null', () => {
  assert.strictEqual(parseYouTubeInput(':::'), null);
  assert.strictEqual(parseYouTubeInput('javascript:alert(1)'), null);
});

check('buildEmbedUrl video', () => {
  const url = buildEmbedUrl({ videoId: 'dQw4w9WgXcQ' });
  assert.ok(url.includes('youtube.com/embed/dQw4w9WgXcQ'));
  assert.ok(url.includes('modestbranding=1'));
  assert.ok(url.includes('rel=0'));
  assert.ok(url.includes('playsinline=1'));
  assert.ok(url.includes('enablejsapi=1'));
});

check('buildEmbedUrl with list', () => {
  const url = buildEmbedUrl({ videoId: 'dQw4w9WgXcQ', listId: 'PLabc' });
  assert.ok(url.includes('list=PLabc'));
});

check('sanitizeEmbedSrc allows youtube embed', () => {
  const src = buildEmbedUrl({ videoId: 'dQw4w9WgXcQ' });
  const clean = sanitizeEmbedSrc(src);
  assert.ok(clean);
  assert.ok(clean.startsWith('https://www.youtube.com/embed/'));
});

check('sanitizeEmbedSrc rejects evil host', () => {
  assert.strictEqual(
    sanitizeEmbedSrc('https://evil.com/embed/dQw4w9WgXcQ'),
    null
  );
});

check('sanitizeEmbedSrc rejects non-embed path', () => {
  assert.strictEqual(
    sanitizeEmbedSrc('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    null
  );
});

console.log(`\n${passed} checks passed`);
if (process.exitCode) {
  console.error('SMOKE FAILED');
  process.exit(1);
}
console.log('SMOKE OK');

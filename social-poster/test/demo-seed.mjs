// Fills a throwaway Social Poster data folder with example channels, media and
// posts, so the page can be looked at and screenshotted. The example channels
// are not real accounts and can't post.
// Usage: start `social-poster-engine` with SOCIAL_POSTER_HOME=<folder>, then
//        node test/demo-seed.mjs <folder>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(new URL('../engine/', import.meta.url));
const { DatabaseSync } = require('node:sqlite');
const sharp = require('sharp');
const home = process.argv[2];
const api = JSON.parse(readFileSync(join(home, 'api.json'), 'utf8'));
const rpc = async (method, params) => {
  const r = await fetch(`${api.url}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${api.token}` }, body: JSON.stringify({ method, params }) }).then((x) => x.json());
  if (r.error) throw new Error(`${method}: ${r.error}`);
  return r.result;
};

const db = new DatabaseSync(join(home, 'social-poster.db'));
const t = Date.now();
const fake = [
  ['acc-ig', 'instagram', 'Intelliminds', 'intelliminds'],
  ['acc-li', 'linkedin-page', 'Intelliminds', 'intelliminds'],
  ['acc-x', 'x', 'Intelliminds AI', 'intellimindsai'],
  ['acc-fb', 'facebook', 'Intelliminds AI', null],
  ['acc-tt', 'tiktok', 'intellimindsai', 'intellimindsai'],
  ['acc-yt', 'youtube', 'Intelliminds AI', null],
];
const logo = await sharp({ create: { width: 96, height: 96, channels: 3, background: '#4b2bd6' } })
  .composite([{ input: Buffer.from('<svg width="96" height="96"><text x="48" y="64" font-size="52" text-anchor="middle" fill="white" font-family="sans-serif" font-weight="bold">i</text></svg>') }]).jpeg().toBuffer();
for (const [id, provider, name, username] of fake) {
  db.prepare(`INSERT OR REPLACE INTO accounts (id, provider, internal_id, root_internal_id, name, username, picture, token, additional_settings, status, created_at, updated_at, avatar)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, provider, id, id, name, username, null, 'demo', '[]', 'ready', t, t, `data:image/jpeg;base64,${logo.toString('base64')}`);
}

const slide = async (i, bg, title) => {
  const svg = `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${bg}"/>
    <text x="80" y="200" font-size="54" fill="white" font-family="sans-serif" font-weight="bold">${title}</text>
    <text x="80" y="1000" font-size="40" fill="white" opacity="0.7" font-family="sans-serif">${i} / 5</text></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return rpc('media.upload', { name: `slide-${i}.png`, base64: png.toString('base64') });
};
const slides = [];
const titles = ['How ASM Tuning grew 1950%', 'Step 1: fix the homepage', 'Step 2: answer real questions', 'Step 3: get listed locally', 'Your first month is 47% off'];
for (let i = 0; i < 5; i++) slides.push(await slide(i + 1, ['#4b2bd6', '#16151f', '#0a66c2', '#d62976', '#1f9d55'][i], titles[i]));
const pdfPath = join(home, 'deck.pdf');
execFileSync('magick', ['-size', '1080x1350', 'xc:#4b2bd6', 'xc:#16151f', 'xc:#0a66c2', 'xc:#1f9d55', pdfPath]);
const pdf = await rpc('media.add', { src: pdfPath });

const day = (n, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d.toISOString(); };
const ids = slides.map((s) => ({ id: s.id }));
await rpc('posts.save', { accounts: ['acc-ig', 'acc-fb'], text: 'This small online car parts store grew its traffic from Google by 1950% in about a year.\n\nSwipe to see the exact plan they followed, in 3 simple steps you can copy.', media: ids, mode: 'schedule', at: day(1, 9) });
await rpc('posts.save', { accounts: ['acc-li'], text: 'Most homepages lose customers in the first 5 seconds. These 5 simple lines can fix that.', media: [{ id: pdf.id }], mode: 'schedule', at: day(2, 12, 30), settings: { 'acc-li': { carousel_name: '5 lines that make a homepage sell' } } });
await rpc('posts.save', { accounts: ['acc-x'], text: 'Using AI to write your website is not what gets you in trouble with Google. Something else does. 🧵', comments: ['1/ Google judges whether a page helps people, not whether AI wrote it.', '2/ Thin pages with no real answers are what get filtered.'], mode: 'schedule', at: day(2, 16) });
await rpc('posts.save', { accounts: ['acc-tt', 'acc-ig'], text: '30 opening lines you can use this week', media: ids.slice(0, 3), mode: 'schedule', at: day(4, 18) });
await rpc('posts.save', { accounts: [], text: 'Carousel 12 · AI Help vs AI Spam', media: ids.slice(1, 2), mode: 'draft', at: day(5, 10), source: { type: 'notion', page: '41f09656173581c69347efa41292ff69', url: 'https://www.notion.so/41f09656173581c69347efa41292ff69', title: 'Carousel 12 · AI Help vs AI Spam' } });
await rpc('posts.save', { accounts: ['acc-li', 'acc-x'], text: 'Weekly tip: write the headline last.', mode: 'draft', at: day(6, 9) });
// Past posts: one published, one that failed.
const past = await rpc('posts.save', { accounts: ['acc-ig', 'acc-li'], text: 'Fill in these 3 blanks and your homepage starts selling.', media: ids.slice(0, 1), mode: 'draft', at: day(1, 8) });
db.prepare("UPDATE posts SET status='published', publish_at=?, release_url='https://www.instagram.com/p/example' WHERE group_id=? AND account_id='acc-ig'").run(Date.parse(day(-2, 9)), past.group);
db.prepare("UPDATE posts SET status='failed', publish_at=?, error='LinkedIn refused the picture: it is larger than 10 MB.' WHERE group_id=? AND account_id='acc-li'").run(Date.parse(day(-2, 9)), past.group);
db.prepare('UPDATE post_groups SET publish_at=? WHERE id=?').run(Date.parse(day(-2, 9)), past.group);
console.log('demo data ready');

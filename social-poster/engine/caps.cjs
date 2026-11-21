// What each network accepts, in the terms the composer needs. Taken from the
// Postiz connectors (each provider's checkValidity, settings DTO and media
// handling). `media` says how a connector reads files:
//   'file'   reads the local file directly (readOrFetch / streams)
//   'http'   downloads it itself over http(s); the engine serves it locally
//   'public' the platform downloads it, so it needs a public https address
'use strict';

const yes = (label, key, def = false, help) => ({ key, label, type: 'toggle', default: def, help });
const pick = (label, key, options, def, help) => ({ key, label, type: 'select', options, default: def, required: true, help });
const text = (label, key, { required = false, help, max } = {}) => ({ key, label, type: 'text', required, help, max });
const lookup = (label, key, method, { required = true, help, multiple = false, wrap } = {}) => ({ key, label, type: 'lookup', method, required, help, multiple, wrap });
const opts = (...pairs) => pairs.map(([value, label]) => ({ value, label }));

const PRIVACY = opts(['PUBLIC_TO_EVERYONE', 'Everyone'], ['MUTUAL_FOLLOW_FRIENDS', 'Friends'], ['FOLLOWER_OF_CREATOR', 'Followers'], ['SELF_ONLY', 'Only me']);
const TIKTOK = [
  pick('Who can see it', 'privacy_level', PRIVACY, 'PUBLIC_TO_EVERYONE'),
  pick('How to send it', 'content_posting_method', opts(['DIRECT_POST', 'Post it'], ['UPLOAD', 'Send to my TikTok drafts']), 'DIRECT_POST'),
  text('Title (photo posts only)', 'title', { max: 90 }),
  yes('Allow comments', 'comment', true),
  yes('Allow duets', 'duet', false),
  yes('Allow stitches', 'stitch', false),
  pick('Add music automatically', 'autoAddMusic', opts(['no', 'No'], ['yes', 'Yes']), 'no'),
  yes('This promotes my own business', 'brand_organic_toggle', false),
  yes('This is a paid partnership', 'brand_content_toggle', false),
];

const CAPS = {
  x: { maxMedia: 4, video: 'alone', pdf: 'pages', media: 'file', comments: true, label: 'Thread',
    settings: [pick('Who can reply', 'who_can_reply_post', opts(['everyone', 'Everyone'], ['following', 'People you follow'], ['mentionedUsers', 'People you mention'], ['subscribers', 'Subscribers'], ['verified', 'Verified accounts']), 'everyone')] },
  linkedin: { maxMedia: 20, video: 'alone', pdf: 'document', media: 'file', comments: true, commentsTextOnly: true,
    settings: [yes('Post several pictures as a swipeable document (carousel)', 'post_as_images_carousel', false, 'LinkedIn shows the pictures as pages people swipe through. A PDF is always posted this way.'), text('Carousel title', 'carousel_name', { help: 'Shown above the document. Default: slides' })] },
  'linkedin-page': null, // same as linkedin, filled below
  reddit: { maxMedia: 1, video: 'alone', pdf: 'pages', media: 'file', comments: true,
    settings: [lookup('Subreddit', 'subreddit', 'subreddits', { wrap: 'reddit', help: 'Type to search; the post title is asked below.' }), text('Post title', 'reddit_title', { required: true })] },
  instagram: { maxMedia: 20, minMedia: 1, video: 'mixed', pdf: 'pages', media: 'public', comments: true, commentsTextOnly: true,
    settings: [pick('Post as', 'post_type', opts(['post', 'Feed post (2+ pictures make a carousel)'], ['story', 'Story']), 'post')] },
  'instagram-standalone': null,
  facebook: { maxMedia: 20, video: 'first-only', pdf: 'pages', media: 'public', comments: true,
    settings: [pick('Post as', 'post_type', opts(['post', 'Page post'], ['story', 'Story']), 'post'), text('Link to show as a preview (posts without pictures)', 'url')] },
  threads: { maxMedia: 20, video: 'mixed', pdf: 'pages', media: 'public', comments: true, settings: [] },
  youtube: { maxMedia: 1, minMedia: 1, needsVideo: true, video: 'alone', pdf: 'none', media: 'file', comments: false,
    settings: [text('Video title', 'title', { required: true, max: 100 }), pick('Who can watch', 'type', opts(['public', 'Everyone'], ['unlisted', 'People with the link'], ['private', 'Only me']), 'public'), pick('Made for kids', 'selfDeclaredMadeForKids', opts(['no', 'No'], ['yes', 'Yes']), 'no')] },
  gmb: { maxMedia: 1, video: 'none', pdf: 'pages', media: 'public', comments: false,
    settings: [pick('Post type', 'topicType', opts(['STANDARD', 'Update'], ['EVENT', 'Event'], ['OFFER', 'Offer']), 'STANDARD'), pick('Button', 'callToActionType', opts(['NONE', 'No button'], ['LEARN_MORE', 'Learn more'], ['BOOK', 'Book'], ['ORDER', 'Order'], ['SHOP', 'Shop'], ['SIGN_UP', 'Sign up'], ['CALL', 'Call']), 'NONE'), text('Button link', 'callToActionUrl'), text('Event title', 'eventTitle')] },
  tiktok: { maxMedia: 35, minMedia: 1, video: 'alone', pdf: 'pages', media: 'public-photos', comments: false, settings: TIKTOK },
  'tiktok-business': { maxMedia: 35, minMedia: 1, video: 'alone', pdf: 'pages', media: 'public', comments: false, settings: TIKTOK },
  pinterest: { maxMedia: 5, minMedia: 1, video: 'with-cover', pdf: 'pages', media: 'public', comments: false, sameSize: true,
    settings: [lookup('Board', 'board', 'boards'), text('Pin title', 'title', { max: 100 }), text('Link people go to', 'link')] },
  dribbble: { maxMedia: 1, minMedia: 1, video: 'none', pdf: 'none', media: 'http', comments: false, settings: [text('Shot title', 'title', { required: true })] },
  discord: { maxMedia: 10, video: 'mixed', pdf: 'none', media: 'file', comments: true, settings: [lookup('Channel', 'channel', 'channels')] },
  slack: { maxMedia: 10, video: 'none', pdf: 'pages', media: 'public', comments: true, settings: [lookup('Channel', 'channel', 'channels')] },
  kick: { maxMedia: 0, video: 'none', pdf: 'none', media: 'file', comments: true, settings: [] },
  twitch: { maxMedia: 0, video: 'none', pdf: 'none', media: 'file', comments: true,
    settings: [pick('Message type', 'messageType', opts(['message', 'Chat message'], ['announcement', 'Announcement']), 'message')] },
  mastodon: { maxMedia: 4, video: 'mixed', pdf: 'pages', media: 'http', comments: true, settings: [] },
  bluesky: { maxMedia: 4, video: 'alone', pdf: 'pages', media: 'http', comments: true, settings: [] },
  lemmy: { maxMedia: 1, video: 'none', pdf: 'none', media: 'public', comments: true, settings: [lookup('Community', 'subreddit', 'subreddits', { wrap: 'lemmy' })] },
  wrapcast: { maxMedia: 2, video: 'none', pdf: 'pages', media: 'public', comments: true, settings: [] },
  telegram: { maxMedia: 10, video: 'mixed', pdf: 'pages', media: 'file', comments: true, settings: [] },
  nostr: { maxMedia: 10, video: 'mixed', pdf: 'pages', media: 'public', comments: true, settings: [] },
  vk: { maxMedia: 10, video: 'mixed', pdf: 'pages', media: 'http', comments: true, settings: [] },
  medium: { maxMedia: 0, video: 'none', pdf: 'none', media: 'file', comments: false, settings: [text('Title', 'title', { required: true }), text('Subtitle', 'subtitle', { required: true })] },
  devto: { maxMedia: 0, video: 'none', pdf: 'none', media: 'file', comments: false, settings: [text('Title', 'title', { required: true })] },
  hashnode: { maxMedia: 0, video: 'none', pdf: 'none', media: 'file', comments: false,
    settings: [text('Title', 'title', { required: true }), lookup('Publication', 'publication', 'publications')] },
  wordpress: { maxMedia: 0, video: 'none', pdf: 'none', media: 'file', comments: false,
    settings: [text('Title', 'title', { required: true }), lookup('Post type', 'type', 'postTypes'), pick('Status', 'status', opts(['publish', 'Published'], ['draft', 'Draft'], ['pending', 'Pending review'], ['private', 'Private']), 'publish')] },
  listmonk: { maxMedia: 0, video: 'none', pdf: 'none', media: 'file', comments: false,
    settings: [text('Email subject', 'subject', { required: true }), text('Preview text', 'preview', { required: true }), lookup('List', 'list', 'list')] },
  moltbook: { maxMedia: 0, video: 'none', pdf: 'none', media: 'file', comments: true, settings: [text('Submolt', 'submolt')] },
  whop: { maxMedia: 10, video: 'mixed', pdf: 'none', media: 'http', comments: true, settings: [lookup('Company', 'company', 'companies'), lookup('Experience', 'experience', 'experiences'), text('Title', 'title')] },
  mewe: { maxMedia: 10, video: 'none', pdf: 'pages', media: 'http', comments: false, settings: [pick('Post to', 'postType', opts(['timeline', 'My timeline'], ['group', 'A group']), 'timeline'), lookup('Group', 'group', 'groups', { required: false })] },
  tumblr: { maxMedia: 30, video: 'mixed', pdf: 'pages', media: 'http', comments: false, settings: [text('Title', 'title'), text('Tags (comma separated)', 'tags')] },
};
CAPS['linkedin-page'] = CAPS.linkedin;
CAPS['instagram-standalone'] = CAPS.instagram;

const DEFAULT = { maxMedia: 4, video: 'mixed', pdf: 'pages', media: 'file', comments: false, settings: [] };
const capsOf = (identifier) => CAPS[identifier] || DEFAULT;

/** Settings with defaults filled in, plus Postiz-shaped values for lookups. */
function settingsFor(identifier, given = {}) {
  const out = { ...given };
  for (const f of capsOf(identifier).settings) {
    if (out[f.key] === undefined && f.default !== undefined) out[f.key] = f.default;
  }
  if (identifier === 'reddit' && given.subreddit && !Array.isArray(given.subreddit)) {
    out.subreddit = [{ value: { subreddit: String(given.subreddit), title: given.reddit_title || '', type: 'self', is_flair_required: false } }];
  }
  if (identifier === 'lemmy' && given.subreddit && !Array.isArray(given.subreddit)) {
    out.subreddit = [{ value: { subreddit: String(given.subreddit_label || given.subreddit), id: String(given.subreddit), title: given.title || '' } }];
  }
  return out;
}

/** Plain-English problems (errors block sending; warnings don't) for one network. */
function problems(identifier, { text: body, media, settings, maxLength, comments }) {
  const c = capsOf(identifier);
  const out = [];
  const warnings = [];
  const pics = media.filter((m) => m.kind === 'image');
  const vids = media.filter((m) => m.kind === 'video');
  const pdfs = media.filter((m) => m.kind === 'pdf');
  if (!String(body || '').trim() && !media.length) out.push('Write something or add a picture.');
  if (maxLength && String(body || '').length > maxLength) out.push(`Too long: ${String(body).length} of ${maxLength} characters.`);
  for (const f of c.settings) {
    const v = settings?.[f.key];
    if (f.required && (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length))) out.push(`Choose “${f.label}” in this network’s options.`);
  }
  if (c.maxMedia === 0 && media.length) warnings.push('This network only posts text, so the pictures are left out.');
  if (pdfs.length && c.pdf === 'none') out.push('This network can’t post a PDF.');
  if (pdfs.length > 1) out.push('Add one PDF at a time.');
  if (pdfs.length && (pics.length || vids.length) && c.pdf === 'document') out.push('A PDF has to be posted on its own, without other pictures or videos.');
  if (c.maxMedia === 0) return { errors: out, warnings };
  const count = pdfs.length && c.pdf === 'pages' ? pics.length + (pdfs[0].pages || 1) : media.length;
  if (c.maxMedia && count > c.maxMedia && !(pdfs.length && c.pdf === 'document')) out.push(`Too many pictures: this network takes up to ${c.maxMedia}.`);
  if (c.minMedia && !media.length) out.push(c.needsVideo ? 'Add a video.' : 'Add at least one picture or video.');
  if (c.needsVideo && (vids.length !== 1 || pics.length || pdfs.length)) out.push('Add exactly one video (MP4) and nothing else.');
  if (vids.length && c.video === 'none') out.push('This network can’t post videos.');
  if (vids.length && c.video === 'alone' && media.length > 1) out.push('A video has to be posted on its own.');
  if (vids.some((v) => !/\.mp4$/i.test(v.name))) out.push('Videos must be MP4 files.');
  if (comments?.length && !c.comments) warnings.push('This network has no follow-up comments, so they are left out.');
  return { errors: out, warnings };
}

module.exports = { CAPS, capsOf, settingsFor, problems };

import { expect, test } from 'bun:test';
import PostalMime from 'postal-mime';
import { gmailTools } from '../server';
import { harness } from '../../../test/parity-harness';

const profile = { emailAddress: 'me@gmail.com' };
const sendAs = { sendAs: [
  { sendAsEmail: 'me@gmail.com', isPrimary: true, displayName: 'Me Person', signature: '<div>Me<br>CEO</div>' },
  { sendAsEmail: 'Team@Example.com', displayName: 'Team Résumé', verificationStatus: 'accepted' },
  { sendAsEmail: 'pending@example.com', verificationStatus: 'pending' },
] };
const original = { id: 'msg-1', threadId: 'thread-9', payload: { mimeType: 'text/plain', headers: [
  { name: 'Message-ID', value: '<orig@example.com>' }, { name: 'From', value: 'Ann <ann@example.com>' },
  { name: 'Subject', value: 'Invoice' }, { name: 'Date', value: 'Mon, 12 Oct 2026 09:00:00 -0400' },
], body: { data: Buffer.from('What is the total?').toString('base64url') } } };

test('reviewed sending is hidden from Bots and verifies the account, aliases, signature and replied-to message', async () => {
  const h = harness(gmailTools, [profile, sendAs, { id: 'msg-1', threadId: 'thread-9', payload: { headers: [{ name: 'Subject', value: 'Invoice' }, { name: 'From', value: 'Ann <ann@example.com>' }] } }]);
  const tool = h.tools.find(t => t.name === 'send_reviewed_email')!;
  expect(tool._meta).toEqual({ 'openteam/hostOnly': true });
  const verified = await h.call('send_reviewed_email', { action: 'verify', draft: { from: 'team@example.com', to: ['ann@example.com'], subject: 'Re: Invoice', body: 'x', replyToMessageId: 'msg-1' } });
  expect(verified).toEqual({
    identity: 'me@gmail.com',
    sendingAddresses: ['me@gmail.com', 'team@example.com'],
    signatures: { 'me@gmail.com': '<div>Me<br>CEO</div>' },
    thread: '“Invoice” from Ann <ann@example.com>',
    threadUrl: 'https://mail.google.com/mail/u/me%40gmail.com/#all/thread-9',
  });
  expect(h.requests.map(r => r.url.pathname)).toEqual(['/profile', '/settings/sendAs', '/messages/msg-1']);
  expect(h.requests[2]!.url.searchParams.get('format')).toBe('metadata');
  const refused = harness(gmailTools, [profile, sendAs]);
  await expect(refused.call('send_reviewed_email', { action: 'verify', draft: { from: 'pending@example.com', to: ['a@example.com'], subject: 's', body: 'b' } })).rejects.toThrow("can't send as pending@example.com");
});

test('a reviewed reply goes out from the chosen address with its signature, threaded and quoted', async () => {
  const h = harness(gmailTools, [profile, sendAs, original, { id: 'sent-1', threadId: 'thread-9', labelIds: ['SENT'] }]);
  const result = await h.call('send_reviewed_email', { action: 'send', draft: {
    from: 'me@gmail.com', to: ['ann@example.com'], cc: ['bob@example.com'], subject: 'Re: Invoice', body: 'It is $1,250.',
    html: '<div dir="auto">It is $1,250.</div>', signatureHtml: '<div>Me<br>CEO</div>', replyToMessageId: 'msg-1',
  } });
  expect(result).toEqual({ id: 'sent-1', threadId: 'thread-9', labelIds: ['SENT'] });
  const send = h.requests.at(-1)!;
  expect(send.url.pathname).toBe('/messages/send');
  expect(send.json.threadId).toBe('thread-9');
  const parsed = await PostalMime.parse(Buffer.from(send.json.raw, 'base64url'));
  expect(parsed.from).toEqual({ name: 'Me Person', address: 'me@gmail.com' });
  expect(parsed.to?.map(a => a.address)).toEqual(['ann@example.com']);
  expect(parsed.cc?.map(a => a.address)).toEqual(['bob@example.com']);
  expect(parsed.subject).toBe('Re: Invoice');
  expect(parsed.inReplyTo).toBe('<orig@example.com>');
  expect(parsed.html).toContain('<div dir="auto">It is $1,250.</div><br><div dir="ltr" class="gmail_signature"><div>Me<br>CEO</div></div>');
  expect(parsed.html!.indexOf('gmail_signature')).toBeLessThan(parsed.html!.indexOf('<blockquote>'));
  expect(parsed.text).toContain('It is $1,250.\n\nMe\nCEO');
  expect(parsed.text).toContain('> What is the total?');
});

test('a new reviewed email from an alias carries its display name and no thread', async () => {
  const h = harness(gmailTools, [profile, sendAs, { id: 'sent-2', threadId: 'thread-new' }]);
  await h.call('send_reviewed_email', { action: 'send', draft: { from: 'team@example.com', to: ['ann@example.com'], subject: 'Hello', body: 'Line one\nLine <two>' } });
  const send = h.requests.at(-1)!;
  expect(send.json.threadId).toBeUndefined();
  const parsed = await PostalMime.parse(Buffer.from(send.json.raw, 'base64url'));
  expect(parsed.from).toEqual({ name: 'Team Résumé', address: 'Team@Example.com' });
  expect(parsed.html).toBe('<div dir="auto">Line one<br>Line &lt;two&gt;</div>');
  expect(parsed.text).toBe('Line one\nLine <two>');
});

test('the primary address without a display name lets Gmail fill in From', async () => {
  const h = harness(gmailTools, [profile, { sendAs: [{ sendAsEmail: 'me@gmail.com', isPrimary: true, displayName: '' }] }, { id: 'sent-3', threadId: 't' }]);
  await h.call('send_reviewed_email', { action: 'send', draft: { from: 'me@gmail.com', to: ['ann@example.com'], subject: 'Hi', body: 'Hello' } });
  const parsed = await PostalMime.parse(Buffer.from(h.requests.at(-1)!.json.raw, 'base64url'));
  expect(parsed.from).toBeUndefined();
});

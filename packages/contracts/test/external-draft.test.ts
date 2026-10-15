import { test, expect } from 'bun:test';
import { editExternalDraft, externalDraftAllowList, externalDraftApprovalMode, externalDraftHtml, parseExternalDraft } from '../src/external-draft';
test('draft HTML preserves prose while escaping active markup and URL delimiters', () => {
 expect(externalDraftHtml('Hello\r\n<script>alert(1)</script>\nSee https://example.com/a?q=1&b=2.')).toBe('<div dir="auto">Hello<br>&lt;script&gt;alert(1)&lt;/script&gt;<br>See <a href="https://example.com/a?q=1&amp;b=2">https://example.com/a?q=1&amp;b=2</a>.</div>');
 expect(externalDraftHtml('(https://example.com/a)')).toBe('<div dir="auto">(<a href="https://example.com/a">https://example.com/a</a>)</div>');
 expect(externalDraftHtml('**Literal prose** javascript:alert(1)')).toBe('<div dir="auto">**Literal prose** javascript:alert(1)</div>');
});

test('approval mode follows the Bot settings and the card recipients', () => {
 const draft = { platform: 'email' as const, to: ['Ann@Example.com'], cc: ['bob@example.com'] };
 expect(externalDraftApprovalMode({ draftingDisabled: false, draftAllowedRecipients: [] }, draft)).toBe('needs-approval');
 expect(externalDraftApprovalMode({ draftingDisabled: false, draftAllowedRecipients: ['ann@example.com'] }, draft)).toBe('needs-approval');
 expect(externalDraftApprovalMode({ draftingDisabled: false, draftAllowedRecipients: ['ann@example.com', 'BOB@example.com'] }, draft)).toBe('always-allow');
 expect(externalDraftApprovalMode({ draftingDisabled: true, draftAllowedRecipients: [] }, draft)).toBe('disable-drafts');
 expect(externalDraftApprovalMode({ draftingDisabled: false, draftAllowedRecipients: ['ann@example.com'] }, { platform: 'slack' })).toBe('needs-approval');
 expect(externalDraftAllowList(['carol@example.com'], draft, 'always-allow')).toEqual(['carol@example.com', 'ann@example.com', 'bob@example.com']);
 expect(externalDraftAllowList(['carol@example.com', 'ann@example.com', 'bob@example.com'], draft, 'needs-approval')).toEqual(['carol@example.com']);
 expect(externalDraftAllowList(['Carol@example.com'], draft, 'disable-drafts')).toEqual(['carol@example.com']);
});

test('From may change only among the verified addresses', () => {
 const saved = { platform: 'email' as const, providerIdentifier: 'p', from: 'me@example.com', to: ['ann@example.com'], subject: 'Hi', body: 'Hello' };
 expect(editExternalDraft(saved, { from: 'alias@example.com' }, ['me@example.com', 'alias@example.com']).from).toBe('alias@example.com');
 expect(() => editExternalDraft(saved, { from: 'someone@example.com' }, ['me@example.com'])).toThrow('verified addresses');
 expect(() => editExternalDraft(saved, { providerIdentifier: 'q' })).toThrow('cannot be changed');
});

test('waitForReview is an optional boolean that survives edits', () => {
 const saved = parseExternalDraft({ platform: 'email', providerIdentifier: 'p', from: 'me@example.com', to: ['ann@example.com'], subject: 'Hi', body: 'Hello', waitForReview: true });
 expect(saved.waitForReview).toBe(true);
 expect(editExternalDraft(saved, { body: 'Edited' }).waitForReview).toBe(true);
 expect(parseExternalDraft({ ...saved, waitForReview: false }).waitForReview).toBeUndefined();
 expect(() => parseExternalDraft({ ...saved, waitForReview: 'yes' })).toThrow('waitForReview');
});

test('the main-tool parser keeps waitForReview and the captured draft rules', async () => {
 const { normalizeMainToolArguments } = await import('../src/reference-main-parsers');
 const args = { platform: 'email', providerIdentifier: 'p', from: 'me@example.com', to: ['ann@example.com'], subject: 'Hi', body: 'Hello', waitForReview: true };
 expect(normalizeMainToolArguments('DraftExternalMessage', args)).toMatchObject({ waitForReview: true });
 expect(() => normalizeMainToolArguments('DraftExternalMessage', { ...args, channelId: 'C123456789' })).toThrow('only valid with platform:slack');
});

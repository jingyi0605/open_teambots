import { segment, type GoogleApi } from '../../_shared/google';
import { compact } from '../../_shared/reference';
import { workbookCsv } from './extract';
import { folderMime } from './query';

export const native = 'application/vnd.google-apps.';
const doc = `${native}document`, sheet = `${native}spreadsheet`, slides = `${native}presentation`, drawing = `${native}drawing`;
const kinds: Record<string, string> = { [doc]: 'Google Docs', [sheet]: 'Google Sheets', [slides]: 'Google Slides', [drawing]: 'Google Drawings', [`${native}form`]: 'Google Forms', [`${native}site`]: 'Google Sites', [`${native}jam`]: 'Jamboard', [`${native}map`]: 'Google My Maps' };
export const kindOf = (mimeType: string) => kinds[mimeType] ?? (mimeType === folderMime ? 'Folder' : mimeType.startsWith(native) ? `Google-native (${mimeType.slice(native.length)})` : mimeType);
export const exportMimeTypes: Record<string, string> = {
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', html: 'text/html', csv: 'text/csv', png: 'image/png', svg: 'image/svg+xml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
export const exportFormats: Record<string, string[]> = { [doc]: ['pdf', 'txt', 'md', 'html', 'docx'], [sheet]: ['pdf', 'csv', 'xlsx'], [slides]: ['pdf', 'txt', 'pptx'], [drawing]: ['pdf', 'png', 'svg'] };
/** Content Drive imports into a native file: Markdown, plain text or HTML into a Doc; CSV or TSV into a Sheet. */
export const importable: Record<string, RegExp> = { [doc]: /^text\/(?:markdown|plain|html)$/, [sheet]: /^text\/(?:csv|tab-separated-values)$/ };
export const textual = (mimeType: string) => !mimeType.startsWith('image/') && (mimeType.startsWith('text/') || /^application\/(?:json|xml|yaml|x-yaml|toml|x-toml|javascript|x-javascript|ecmascript|x-sh|x-shellscript|sql|x-sql|graphql|x-ndjson|csv|rtf)$/.test(mimeType) || /\+(?:json|xml|yaml)$/.test(mimeType));
export const readable = (mimeType: string) => [doc, sheet, slides].includes(mimeType) || textual(mimeType);
// Docs' Markdown export inlines every image as base64; it carries no text and would consume the character cap.
const withoutImages = (markdown: string) => markdown.replace(/<?data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+>?/g, '<embedded image omitted>');

/** Docs as Markdown, Sheets as CSV per tab, Slides and stored text files as text. */
export async function readText(api: GoogleApi, f: { id: string; name?: string; mimeType: string; size?: string }, maxBytes: number) {
  const path = `/drive/v3/files/${segment(f.id)}`;
  const bytes = async (exportMimeType?: string) => Buffer.from((await api.request(exportMimeType ? `${path}/export` : path, exportMimeType ? { mimeType: exportMimeType } : { alt: 'media', supportsAllDrives: true }, 'GET', undefined, { binary: true, maxBytes })).data, 'base64');
  if (f.mimeType === doc) return { format: 'markdown', text: withoutImages((await bytes('text/markdown')).toString('utf8')) };
  if (f.mimeType === sheet) return { format: 'csv', text: workbookCsv(await bytes(exportMimeTypes.xlsx)) };
  if (f.mimeType === slides) return { format: 'text', text: (await bytes('text/plain')).toString('utf8') };
  if (f.mimeType === folderMime) throw new Error(`"${f.name}" is a folder; list its contents with list_folder.`);
  if (f.mimeType.startsWith(native)) throw new Error(`${kindOf(f.mimeType)} files can't be read as text. Use export_file for a rendered copy where available.`);
  if (Number(f.size) > maxBytes) throw new Error('File exceeds the 64 MB per-operation limit; use a smaller file or open it in Google Drive.');
  if (textual(f.mimeType)) return { format: 'text', text: new TextDecoder().decode(await bytes()) };
  if (f.mimeType === 'application/octet-stream') {
    // Drive labels many source and config files without a text type; accept them only when they are valid UTF-8.
    const content = await bytes();
    try { if (!content.includes(0)) return { format: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(content) }; } catch {}
  }
  throw new Error(`"${f.name}" is a ${f.mimeType} file, which read_file doesn't read as text. Use download_file for its bytes, or read_file_content to extract text from PDFs, images and Office documents.`);
}

/** Select a 1-based inclusive line range, then cap it at whole lines where possible. */
export function lineRange(text: string, a: { startLine?: number; endLine?: number; maxChars?: number }) {
  const lines = text === '' ? [] : text.split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  const total = lines.length, start = a.startLine ?? 1, end = Math.min(a.endLine ?? total, total), max = a.maxChars ?? 100_000;
  if (a.endLine !== undefined && a.endLine < start) throw new Error('endLine must be greater than or equal to startLine');
  if (start > Math.max(total, 1)) throw new Error(`startLine ${start} is past the end of the file, which has ${total} lines`);
  let content = lines.slice(start - 1, end).join('\n'), last = Math.max(end, start - 1), partialLine: true | undefined;
  const truncated = content.length > max;
  if (truncated) {
    const cut = content.lastIndexOf('\n', max);
    if (cut >= 0) { content = content.slice(0, cut); last = start + content.split('\n').length - 1; }
    else { content = content.slice(0, max); last = start; partialLine = true; }
  }
  return compact({ content, startLine: start, endLine: last, totalLines: total, truncated, partialLine, nextStartLine: truncated && last < end ? last + 1 : undefined });
}

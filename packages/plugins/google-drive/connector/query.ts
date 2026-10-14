export const folderMime = 'application/vnd.google-apps.folder';
export const literal = (value: string) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const instant = (value: string) => /T/.test(value) ? value : `${value}T00:00:00Z`;

/** Translate the published MCP query grammar to Drive v3 without rewriting quoted text. */
export function driveQuery(query: string) {
  if (!/\b(?:contains|and|or|not|in)\b|[=!<>]/i.test(query)) return `fullText contains ${literal(query)}`;
  const tokens = query.match(/'(?:\\.|[^'\\])*'|!=|<=|>=|[()=<>]|\b[a-zA-Z_][\w.]*\b|\S/g) ?? [];
  const result: string[] = [];
  for (let i=0; i<tokens.length; i++) {
    const token = tokens[i]!;
    if (token === 'title') { result.push('name'); continue; }
    if (token === 'parentId' || token === 'owner') {
      const op=tokens[++i], value=tokens[++i];
      if (!['=', '!='].includes(op ?? '') || !value?.startsWith("'")) throw new Error(`${token} expects = or != and a quoted value`);
      result.push(...(op === '!=' ? ['not'] : []), `(${value} in ${token === 'owner' ? 'owners' : 'parents'})`);continue;
    }
    if (token === 'sharedWithMe' && ['=', '!='].includes(tokens[i+1] ?? '')) {
      const op=tokens[++i], value=tokens[++i];
      if (!['true','false'].includes(value ?? '')) throw new Error('sharedWithMe expects true or false');
      result.push(...((op === '=') === (value === 'true') ? [] : ['not']), 'sharedWithMe');continue;
    }
    result.push(token);
  }
  return result.join(' ');
}

/** Compile the typed search filters to one Drive v3 query; `sortable` is false once fullText is involved. */
export function searchQuery(a: Record<string, any>, folderId?: string) {
  const terms = ['trashed = false'];
  const exactName = a.exactName ?? a.exact_name, mimeType = a.mimeTypeFilter ?? a.mime_type_filter, text = a.query?.trim();
  let sortable = true;
  if (exactName) terms.push(`name = ${literal(exactName)}`);
  else if (text && a.titleOnly) terms.push(`name contains ${literal(text)}`);
  else if (text) { terms.push(`(name contains ${literal(text)} or fullText contains ${literal(text)})`); sortable = false; }
  terms.push(mimeType ? `mimeType = ${literal(mimeType)}` : `mimeType != '${folderMime}'`);
  if (folderId) terms.push(`${literal(folderId)} in parents`);
  if (a.ownerEmail) terms.push(`${literal(a.ownerEmail)} in owners`);
  if (a.writerEmail) terms.push(`${literal(a.writerEmail)} in writers`);
  if (a.sharedWithMe) terms.push('sharedWithMe');
  if (a.starred) terms.push('starred = true');
  if (a.visibility) terms.push(`visibility = ${literal(a.visibility)}`);
  for (const [key, field, operator] of [['createdAfter', 'createdTime', '>'], ['createdBefore', 'createdTime', '<'], ['modifiedAfter', 'modifiedTime', '>'], ['modifiedBefore', 'modifiedTime', '<']] as const)
    if (a[key]) terms.push(`${field} ${operator} ${literal(instant(a[key]))}`);
  return { q: terms.join(' and '), sortable };
}

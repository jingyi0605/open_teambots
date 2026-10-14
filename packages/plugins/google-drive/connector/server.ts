import { GoogleApi, integer, segment, servePlugin, string, strings, type Args, type Tool } from '../../_shared/google';
import { base64Bytes, compact, mapConcurrent, referenceTool } from '../../_shared/reference';
import { exportFormats, exportMimeTypes, importable, kindOf, lineRange, native, readable, readText, textual } from './content';
import { extractContent } from './extract';
import { driveQuery, folderMime, literal, searchQuery } from './query';

const fields = 'id,name,mimeType,size,modifiedTime,createdTime,webViewLink,parents,description,owners(emailAddress),sharedWithMeTime,viewedByMeTime,fileExtension,capabilities(canAddChildren)';
const listFields = 'id,name,mimeType,size,createdTime,modifiedTime,modifiedByMeTime,viewedByMeTime,webViewLink,parents,owners(displayName,emailAddress)';
const metadataFields = 'id,name,mimeType,description,starred,trashed,size,fileExtension,md5Checksum,version,createdTime,modifiedTime,modifiedByMeTime,viewedByMeTime,sharedWithMeTime,owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress),sharingUser(displayName,emailAddress),ownedByMe,shared,writersCanShare,copyRequiresWriterPermission,parents,driveId,webViewLink,webContentLink,iconLink,shortcutDetails,capabilities(canEdit,canComment,canShare,canCopy,canDownload,canRename,canTrash,canAddChildren,canMoveItemWithinDrive)';
const writeFields = 'id,name,mimeType,parents,webViewLink,createdTime,modifiedTime,size';
const commentFields = 'id,content,author(displayName,emailAddress,me),createdTime,modifiedTime,resolved,deleted,quotedFileContent,anchor';
const replyFields = 'id,content,action,author(displayName,emailAddress,me),createdTime,modifiedTime,deleted';
const normalizeFile = (f: any) => compact({ ...f, title: f.name, viewUrl: f.webViewLink, resourceUri: f.id ? `gdrive:///${f.id}` : undefined, fileSize: f.size, owner: f.owners?.[0]?.emailAddress, parentId: f.parents?.[0], canAddChildren: f.capabilities?.canAddChildren });
const exportFormatsByType: Record<string, string> = { 'application/vnd.google-apps.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.google-apps.spreadsheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.google-apps.presentation': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const downloadFormats: Record<string, string> = { 'application/vnd.google-apps.document': 'text/plain', 'application/vnd.google-apps.spreadsheet': 'text/csv', 'application/vnd.google-apps.presentation': 'text/plain' };
const maxFileBytes = 64 * 1024 * 1024, maxTransferBytes = 10 * 1024 * 1024;
const snippetVerbosity = { type: 'string', enum: ['UNSPECIFIED', 'BRIEF', 'MEDIUM', 'DETAILED', 'MAX_ALLOWED'], description: 'Legacy: add a content snippet of about 1000 (BRIEF), 2500 (MEDIUM), 5000 (DETAILED, the default once requested) or 20000 (MAX_ALLOWED) characters.' };
const snippets = { excludeContentSnippets: { type: 'boolean', description: 'Legacy: false adds a content snippet to each file (the earlier default); omitted or true returns metadata only.' }, snippetVerbosity };
const wantsSnippets = (a: Args) => a.snippetVerbosity !== undefined || a.excludeContentSnippets === false;

/** drive.file only covers files this app created or the user opened with it; Google's 403 for anything else is final. */
const permanent = (run: Tool['run']): Tool['run'] => async a => {
  try { return await run(a); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('Google API 403:') || /rate ?limit|quota/i.test(error.message)) throw error;
    throw new Error(`${error.message.replace(/ Check the API is enabled.*$/, '')} This is a permission result, not a temporary failure; do not retry it. This connector's Drive access (drive.file) can change only files and folders it created or that were opened with this app, and the account also needs edit access. Ask the user to make the change in Google Drive, or create a new file with this connector instead.`);
  }
};

export function driveTools(api = new GoogleApi('https://www.googleapis.com')): Tool[] {
  type Options = Parameters<typeof referenceTool>[3];
  const ref = (name: string, run: Tool['run'], options: Options = {}) => referenceTool('drive', name, run, options);
  const files = (name: string, run: Tool['run'], options: Options = {}) => referenceTool('driveFiles', name, options.risk && options.risk !== 'read' ? permanent(run) : run, options);
  const file = (id: string) => `/drive/v3/files/${segment(id)}`;
  const metadata = (id: string) => api.request(file(id), { fields, supportsAllDrives: true });
  const resolve = async (id: string) => {
    const f = await api.request(file(id), { fields: 'id,name,mimeType,size,shortcutDetails(targetId)', supportsAllDrives: true });
    return f.mimeType === `${native}shortcut` && f.shortcutDetails?.targetId ? api.request(file(f.shortcutDetails.targetId), { fields: 'id,name,mimeType,size', supportsAllDrives: true }) : f;
  };
  const fetchContent = async (f: any, exportMimeType?: string, forReading = true) => {
    if (Number(f.size) > maxFileBytes) throw new Error('File exceeds the 64 MB per-operation limit; use a smaller file or download it in Drive.');
    const isNative = f.mimeType?.startsWith(native);
    const mimeType = isNative ? exportMimeType ?? (forReading ? exportFormatsByType : downloadFormats)[f.mimeType] : f.mimeType;
    if (isNative && !mimeType) return { bytes: new Uint8Array(), mimeType: f.mimeType, unsupported: true };
    const response = await api.request(isNative ? `${file(f.id)}/export` : file(f.id), isNative ? { mimeType } : { alt: 'media', supportsAllDrives: true }, 'GET', undefined, { binary: true, maxBytes: maxFileBytes });
    return { bytes: new Uint8Array(Buffer.from(response.data, 'base64')), mimeType, unsupported: false };
  };
  const textContent = async (f: any, exportMimeType?: string) => {
    const content = await fetchContent(f, exportMimeType);
    return content.unsupported ? { text: '', supported: false, method: 'unsupported' } : extractContent(content.bytes, content.mimeType);
  };
  const withSnippet = async (f: any, a: Args) => {
    const result = normalizeFile(f);
    if (a.excludeContentSnippets) return result;
    try {
      const text = await textContent(f);
      const limit: number = ({ BRIEF: 1000, MEDIUM: 2500, DETAILED: 5000, MAX_ALLOWED: 20_000 } as Record<string, number>)[a.snippetVerbosity] ?? 5000;
      return { ...result, contentSnippet: text.text.slice(0, limit), ...(!text.supported ? { textFormattingNotSupported: true } : {}) };
    } catch (error) {
      // Discovery remains usable when one file is restricted, malformed, or cannot be exported.
      return { ...result, contentSnippetUnavailable: error instanceof Error ? error.message : 'Content unavailable' };
    }
  };
  const list = async (a: Args, q: string, orderBy?: string) => {
    const value = await api.request('/drive/v3/files', { q, orderBy, pageToken: a.pageToken, pageSize: a.pageSize ?? 10, spaces: 'drive', fields: `nextPageToken,incompleteSearch,files(${fields})`, supportsAllDrives: true, includeItemsFromAllDrives: true });
    return compact({ files: await mapConcurrent(value.files ?? [], (f: any) => withSnippet(f, a)), nextPageToken: value.nextPageToken, incompleteSearch: value.incompleteSearch });
  };
  const comments = async (id: string) => {
    const threads: any[] = [];
    let pageToken: string | undefined;
    do {
      const page = await api.request(`${file(id)}/comments`, { pageSize: 100, pageToken, includeDeleted: false, fields: 'nextPageToken,comments(id,content,author(displayName),modifiedTime,resolved,quotedFileContent,anchor,replies(id,content,author(displayName),modifiedTime,deleted))' });
      for (const c of page.comments ?? []) {
        const post = (p: any) => compact({ postId: p.id, authorName: p.author?.displayName, content: p.content, modifiedTime: p.modifiedTime });
        threads.push({ commentId: c.id, headPost: post(c), replies: (c.replies ?? []).filter((p: any) => !p.deleted).map(post), status: c.resolved ? 'RESOLVED' : 'OPEN', quotedContent: c.quotedFileContent?.value, anchor: c.anchor });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return threads;
  };
  const upload = async (meta: Args, bytes: Uint8Array, contentType: string, query: Args, id?: string) => {
    if (bytes.length > maxFileBytes) throw new Error('Uploads are limited to 64 MB per operation');
    const path = id ? `/upload/drive/v3/files/${segment(id)}` : '/upload/drive/v3/files', method = id ? 'PATCH' : 'POST';
    if (bytes.length > 5 * 1024 * 1024) {
      const session = await api.request(path, { ...query, uploadType: 'resumable' }, method, meta, { includeHeaders: true, headers: { 'X-Upload-Content-Type': contentType, 'X-Upload-Content-Length': String(bytes.length) } });
      const target = new URL(session.headers.location);
      if (target.origin !== 'https://www.googleapis.com' || !target.pathname.startsWith('/upload/drive/v3/files')) throw new Error('Google returned an unexpected upload URL');
      return api.request(target.pathname + target.search, {}, 'PUT', undefined, { rawBody: bytes, contentType });
    }
    const boundary = `openteam-${crypto.randomUUID()}`;
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return api.request(path, { ...query, uploadType: 'multipart' }, method, undefined, { rawBody: body, contentType: `multipart/related; boundary=${boundary}` });
  };
  const findFolders = async (name: string): Promise<Array<{ id: string; name: string }>> => {
    for (const match of [`name = ${literal(name)}`, `name contains ${literal(name)}`]) {
      const found = await api.request('/drive/v3/files', { q: `mimeType = '${folderMime}' and trashed = false and ${match}`, orderBy: 'modifiedTime desc', pageSize: 5, fields: 'files(id,name)', supportsAllDrives: true, includeItemsFromAllDrives: true });
      if (found.files?.length) return found.files;
    }
    throw new Error(`No folder named "${name}" was found. Check the name, or search with mimeTypeFilter ${folderMime} to find its id.`);
  };
  const relocate = async (a: Args) => {
    const parent = a.parentId || a.destination_folder_id || undefined, name = a.title?.trim() ? a.title : undefined;
    if (!parent && !name) throw new Error('Provide title to rename, parentId to move, or both');
    let query: Args = { fields: writeFields, supportsAllDrives: true };
    if (parent) {
      const current: string[] = (await api.request(file(a.fileId), { fields: 'parents', supportsAllDrives: true })).parents ?? [];
      if (!current.includes(parent)) query = { ...query, addParents: parent, removeParents: current.join(',') || undefined };
    }
    return api.request(file(a.fileId), query, 'PATCH', compact({ name }));
  };
  const createFile = async (a: Args) => {
    const legacyName = a.name !== undefined && a.title === undefined;
    const reference = !legacyName && ['base64Content', 'content', 'mimeType', 'disableConversionToGoogleType'].some(k => a[k] !== undefined);
    const legacy = legacyName || reference || a.name !== undefined || a.parents !== undefined;
    const contentKeys = ['base64Content', 'textContent', 'content'].filter(k => a[k] !== undefined);
    if (contentKeys.length > 1) throw new Error('Supply only one of base64Content, textContent or content');
    const name: string | undefined = a.title ?? a.name;
    if (!name?.trim()) throw new Error('A file title is required');
    const binary = a.base64Content !== undefined || (a.content !== undefined && !legacyName);
    const inputMime: string | undefined = a.contentMimeType || a.mimeType || (legacyName || (contentKeys.length && !binary) ? 'text/plain' : undefined);
    if (!inputMime) throw new Error(contentKeys.length ? 'contentMimeType is required when uploading content' : 'textContent is required; use an empty string for an empty file');
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(inputMime)) throw new Error('Invalid contentMimeType');
    const requested: string | undefined = a.targetMimeType || a.target_mime_type || undefined;
    let target = requested ?? (inputMime.startsWith(native) ? inputMime : undefined);
    if (requested) {
      if (!importable[requested]) throw new Error(`targetMimeType must be ${native}document or ${native}spreadsheet`);
      if (!binary && !inputMime.startsWith(native) && !importable[requested].test(inputMime)) throw new Error(`Drive can't convert ${inputMime} into ${kindOf(requested)}; use text/markdown or text/plain for a Google Doc and text/csv for a Google Sheet.`);
    } else if (reference && !a.disableConversionToGoogleType && !target) {
      // The earlier Google definition converted supported uploads by default.
      if (/spreadsheet|excel|csv|opendocument.spreadsheet/.test(inputMime)) target = `${native}spreadsheet`;
      else if (/presentation|powerpoint/.test(inputMime)) target = `${native}presentation`;
      else if (/^text\/(plain|html)$|word|opendocument.text|rtf/.test(inputMime)) target = `${native}document`;
    }
    const parent = a.parentId || a.parent_folder_id || undefined;
    const meta = compact({ name, mimeType: target ?? inputMime, parents: parent ? [parent] : a.parents });
    const query = { fields: legacy ? fields : writeFields, supportsAllDrives: true }, shape = (f: any) => legacy ? normalizeFile(f) : f;
    if (contentKeys.length && meta.mimeType === folderMime) throw new Error('Folders cannot contain uploaded file content');
    if (!contentKeys.length) return shape(await api.request('/drive/v3/files', query, 'POST', meta));
    const bytes = a.base64Content !== undefined ? base64Bytes(a.base64Content) : a.textContent !== undefined ? Buffer.from(a.textContent) : legacyName ? Buffer.from(a.content) : base64Bytes(a.content);
    return shape(await upload(meta, bytes, inputMime.startsWith(native) ? 'text/plain' : inputMime, query));
  };
  return [
    files('search', async a => {
      let folderId: string | undefined = a.folderId || undefined, resolved: Args = {};
      if (!folderId && a.folderName) {
        const [first, ...others] = await findFolders(a.folderName);
        folderId = first!.id;
        resolved = compact({ resolvedFolderId: folderId, resolvedFolderName: first!.name, otherMatchingFolders: others.length ? others : undefined });
      }
      const { q, sortable } = searchQuery(a, folderId);
      const value = await api.request('/drive/v3/files', { q, orderBy: sortable ? a.modifiedByMe ? 'modifiedByMeTime desc' : 'modifiedTime desc' : undefined, pageSize: a.pageSize ?? 10, pageToken: a.pageToken, fields: `nextPageToken,incompleteSearch,files(id,name,mimeType,webViewLink,size,modifiedTime,shortcutDetails(targetId,targetMimeType)${a.modifiedByMe ? ',modifiedByMeTime' : ''})`, supportsAllDrives: true, includeItemsFromAllDrives: true });
      const found: any[] = value.files ?? [];
      // Relevance-ranked full-text results cannot be sorted by Drive; keep relevance order among files the user edited.
      if (a.modifiedByMe && !sortable) found.sort((x, y) => Number(Boolean(y.modifiedByMeTime)) - Number(Boolean(x.modifiedByMeTime)));
      if (a.includeContent) await mapConcurrent(found.filter(f => readable(f.shortcutDetails?.targetMimeType ?? f.mimeType)).slice(0, 3), async f => {
        try {
          const { format, text } = await readText(api, { id: f.shortcutDetails?.targetId ?? f.id, name: f.name, mimeType: f.shortcutDetails?.targetMimeType ?? f.mimeType, size: f.size }, maxFileBytes);
          Object.assign(f, { contentFormat: format, content: text.slice(0, 10_000) }, text.length > 10_000 ? { contentTruncated: true } : {});
        } catch (error) { f.contentError = error instanceof Error ? error.message : 'Content unavailable'; }
      }, 3);
      return compact({ files: found, nextPageToken: value.nextPageToken, incompleteSearch: value.incompleteSearch, ...resolved });
    }, { risk: 'read', properties: { exact_name: string('Alias of exactName.'), mime_type_filter: string('Alias of mimeTypeFilter.') } }),
    files('list_folder', a => api.request('/drive/v3/files', { q: `${literal(a.folderId || 'root')} in parents and trashed = false`, orderBy: 'folder,name', pageSize: a.pageSize ?? 50, pageToken: a.pageToken, fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,size,modifiedTime,webViewLink,shortcutDetails(targetId,targetMimeType))', supportsAllDrives: true, includeItemsFromAllDrives: true }), { risk: 'read' }),
    files('list_recent_files', a => {
      const orderBy = ({ lastModified: 'modifiedTime desc', lastModifiedByMe: 'modifiedByMeTime desc' } as Record<string, string>)[a.orderBy] ?? 'recency desc';
      if (wantsSnippets(a)) return list(a, 'trashed = false', orderBy);
      return api.request('/drive/v3/files', { q: 'trashed = false', orderBy, pageSize: a.pageSize ?? 10, pageToken: a.pageToken, fields: `nextPageToken,incompleteSearch,files(${listFields})`, supportsAllDrives: true, includeItemsFromAllDrives: true });
    }, { risk: 'read', properties: snippets }),
    files('read_file', async a => {
      if (a.endLine !== undefined && a.endLine < (a.startLine ?? 1)) throw new Error('endLine must be greater than or equal to startLine');
      const f = await resolve(a.fileId);
      const { format, text } = await readText(api, f, maxFileBytes);
      return { id: f.id, name: f.name, mimeType: f.mimeType, format, ...lineRange(text, a) };
    }, { risk: 'read' }),
    files('get_file_metadata', async a => {
      const f = await api.request(file(a.fileId), { fields: metadataFields, supportsAllDrives: true });
      return wantsSnippets(a) ? withSnippet(f, a) : f;
    }, { risk: 'read', properties: snippets }),
    files('get_file_permissions', a => api.request(`${file(a.fileId)}/permissions`, { pageToken: a.pageToken, pageSize: a.pageSize ?? 100, fields: 'nextPageToken,permissions(id,type,role,emailAddress,domain,displayName,expirationTime,deleted,pendingOwner,allowFileDiscovery,view,permissionDetails)', supportsAllDrives: true }), { risk: 'read', properties: { pageSize: integer('Legacy page size (default 100)', 100) } }),
    files('download_file', async a => {
      const f = await resolve(a.fileId);
      if (f.mimeType.startsWith(native)) throw new Error(f.mimeType === folderMime ? `"${f.name}" is a folder; list its contents with list_folder.` : `"${f.name}" is a ${kindOf(f.mimeType)} file, which has no stored bytes to download. Use export_file to render it (for example as pdf), or read_file for its text.`);
      if (Number(f.size) > maxTransferBytes) throw new Error(`"${f.name}" is ${(Number(f.size) / 1024 / 1024).toFixed(1)} MB; download_file is capped at 10 MB.`);
      const response = await api.request(file(f.id), { alt: 'media', supportsAllDrives: true }, 'GET', undefined, { binary: true, maxBytes: maxTransferBytes });
      return { name: f.name, mimeType: f.mimeType, base64: response.data };
    }, { risk: 'read' }),
    files('export_file', async a => {
      const f = await resolve(a.fileId), allowed = exportFormats[f.mimeType];
      if (!allowed) throw new Error(f.mimeType.startsWith(native) ? `${kindOf(f.mimeType)} files can't be exported.` : `"${f.name}" is a stored ${f.mimeType} file, not a Google-native file; use download_file for its bytes.`);
      if (!allowed.includes(a.format)) throw new Error(`${kindOf(f.mimeType)} files export as ${allowed.join(', ')}; ${a.format} isn't available.`);
      const mimeType = exportMimeTypes[a.format]!;
      const response = await api.request(`${file(f.id)}/export`, { mimeType }, 'GET', undefined, { binary: true, maxBytes: maxTransferBytes });
      return { name: f.name, mimeType, format: a.format, base64: response.data };
    }, { risk: 'read' }),
    files('create_folder', a => {
      const parent = a.parentId || a.parent_folder_id || undefined;
      if (!a.title.trim()) throw new Error('A folder title is required');
      return api.request('/drive/v3/files', { fields: writeFields, supportsAllDrives: true }, 'POST', compact({ name: a.title, mimeType: folderMime, parents: parent ? [parent] : undefined }));
    }, { risk: 'write', properties: { parent_folder_id: string('Alias of parentId.') } }),
    files('create_file', createFile, { risk: 'write', required: [], anyOf: [{ required: ['title'] }, { required: ['name'] }], properties: {
      parent_folder_id: string('Alias of parentId.'), target_mime_type: string('Alias of targetMimeType.'),
      base64Content: string('Legacy: base64-encoded content to upload instead of textContent; contentMimeType is required. Unless disableConversionToGoogleType is true, convertible types become Google files.'),
      content: string('Legacy, deprecated: base64-encoded content. Use textContent.'),
      disableConversionToGoogleType: { type: 'boolean', description: 'Legacy: with base64Content or content, keep the uploaded type instead of converting it to a Google type.' },
      mimeType: string('Legacy, deprecated: use contentMimeType.'),
      name: string('Legacy file title'), parents: strings('Legacy destination folder IDs'),
    } }),
    files('update_file_content', async a => {
      const f = await api.request(file(a.fileId), { fields: 'id,name,mimeType', supportsAllDrives: true });
      const sheet = f.mimeType === `${native}spreadsheet`;
      let contentType: string;
      if (importable[f.mimeType]) {
        // Sheets only import delimited text, so an omitted type means CSV there.
        contentType = a.contentMimeType || (sheet ? 'text/csv' : 'text/plain');
        if (!importable[f.mimeType]!.test(contentType)) throw new Error(`${kindOf(f.mimeType)} content can't be replaced from ${contentType}; use ${sheet ? 'text/csv' : 'text/markdown or text/plain'}.`);
      } else if (f.mimeType.startsWith(native)) throw new Error(`${kindOf(f.mimeType)} content can't be replaced from text${f.mimeType === `${native}presentation` ? '; edit the deck with the Google Slides tools' : ''}.`);
      else contentType = a.contentMimeType || (textual(f.mimeType) ? f.mimeType : 'text/plain');
      return upload({}, Buffer.from(a.textContent), contentType, { fields: writeFields, supportsAllDrives: true }, f.id);
    }, { risk: 'write' }),
    files('move_or_rename', relocate, { risk: 'write', properties: { destination_folder_id: string('Alias of parentId.') } }),
    files('update_file', relocate, { risk: 'write' }),
    files('copy_file', async a => {
      const source = await api.request(file(a.fileId), { fields: 'id,name,mimeType', supportsAllDrives: true });
      if (source.mimeType === folderMime) throw new Error("Folders can't be copied. Create a folder with create_folder and copy the files into it.");
      const legacy = a.name !== undefined || a.parents !== undefined;
      const copy = await api.request(`${file(a.fileId)}/copy`, { fields: legacy ? fields : writeFields, supportsAllDrives: true }, 'POST', compact({ name: a.title || a.name || `Copy of ${source.name}`, parents: a.parentId ? [a.parentId] : a.parents }));
      return legacy ? normalizeFile(copy) : copy;
    }, { risk: 'write', properties: { name: string('Legacy title'), parents: strings('Legacy destination folder IDs') } }),
    files('share_file', a => {
      const domain = a.type === 'domain';
      if (domain ? !a.domain : !a.emailAddress) throw new Error(domain ? 'domain is required for a domain share' : `emailAddress is required for a ${a.type} share`);
      if (domain ? a.emailAddress !== undefined : a.domain !== undefined) throw new Error('Use emailAddress for user or group shares and domain for domain shares');
      if (domain && a.sendNotification) throw new Error('Google sends share notifications only to users and groups');
      return api.request(`${file(a.fileId)}/permissions`, { sendNotificationEmail: domain ? undefined : a.sendNotification ?? false, supportsAllDrives: true, fields: 'id,type,role,emailAddress,domain,displayName' }, 'POST', compact({ type: a.type, role: a.role, emailAddress: a.emailAddress, domain: a.domain }));
    }, { risk: 'write' }),
    files('trash_file', a => api.request(file(a.fileId), { fields: `${writeFields},trashed`, supportsAllDrives: true }, 'PATCH', { trashed: true }), { risk: 'destructive' }),
    files('list_comments', a => api.request(`${file(a.fileId)}/comments`, { pageSize: 20, pageToken: a.pageToken, includeDeleted: a.includeDeleted ?? false, fields: `nextPageToken,comments(${commentFields},replies(${replyFields}))` }), { risk: 'read' }),
    files('add_comment', a => {
      if (!a.content.trim()) throw new Error('Comment content is required');
      return api.request(`${file(a.fileId)}/comments`, { fields: commentFields }, 'POST', { content: a.content });
    }, { risk: 'write' }),
    files('reply_to_comment', a => {
      const action = a.action || undefined, content = a.content?.trim() ? a.content : undefined;
      if (!action && !content) throw new Error('content is required unless action is "resolve" or "reopen"');
      return api.request(`${file(a.fileId)}/comments/${segment(a.commentId)}/replies`, { fields: replyFields }, 'POST', compact({ content, action }));
    }, { risk: 'write' }),
    // Earlier Google definitions, kept unchanged for existing callers.
    ref('search_files', a => list(a, `trashed = false${a.q ? ` and (${a.q})` : a.query ? ` and (${driveQuery(a.query)})` : ''}`), { properties: { q: string('Legacy Drive v3 query; query accepts the published MCP query syntax or plain keywords') } }),
    ref('read_file_content', async a => {
      const f = await metadata(a.fileId);
      const content = await textContent(f, a.exportMimeType);
      const supportsComments = f.mimeType in exportFormatsByType;
      const threads = a.includeComments && supportsComments ? await comments(f.id) : [];
      let fileContent = content.text;
      for (const thread of threads) {
        const marker = `[comment:${thread.commentId}]`;
        if (thread.quotedContent && fileContent.includes(thread.quotedContent)) fileContent = fileContent.replace(thread.quotedContent, `${thread.quotedContent} ${marker}`);
        else fileContent += `\n${marker} ${thread.quotedContent ?? ''}`;
      }
      return compact({ fileContent, textFormattingNotSupported: !content.supported, ...(a.includeComments ? { commentThreads: threads, commentsNotSupported: !supportsComments } : {}), extractionMethod: content.method });
    }, { properties: { exportMimeType: string('Optional supported export MIME type') } }),
    ref('download_file_content', async a => {
      const f = await metadata(a.fileId);
      const content = await fetchContent(f, a.exportMimeType, false);
      if (content.unsupported) throw new Error('This file type requires a supported exportMimeType');
      return { id: f.id, title: f.name, mimeType: content.mimeType, content: Buffer.from(content.bytes).toString('base64') };
    }),
  ];
}
if (import.meta.main) await servePlugin('openteam-google-drive', driveTools());

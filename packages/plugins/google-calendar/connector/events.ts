import { compact } from '../../_shared/reference';
import { eventDate, resolveZone } from './time';
import type { Args, GoogleApi } from '../../_shared/google';

export const eventTypes: Record<string, string> = { EVENT_TYPE_UNSPECIFIED: 'default', DEFAULT: 'default', OUT_OF_OFFICE: 'outOfOffice', FOCUS_TIME: 'focusTime', WORKING_LOCATION: 'workingLocation', BIRTHDAY: 'birthday', FROM_GMAIL: 'fromGmail' };
export const notification = (a: Args) => a.sendUpdates ?? ({ NONE: 'none', EXTERNAL_ONLY: 'externalOnly', ALL: 'all', NOTIFICATION_LEVEL_UNSPECIFIED: 'all' }[a.notificationLevel as string] ?? (a.event ? 'none' : 'all'));
const office = (o: any) => compact({ buildingId: o.buildingId, floorId: o.floorId, floorSectionId: o.floorSectionId, deskId: o.deskId, label: o.label });
const codeTypes: Record<string, string> = { accessCode: 'ACCESS_CODE', passcode: 'PASSCODE', password: 'PASSWORD', meetingCode: 'MEETING_CODE', pin: 'PIN' };
const entryPoint = (p: any) => {
  const codes = Object.keys(codeTypes).filter(k => p[k]).map(k => ({ codeType: codeTypes[k], value: p[k] }));
  return compact({ uri: p.uri, codes: codes.length ? codes : undefined });
};
// Adds the reference conference fields alongside the REST conferenceData fields.
const conference = (c: any) => {
  const points: any[] = c.entryPoints ?? [], point = (type: string) => points.filter(p => p.entryPointType === type).map(entryPoint)[0];
  const phones = points.filter(p => p.entryPointType === 'phone').map(p => compact({ ...entryPoint(p), uri: undefined, phoneNumber: p.uri?.replace(/^tel:/i, '') ?? p.label, regionCode: p.regionCode, isTollNumber: p.entryPointFeatures?.includes('toll') ? true : p.entryPointFeatures?.includes('tollFree') ? false : undefined }));
  return compact({ ...c, videoEntryPoint: point('video'), sipEntryPoint: point('sip'), moreDetailsEntryPoint: point('more'), phoneEntryPoints: phones.length ? phones : undefined, solutionName: c.conferenceSolution?.name, joiningNotesText: c.notes });
};
export const normalizeEvent = (e: any) => compact({ ...e,
  eventType: Object.keys(eventTypes).find(k => k !== 'EVENT_TYPE_UNSPECIFIED' && eventTypes[k] === e.eventType),
  availability: e.transparency === 'transparent' ? 'AVAILABILITY_FREE' : 'AVAILABILITY_BUSY',
  conferenceUrl: e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p: any) => p.entryPointType === 'video')?.uri,
  conferenceData: e.conferenceData ? conference(e.conferenceData) : undefined,
  guestPermissions: compact({ guestsCanInviteOthers: e.guestsCanInviteOthers, guestsCanModify: e.guestsCanModify, guestsCanSeeGuests: e.guestsCanSeeOtherGuests }),
  useDefaultReminders: e.reminders?.useDefault,
  overrideReminders: e.reminders?.useDefault === false ? e.reminders.overrides ?? [] : undefined,
  attendees: e.attendees?.map((p: any) => ({ ...p, optionalAttendee: p.optional ?? false })),
  workingLocationProperties: e.workingLocationProperties ? compact({ type: ({ customLocation: 'CUSTOM_LOCATION', officeLocation: 'OFFICE_LOCATION' } as Record<string, string>)[e.workingLocationProperties.type] ?? 'HOME_OFFICE',
    customLocationLabel: e.workingLocationProperties.customLocation?.label, officeLocation: e.workingLocationProperties.officeLocation ? office(e.workingLocationProperties.officeLocation) : undefined }) : undefined,
});
const attendee = (a: any) => compact({ email: a.email, displayName: a.displayName, optional: a.optionalAttendee ?? a.optional, additionalGuests: a.additionalGuests, resource: a.resource, responseStatus: a.responseStatus });
export async function eventBody(api: GoogleApi, a: Args, existing?: any): Promise<any> {
  const body: any = { ...a.event };
  for (const key of ['summary', 'description', 'location', 'colorId', 'visibility']) if (a[key] !== undefined) body[key] = a[key];
  if (a.startTime !== undefined || a.endTime !== undefined || a.allDay !== undefined || a.timeZone !== undefined) {
    const zone = await resolveZone(api, a);
    const allDay = a.allDay ?? Boolean(existing?.start?.date);
    for (const [input, output] of [['startTime', 'start'], ['endTime', 'end']] as const) {
      const value = a[input] ?? existing?.[output]?.dateTime ?? existing?.[output]?.date;
      if (value !== undefined) body[output] = eventDate(value, zone, allDay, Boolean(a.timeZone && a[input]));
    }
    if (existing && a.startTime !== undefined && a.endTime === undefined) {
      const previousStart = existing.start?.dateTime ?? existing.start?.date;
      const previousEnd = existing.end?.dateTime ?? existing.end?.date;
      const duration = Date.parse(previousEnd) - Date.parse(previousStart);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('Existing event duration is unavailable; specify endTime');
      const nextStart = body.start.dateTime ?? body.start.date;
      body.end = eventDate(new Date(Date.parse(nextStart) + duration).toISOString(), zone, allDay, false);
    }
  }
  const start = body.start ?? existing?.start, end = body.end ?? existing?.end;
  if (start && end) {
    if (Boolean(start.date) !== Boolean(end.date)) throw new Error('Event start and end must both be all-day dates or both be times');
    const s = start.date ?? start.dateTime, e = end.date ?? end.dateTime;
    if (!Number.isFinite(Date.parse(s)) || !Number.isFinite(Date.parse(e)) || Date.parse(e) <= Date.parse(s)) throw new Error('Event end must be later than start');
  }
  if (a.recurrenceData !== undefined) body.recurrence = a.recurrenceData;
  if (a.attachments !== undefined) body.attachments = a.attachments;
  if (a.attendees !== undefined || a.attendeeEmails !== undefined) body.attendees = a.attendees?.map(attendee) ?? a.attendeeEmails.map((email: string) => ({ email }));
  if (!existing && !a.event && body.attendees?.length) {
    const primary = await api.request('/users/me/calendarList/primary');
    const isPrimary = !a.calendarId || a.calendarId === 'primary' || a.calendarId.toLowerCase() === primary.id?.toLowerCase();
    if (isPrimary && primary.id && !body.attendees.some((p: any) => p.email?.toLowerCase() === primary.id.toLowerCase())) {
      body.attendees.push({ email: primary.id, responseStatus: 'accepted' });
    }
  }
  if (a.addedAttendees || a.addedAttendeeEmails || a.removedAttendeeEmails) {
    const removed = new Set((a.removedAttendeeEmails ?? []).map((s: string) => s.toLowerCase()));
    const merged = new Map((body.attendees ?? existing?.attendees ?? []).filter((p: any) => !removed.has(p.email?.toLowerCase())).map((p: any) => [p.email?.toLowerCase(), p]));
    for (const p of [...(a.addedAttendees ?? []).map(attendee), ...(a.addedAttendeeEmails ?? []).map((email: string) => ({ email }))]) merged.set(p.email.toLowerCase(), { ...merged.get(p.email.toLowerCase()) as any, ...p });
    body.attendees = [...merged.values()];
  }
  if (a.addedAttachments || a.removedAttachmentFileUrls) {
    const removed = new Set(a.removedAttachmentFileUrls ?? []);
    const merged = new Map((existing?.attachments ?? []).filter((p: any) => !removed.has(p.fileUrl)).map((p: any) => [p.fileUrl, p]));
    for (const p of a.addedAttachments ?? []) merged.set(p.fileUrl, p);
    body.attachments = [...merged.values()];
  }
  if (a.availability) body.transparency = a.availability === 'AVAILABILITY_FREE' ? 'transparent' : 'opaque';
  if (a.useDefaultReminders && a.overrideReminders?.length) throw new Error('useDefaultReminders cannot be true when overrideReminders are specified');
  // PATCH merges nested objects, so always send overrides to replace any existing ones.
  if (a.useDefaultReminders !== undefined || a.overrideReminders !== undefined) body.reminders = { useDefault: a.useDefaultReminders === true, overrides: a.overrideReminders ?? [] };
  if (a.guestPermissions) {
    const permissions = a.guestPermissions;
    if (permissions.guestsCanInviteOthers !== undefined) body.guestsCanInviteOthers = permissions.guestsCanInviteOthers;
    if (permissions.guestsCanModify !== undefined) body.guestsCanModify = permissions.guestsCanModify;
    if (permissions.guestsCanSeeGuests !== undefined) body.guestsCanSeeOtherGuests = permissions.guestsCanSeeGuests;
  }
  if (a.eventType) body.eventType = eventTypes[a.eventType];
  if (body.eventType === 'fromGmail') throw new Error('FROM_GMAIL events cannot be created');
  if (body.eventType === 'outOfOffice') body.outOfOfficeProperties = { autoDeclineMode: 'declineNone' };
  if (body.eventType === 'focusTime') body.focusTimeProperties = { autoDeclineMode: 'declineNone', chatStatus: 'available' };
  if (body.eventType === 'birthday') body.birthdayProperties = { type: 'birthday' };
  if (a.workingLocationProperties) {
    const p = a.workingLocationProperties;
    if (p.type === 'CUSTOM_LOCATION' && !p.customLocationLabel) throw new Error('Custom working locations require customLocationLabel');
    if (p.type === 'OFFICE_LOCATION' && !p.officeLocation) throw new Error('Office working locations require officeLocation');
    body.workingLocationProperties = p.type === 'CUSTOM_LOCATION' ? { type: 'customLocation', customLocation: { label: p.customLocationLabel } }
      : p.type === 'OFFICE_LOCATION' ? { type: 'officeLocation', officeLocation: office(p.officeLocation) } : { type: 'homeOffice', homeOffice: {} };
  }
  if (a.googleMeetUrl) {
    const code = a.googleMeetUrl.replace(/^https:\/\/meet\.google\.com\//, '');
    if (!/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code)) throw new Error('Provide a valid Google Meet URL or meeting code');
    body.conferenceData = { conferenceId: code, conferenceSolution: { key: { type: 'hangoutsMeet' } }, entryPoints: [{ entryPointType: 'video', uri: `https://meet.google.com/${code}` }] };
  } else if (a.addGoogleMeetUrl) body.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  if (body.eventType === 'workingLocation' && !body.workingLocationProperties) body.workingLocationProperties = { type: 'homeOffice', homeOffice: {} };
  // Google rejects working location events unless they are free and public.
  if (body.eventType === 'workingLocation') { body.transparency = 'transparent'; body.visibility ??= 'public'; }
  return body;
}

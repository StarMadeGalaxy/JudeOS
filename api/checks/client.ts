import type { operations, paths, components } from '../dist/schema.js';
import createClient from 'openapi-fetch';

// Compile-time examples of the generated contract; no network requests execute.
type Mark = operations['setAttendance']['requestBody']['content']['application/json'];
type Saved = operations['setAttendance']['responses'][200]['content']['application/json'];
type Conflict = operations['setAttendance']['responses'][409]['content']['application/json'];

const mark: Mark = { operation_id: '00000000-0000-4000-8000-000000000701', base_version: 0, status: 'present' };
const status: Saved['attendance']['status'] = mark.status;
const conflictCode: Conflict['code'] = 'ATTENDANCE_VERSION_CONFLICT';
// @ts-expect-error Trial is an independent roster flag, not an attendance state.
const invalidStatus: Mark['status'] = 'trial';
// @ts-expect-error base_version is mandatory to prevent silent overwrites.
const invalidMark: Mark = { operation_id: mark.operation_id, status };
void [status, conflictCode, invalidStatus, invalidMark];

// Compile the transport's path, header and response types; no requests run here.
const client = createClient<paths>({ baseUrl: 'https://judeos.example', credentials: 'include' });
async function exampleRequest() {
  const result = await client.PUT('/api/v1/tenants/{tenant_id}/sessions/{session_id}/attendance/{athlete_id}', {
    params: {
      path: {
        tenant_id: '00000000-0000-4000-8000-000000000101',
        session_id: '00000000-0000-4000-8000-000000000501',
        athlete_id: '00000000-0000-4000-8000-000000000401',
      },
      header: { 'X-CSRF-Token': 'synthetic-csrf-token-0000000000000001', Origin: 'https://judeos.example' },
    },
    body: mark,
  });
  if (result.data) {
    const savedStatus: Mark['status'] = result.data.attendance.status;
    return savedStatus;
  }
  return result.error?.code;
}
void exampleRequest;

// Proposed S1 wire examples only; these do not execute commands or grant rights.
type NewPerson = operations['createPerson']['requestBody']['content']['application/json'];
type ContactChoice = operations['setPrimaryContact']['requestBody']['content']['application/json'];
type Close = operations['closeSession']['requestBody']['content']['application/json'];
const guestProfile: NewPerson = { operation_id: mark.operation_id, display_name: 'Синтетический гость' };
const clearContact: ContactChoice = { operation_id: mark.operation_id, base_version: 1, guardian_link_id: null };
const contactWithoutPhone: components['schemas']['PrimaryContact'] = { display_name: 'Синтетический представитель', phone: null };
const close: Close = { operation_id: mark.operation_id, base_version: 1 };
type TemporaryAdd = operations['addKnownRosterAthlete']['requestBody']['content']['application/json'];
const temporaryAdd: TemporaryAdd = { operation_id: mark.operation_id, base_version: 1, athlete_id: '00000000-0000-4000-8000-000000000401', trial: false };
// @ts-expect-error Session-only addition cannot enroll an athlete in a group.
const permanentEnrollment: TemporaryAdd = { ...temporaryAdd, enroll_permanently: true };
// @ts-expect-error S1 does not collect birth dates.
const invalidPerson: NewPerson = { ...guestProfile, birth_date: '2010-01-01' };
// @ts-expect-error Coach projection does not expose the verification basis.
const leakedContact: components['schemas']['PrimaryContact'] = { display_name: 'Синтетический представитель', phone: null, basis_kind: 'synthetic' };
void [guestProfile, clearContact, contactWithoutPhone, close, temporaryAdd, permanentEnrollment, invalidPerson, leakedContact];

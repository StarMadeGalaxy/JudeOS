import type { Journal, Entry, Schema } from "./model";

export const uuid = (number: number) =>
  `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
export const tenantId = uuid(101);
export const fixtureDate = "2026-10-10";
export const fixtureNow = "2026-10-10T12:04:00Z";
export const actorId = uuid(1);
function entry(index: number, name: string): Entry {
  const athleteId = uuid(401 + index);
  return {
    athlete_id: athleteId,
    person_id: uuid(301 + index),
    display_name: name,
    participation: "regular",
    trial: false,
    excluded: false,
    primary_contact: null,
    admission: null,
    attendance: {
      athlete_id: athleteId,
      status: "unmarked",
      version: 0,
      recorded_at: null,
      recorded_by_account_id: null,
    },
  };
}
export function fixtures(): Journal[] {
  const roster = [
    entry(0, "Синтетический спортсмен А"),
    entry(1, "Синтетический спортсмен Б"),
    entry(2, "Синтетический спортсмен А"),
    entry(3, "Синтетический спортсмен В"),
    entry(4, "Синтетический спортсмен Г"),
    entry(5, "Синтетическая участница Д с длинным именем"),
  ];
  roster[0].attendance = {
    athlete_id: roster[0].athlete_id,
    status: "present",
    version: 1,
    recorded_at: fixtureNow,
    recorded_by_account_id: actorId,
  };
  roster[0].primary_contact = {
    display_name: "Синтетический представитель А",
    phone: "+375 00 000-00-00",
  };
  roster[1].admission = { state: "not_admitted", valid_until: null };
  roster[1].primary_contact = {
    display_name: "Синтетический представитель Б",
    phone: null,
  };
  roster[2].participation = "visit";
  roster[2].trial = true;
  roster[3].excluded = true;
  roster[3].attendance = {
    athlete_id: roster[3].athlete_id,
    status: "absent",
    version: 1,
    recorded_at: fixtureNow,
    recorded_by_account_id: actorId,
  };
  const session: Journal["session"] = {
    session_id: uuid(501),
    tenant_id: tenantId,
    group: { id: uuid(601), name: "Синтетическая группа · Дзюдо" },
    venue: { id: uuid(602), name: "Учебный зал · Минск" },
    starts_at: "2026-10-10T12:00:00Z",
    ends_at: "2026-10-10T13:00:00Z",
    state: "in_progress",
    version: 1,
  };
  return [
    { session, roster },
    {
      session: {
        ...session,
        session_id: uuid(502),
        group: { id: uuid(603), name: "Синтетическая вечерняя группа" },
        starts_at: "2026-10-10T15:00:00Z",
        ends_at: "2026-10-10T16:00:00Z",
        state: "planned",
      },
      roster: [entry(10, "Синтетический спортсмен Е")],
    },
    {
      session: {
        ...session,
        session_id: uuid(503),
        starts_at: "2026-10-10T07:00:00Z",
        ends_at: "2026-10-10T08:00:00Z",
        state: "closed",
      },
      roster: [entry(11, "Синтетический спортсмен Ж")],
    },
    {
      session: {
        ...session,
        session_id: uuid(504),
        starts_at: "2026-10-10T08:00:00Z",
        ends_at: "2026-10-10T09:00:00Z",
        state: "cancelled",
      },
      roster: [entry(12, "Синтетический спортсмен З")],
    },
  ];
}
export const knownAthletes = (): Schema["AthleteSummary"][] =>
  [20, 21, 22].map((i) => ({
    athlete_id: uuid(401 + i),
    person_id: uuid(301 + i),
    display_name: `Синтетический участник визита ${i - 19}`,
    participation: "regular",
    archived: false,
    version: 1,
  }));

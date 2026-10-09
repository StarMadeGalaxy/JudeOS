import type { Person, Athlete, Household } from "./model";
export const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const tenantId = uuid(101);
export const fixtureNow = Date.parse("2026-10-09T12:00:00Z");
export function fixtures(): {
  people: Person[];
  athletes: Athlete[];
  households: Household[];
} {
  const people: Person[] = [
    "Алексей Тестовый",
    "Алексей Тестовый",
    "Вера Примерная",
    "Михаил Условный",
    "Нина Макетная",
    "Олег Учебный",
    "Анна Демонстрационная",
    "Ирина Синтетическая",
    "Денис Примерный",
    "Мария Учебная",
    "Павел Макетный",
    "Лидия Тестовая",
  ].map((display_name, i) => ({
    person_id: uuid(301 + i),
    tenant_id: tenantId,
    display_name,
    phone: null,
    archived: false,
    version: 1,
  }));
  people[11].archived = true;
  // Deliberately non-routable synthetic number on an expired representative;
  // it must never become a fallback for the selected representative without a phone.
  people[7].phone = "+375000000029";
  const athletes: Athlete[] = people.slice(0, 4).map((person, i) => ({
    athlete_id: uuid(401 + i),
    person,
    participation: i === 3 ? "guest" : "regular",
    archived: false,
    version: 1,
    guardian_links: [],
    primary_guardian_link_id: null,
    primary_contact: null,
    admission: null,
  }));
  athletes[0].guardian_links = [
    {
      guardian_link_id: uuid(701),
      athlete_id: uuid(401),
      representative_person_id: uuid(307),
      representative_display_name: people[6].display_name,
      status: "verified",
      basis_kind: "Синтетическая личная проверка",
      verified_by_account_id: uuid(201),
      valid_from: "2026-01-01T00:00:00Z",
      valid_until: null,
      version: 1,
    },
    {
      guardian_link_id: uuid(702),
      athlete_id: uuid(401),
      representative_person_id: uuid(308),
      representative_display_name: people[7].display_name,
      status: "verified",
      basis_kind: "Синтетическая проверка",
      verified_by_account_id: uuid(201),
      valid_from: "2020-01-01T00:00:00Z",
      valid_until: "2021-01-01T00:00:00Z",
      version: 1,
    },
  ];
  athletes[0].primary_guardian_link_id = uuid(701);
  athletes[0].primary_contact = {
    display_name: people[6].display_name,
    phone: null,
  };
  const households: Household[] = [
    {
      household_id: uuid(501),
      name: "Семья «Учебный пример»",
      version: 1,
      members: [0, 1, 6].map((i, j) => ({
        household_member_id: uuid(801 + j),
        person_id: people[i].person_id,
        display_name: people[i].display_name,
        valid_from: "2026-01-01T00:00:00Z",
        valid_until: null,
      })),
    },
  ];
  return structuredClone({ people, athletes, households });
}

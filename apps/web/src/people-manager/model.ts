import type { components } from "./contract/wire";
export type Schema = components["schemas"];
export type Person = Schema["PersonProfile"];
export type Athlete = Schema["AthleteProfile"];
export type Household = Schema["HouseholdProfile"];
export type Guardian = Schema["GuardianLink"];
export type Kind = "people" | "athletes" | "households";
export type State = "active" | "archived" | "all";
export type Pages = {
  people: Schema["PersonPage"];
  athletes: Schema["AthletePage"];
  households: Schema["HouseholdPage"];
};
export type Profiles = {
  people: Person;
  athletes: Athlete;
  households: Household;
};
export type Commands = {
  createPerson: Schema["CreatePersonRequest"];
  updatePerson: Schema["UpdatePersonRequest"];
  archivePerson: Schema["VersionedRegistryCommand"];
  createAthlete: Schema["CreateAthleteRequest"];
  updateAthlete: Schema["UpdateAthleteRequest"];
  archiveAthlete: Schema["VersionedRegistryCommand"];
  verifyGuardianLink: Schema["VerifyGuardianLinkRequest"];
  setPrimaryContact: Schema["SetPrimaryContactRequest"];
  revokeGuardianLink: Schema["VersionedRegistryCommand"];
  createHousehold: Schema["CreateHouseholdRequest"];
  updateHousehold: Schema["UpdateHouseholdRequest"];
  addHouseholdMember: Schema["AddHouseholdMemberRequest"];
  endHouseholdMember: Schema["EndHouseholdMemberRequest"];
};
export type Command = {
  [O in keyof Commands]: { operation: O; target: string; body: Commands[O] };
}[keyof Commands];
export type Result = Person | Athlete | Household | Guardian;
export type Query = { q: string; state: State; cursor?: string; limit: number };
export interface RegistryAdapter {
  readonly mode: "synthetic" | "live";
  list<K extends Kind>(kind: K, query: Query): Promise<Pages[K]>;
  get<K extends Kind>(kind: K, id: string): Promise<Profiles[K]>;
  execute(command: Command): Promise<{ value: Result; replayed: boolean }>;
}
export class RegistryError extends Error {
  constructor(
    public status: number,
    public code: string,
    public currentVersion: number | null = null,
  ) {
    super(code);
  }
}
export const activePeriod = (from: string, until: string | null, now: number) =>
  Date.parse(from) <= now && (until === null || now < Date.parse(until));
export const activeGuardian = (link: Guardian, now: number) =>
  link.status === "verified" &&
  activePeriod(link.valid_from, link.valid_until, now);
export const idOf = (value: Result) =>
  "athlete_id" in value && "person" in value
    ? value.athlete_id
    : "person_id" in value
      ? value.person_id
      : "household_id" in value
        ? value.household_id
        : value.guardian_link_id;
// Input dates are explicitly Europe/Minsk (UTC+03), rather than the device timezone.
export const toWireDate = (value: string) =>
  new Date(`${value}:00+03:00`).toISOString();
export const toInputDate = (value: string) =>
  new Date(Date.parse(value) + 3 * 3600000).toISOString().slice(0, 16);
export const displayDate = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Minsk",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

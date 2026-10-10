import type { components } from "./contract/wire";

export type Schema = components["schemas"];
export type Journal = Schema["SessionJournal"];
export type TrainingSession = Schema["TrainingSession"];
export type Entry = Schema["RosterEntry"];
export type Attendance = Schema["Attendance"];
export type Mark = Schema["AttendanceStatus"];
export type DemoRole = "coach" | "manager" | "administrator";
export type Command =
  | {
      operation: "setAttendance";
      sessionId: string;
      athleteId: string;
      body: Schema["SetAttendanceRequest"];
    }
  | {
      operation: "closeSession";
      sessionId: string;
      body: Schema["CloseSessionRequest"];
    }
  | {
      operation: "createSessionGuest";
      sessionId: string;
      body: Schema["CreateSessionGuestRequest"];
    }
  | {
      operation: "addKnownRosterAthlete";
      sessionId: string;
      body: Schema["AddKnownRosterRequest"];
    }
  | {
      operation: "excludeRosterAthlete";
      sessionId: string;
      athleteId: string;
      body: Schema["ExcludeRosterRequest"];
    };
export type Result =
  | Schema["AttendanceSaved"]
  | Schema["CloseSessionResult"]
  | Schema["RosterCommandResult"];
export type Failure =
  | Schema["Error"]
  | Schema["AttendanceConflict"]
  | Schema["S1CommandConflict"];

// UI adapter methods are wrappers over the extracted wire, not additional HTTP DTOs.
export interface JournalAdapter {
  readonly mode: "synthetic" | "live";
  readonly canManage: boolean;
  list(date: string, cursor?: string): Promise<Schema["SessionPage"]>;
  get(sessionId: string): Promise<Journal>;
  known(q: string, cursor?: string): Promise<Schema["AthletePage"]>;
  execute(command: Command): Promise<{ value: Result; replayed: boolean }>;
}
export class JournalError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Failure,
  ) {
    super(body.code);
  }
}
export const marks: Record<Mark, string> = {
  present: "Был",
  absent: "Не был",
  sick: "Болел",
  unmarked: "Не отмечен",
};
export const markName = (status: Attendance["status"]) =>
  status === "unmarked" ? "Не отмечен" : marks[status];
export const sessionNames: Record<TrainingSession["state"], string> = {
  planned: "Запланировано",
  in_progress: "Идёт занятие",
  closed: "Закрыто",
  cancelled: "Отменено",
};
export const roleNames: Record<DemoRole, string> = {
  coach: "Тренер",
  manager: "Менеджер",
  administrator: "Администратор",
};
export const dateInClub = (value: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Minsk",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
export const timeInClub = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Minsk",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
export const displayDate = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Minsk",
    dateStyle: "long",
  }).format(new Date(`${value}T12:00:00Z`));
export const isUnknown = (error: unknown) =>
  !(error instanceof JournalError) || error.status === 0 || error.status >= 500;

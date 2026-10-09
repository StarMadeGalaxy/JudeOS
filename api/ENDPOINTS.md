# Реестр HTTP API

Принятый минимум #26 интегрирован PR [#102](https://github.com/StarMadeGalaxy/JudeOS/pull/102); реестр и явные сети реализуются #27. Journal/attendance операции остаются planned и не появляются в runtime Swagger. Источник схем — [OpenAPI](openapi/openapi.yaml); права/повторы/ограничения — [S1-CONTRACT](S1-CONTRACT.md) и [ADR0013](../planning/adr/0013-network-and-registry.md).

| Method | Path | operationId | Модуль | Аудитория | Авторизация/scope | Статус |
|---|---|---|---|---|---|---|
| GET | `/api/v1/access/csrf` | `getCsrfToken` | access | REST сотрудника | Public | реализован #21 |
| POST | `/api/v1/access/login` | `loginStaff` | access | REST сотрудника | Public | реализован #21 |
| GET | `/api/v1/access/session` | `getAccessSession` | access | REST сотрудника | Session; текущие права/scope, CSRF + Origin для команд | реализован #21 |
| POST | `/api/v1/access/logout` | `logoutStaff` | access | REST сотрудника | Session; текущие права/scope, CSRF + Origin для команд | реализован #21 |
| GET | `/api/v1/tenants/{tenant_id}/sessions` | `listAssignedSessions` | training | REST сотрудника | Session; текущие права/scope, CSRF + Origin для команд | запланирован #16 |
| GET | `/api/v1/tenants/{tenant_id}/sessions/{session_id}` | `getSessionJournal` | training | REST сотрудника | Session; текущие права/scope, CSRF + Origin для команд | запланирован #16 |
| PUT | `/api/v1/tenants/{tenant_id}/sessions/{session_id}/attendance/{athlete_id}` | `setAttendance` | attendance | REST сотрудника | Session; текущие права/scope, CSRF + Origin для команд | запланирован #16 |
| GET | `/healthz` | `getHealth` | operations | REST сотрудника | Public | реализован #19 |
| GET | `/readyz` | `getReadiness` | operations | REST сотрудника | Public | реализован #19 |
| GET | `/openapi.json` | `getRuntimeOpenAPI` | operations | REST сотрудника | Public | реализован #19 |
| GET | `/docs` | `getSwaggerUI` | operations | REST сотрудника | Public | реализован #19 |
| POST | `/api/v1/access/redeem` | `redeemAccessLink` | access | REST сотрудника | Public | реализован #21 |
| GET | `/api/v1/tenants/{tenant_id}/staff` | `listStaff` | access | REST сотрудника | Session; текущие права/scope, CSRF + Origin для команд | реализован #21 |
| POST | `/api/v1/tenants/{tenant_id}/staff/invitations` | `inviteStaff` | access | REST сотрудника | Session; текущие права/scope, CSRF + Origin для команд | реализован #21 |
| POST | `/api/v1/tenants/{tenant_id}/staff/{membership_id}/reset` | `issueStaffReset` | access | REST сотрудника | Session; текущие права/scope, CSRF + Origin для команд | реализован #21 |
| PUT | `/api/v1/tenants/{tenant_id}/staff/{membership_id}` | `changeStaffAccess` | access | REST сотрудника | Session; текущие права/scope, CSRF + Origin для команд | реализован #21 |
| POST | `/api/v1/tenants/{tenant_id}/people` | `createPerson` | people | REST сотрудника | Administrator/manager клуба, явный owner его сети или platform; coach запрещён | реализован #27 |
| GET | `/api/v1/tenants/{tenant_id}/people` | `listPersons` | people | REST сотрудника | Administrator/manager клуба, явный owner его сети или platform; coach запрещён | реализован #27 |
| POST | `/api/v1/tenants/{tenant_id}/athletes` | `createAthlete` | people | REST сотрудника | Administrator/manager клуба, явный owner его сети или platform; coach запрещён | реализован #27 |
| GET | `/api/v1/tenants/{tenant_id}/athletes` | `listAthletes` | people | REST сотрудника | Administrator/manager клуба, явный owner его сети или platform; coach запрещён | реализован #27 |
| GET | `/api/v1/tenants/{tenant_id}/athletes/{athlete_id}` | `getAthleteProfile` | people | REST сотрудника | Administrator/manager клуба, явный owner его сети или platform; coach запрещён | реализован #27 |
| PUT | `/api/v1/tenants/{tenant_id}/athletes/{athlete_id}` | `updateAthlete` | people | REST сотрудника | Administrator/manager клуба, явный owner его сети или platform; coach запрещён | реализован #27 |
| POST | `/api/v1/tenants/{tenant_id}/athletes/{athlete_id}/guardian-links` | `verifyGuardianLink` | people | REST сотрудника | Administrator/manager клуба, явный owner его сети или platform; coach запрещён | реализован #27 |
| PUT | `/api/v1/tenants/{tenant_id}/athletes/{athlete_id}/primary-contact` | `setPrimaryContact` | people | REST сотрудника | Administrator/manager клуба, явный owner его сети или platform; coach запрещён | реализован #27 |
| POST | `/api/v1/tenants/{tenant_id}/sessions/{session_id}/close` | `closeSession` | training | REST сотрудника | Session; текущие права/scope, CSRF + Origin для команд | запланирован #26 |
| POST | `/api/v1/tenants/{tenant_id}/sessions/{session_id}/roster` | `addKnownRosterAthlete` | training | REST сотрудника | Session; текущие права/scope, CSRF + Origin для команд | запланирован #26 |
| POST | `/api/v1/tenants/{tenant_id}/sessions/{session_id}/guests` | `createSessionGuest` | training | REST сотрудника | Session; текущие права/scope, CSRF + Origin для команд | запланирован #26 |
| POST | `/api/v1/tenants/{tenant_id}/sessions/{session_id}/roster/{athlete_id}/exclude` | `excludeRosterAthlete` | training | REST сотрудника | Session; текущие права/scope, CSRF + Origin для команд | запланирован #26 |
| GET | `/api/v1/tenants/{tenant_id}/households` | `listHouseholds` | people | REST сотрудника | Administrator/manager клуба, явный owner его сети или platform; coach запрещён | реализован #27 |
| POST | `/api/v1/tenants/{tenant_id}/households` | `createHousehold` | people | REST сотрудника | Administrator/manager клуба, явный owner его сети или platform; coach запрещён | реализован #27 |
| GET | `/api/v1/tenants/{tenant_id}/people/{person_id}` | `getPersonProfile` | people | REST сотрудника | Administrator/manager клуба, явный owner его сети или platform; coach запрещён | реализован #27 |
| PUT | `/api/v1/tenants/{tenant_id}/people/{person_id}` | `updatePerson` | people | REST сотрудника | Administrator/manager клуба, явный owner его сети или platform; coach запрещён | реализован #27 |
| POST | `/api/v1/tenants/{tenant_id}/people/{person_id}/archive` | `archivePerson` | people | REST сотрудника | Administrator/manager клуба, явный owner его сети или platform; coach запрещён | реализован #27 |
| POST | `/api/v1/tenants/{tenant_id}/athletes/{athlete_id}/archive` | `archiveAthlete` | people | REST сотрудника | Administrator/manager клуба, явный owner его сети или platform; coach запрещён | реализован #27 |
| POST | `/api/v1/tenants/{tenant_id}/athletes/{athlete_id}/guardian-links/{guardian_link_id}/revoke` | `revokeGuardianLink` | people | REST сотрудника | Administrator/manager клуба, явный owner его сети или platform; coach запрещён | реализован #27 |
| GET | `/api/v1/tenants/{tenant_id}/households/{household_id}` | `getHouseholdProfile` | people | REST сотрудника | Administrator/manager клуба, явный owner его сети или platform; coach запрещён | реализован #27 |
| PUT | `/api/v1/tenants/{tenant_id}/households/{household_id}` | `updateHousehold` | people | REST сотрудника | Administrator/manager клуба, явный owner его сети или platform; coach запрещён | реализован #27 |
| POST | `/api/v1/tenants/{tenant_id}/households/{household_id}/members` | `addHouseholdMember` | people | REST сотрудника | Administrator/manager клуба, явный owner его сети или platform; coach запрещён | реализован #27 |
| POST | `/api/v1/tenants/{tenant_id}/households/{household_id}/members/{household_member_id}/end` | `endHouseholdMember` | people | REST сотрудника | Administrator/manager клуба, явный owner его сети или platform; coach запрещён | реализован #27 |
| GET | `/api/v1/networks` | `listNetworks` | networks | REST сотрудника | Явные owner/platform; manager только coach своего клуба | реализован #27 |
| GET | `/api/v1/networks/{network_id}` | `getNetworkProfile` | networks | REST сотрудника | Явные owner/platform; manager только coach своего клуба | реализован #27 |
| PUT | `/api/v1/networks/{network_id}` | `renameNetwork` | networks | REST сотрудника | Явные owner/platform; manager только coach своего клуба | реализован #27 |
| POST | `/api/v1/platform/networks` | `createPlatformNetwork` | networks | REST сотрудника | Явные owner/platform; manager только coach своего клуба | реализован #27 |
| POST | `/api/v1/tenants/{tenant_id}/network` | `createNetworkFromClub` | networks | REST сотрудника | Явные owner/platform; manager только coach своего клуба | реализован #27 |
| POST | `/api/v1/networks/{network_id}/clubs` | `createNetworkClub` | networks | REST сотрудника | Явные owner/platform; manager только coach своего клуба | реализован #27 |
| PUT | `/api/v1/networks/{network_id}/clubs/{tenant_id}` | `updateNetworkClub` | networks | REST сотрудника | Явные owner/platform; manager только coach своего клуба | реализован #27 |
| PUT | `/api/v1/networks/{network_id}/owners` | `changeNetworkOwner` | networks | REST сотрудника | Явные owner/platform; manager только coach своего клуба | реализован #27 |
| PUT | `/api/v1/platform/administrators` | `changePlatformAdministrator` | networks | REST сотрудника | Явные owner/platform; manager только coach своего клуба | реализован #27 |
| POST | `/api/v1/access/accept-invitation` | `acceptClubInvitation` | networks | REST сотрудника | Явные owner/platform; manager только coach своего клуба | реализован #27 |
| POST | `/api/v1/tenants/{tenant_id}/staff/assignments` | `assignStaffToClub` | networks | REST сотрудника | Явные owner/platform; manager только coach своего клуба | реализован #27 |
| GET | `/api/v1/tenants/{tenant_id}/coaches` | `listClubCoaches` | networks | REST сотрудника | Явные owner/platform; manager только coach своего клуба | реализован #27 |
| POST | `/api/v1/tenants/{tenant_id}/coaches/{membership_id}/revoke` | `revokeClubCoach` | networks | REST сотрудника | Явные owner/platform; manager только coach своего клуба | реализован #27 |

Статические исключения chi.Walk — [static-routes.json](static-routes.json). HEAD/OPTIONS/404/405/слеши — [общая HTTP политика](README.md#http-политика-основы-s0). Runtime требует schema 8 и показывает только implemented операции. Произвольные клубные administrator не получают сеть: принадлежность и organizational grant явные. Production/реальный пилот/restore не разрешены.

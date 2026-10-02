import type { components } from "@/lib/api-client/generated/schema";

type Schemas = components["schemas"];

export type AdminCompany = Schemas["AdminCompany"];
export type AdminCompanyList = Schemas["AdminCompanyList"];
export type CompanyResearchState = Schemas["CompanyResearchState"];
export type CreateCompanyRequest = Schemas["CreateCompanyRequest"];
export type UpdateCompanyRequest = Schemas["UpdateCompanyRequest"];
export type SeedResult = Schemas["SeedResult"];
export type ResearchMode = Schemas["ResearchMode"];
export type ResearchLevel = Schemas["ResearchLevel"];
export type ResearchRunStatus = Schemas["ResearchRunStatus"];
export type ResearchItemStatus = Schemas["ResearchItemStatus"];
export type ResearchRun = Schemas["ResearchRun"];
export type ResearchRunList = Schemas["ResearchRunList"];
export type ResearchRunDetail = Schemas["ResearchRunDetail"];
export type ResearchItem = Schemas["ResearchItem"];
export type ResearchEvent = Schemas["ResearchEvent"];
export type ResearchEventPage = Schemas["ResearchEventPage"];
export type ResearchSpan = Schemas["ResearchSpan"];
export type ResearchSpanList = Schemas["ResearchSpanList"];
export type ResearchSpanDetail = Schemas["ResearchSpanDetail"];
export type ResearchSpanDetailResponse = Schemas["ResearchSpanDetailResponse"];
export type StartResearchRunRequest = Schemas["StartResearchRunRequest"];
export type ResearchBudgetUpdate = Schemas["ResearchBudgetUpdate"];
export type RunAction = "pause" | "resume" | "stop";

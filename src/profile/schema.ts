import type { EmploymentType, WorkArrangement } from "../job/schema.js";

export type CandidateContact = {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  links?: string[];
};

export type CandidateExperience = {
  company?: string;
  title: string;
  startDate?: string;
  endDate?: string;
  highlights: string[];
};

export type CandidateEducation = {
  school?: string;
  degree?: string;
  field?: string;
  graduationDate?: string;
};

export type CandidateLanguage = {
  language: string;
  level?: string;
};

export type CandidatePreferences = {
  employmentTypes?: EmploymentType[];
  workArrangements?: WorkArrangement[];
  locations?: string[];
  minimumSalary?: string;
  schedule?: string;
  notes?: string;
};

export type CandidateProfile = {
  contact?: CandidateContact;
  headline?: string;
  summary?: string;
  experience: CandidateExperience[];
  skills: string[];
  education: CandidateEducation[];
  languages: CandidateLanguage[];
  certifications?: string[];
  preferences?: CandidatePreferences;
};

const employmentTypes = new Set<EmploymentType>(["full-time", "part-time", "contract", "internship", "temporary"]);
const workArrangements = new Set<WorkArrangement>(["onsite", "hybrid", "remote"]);

export function parseCandidateProfile(value: unknown): CandidateProfile {
  if (!isRecord(value)) throw new Error("Candidate profile must be a JSON object");

  return {
    ...optionalContact(value.contact),
    ...optionalTextFields(value, ["headline", "summary"] as const),
    experience: parseExperience(value.experience),
    skills: parseTextList(value.skills, "skills"),
    education: parseEducation(value.education),
    languages: parseLanguages(value.languages),
    ...optionalTextList(value.certifications, "certifications"),
    ...optionalPreferences(value.preferences),
  };
}

function parseExperience(value: unknown): CandidateExperience[] {
  if (!Array.isArray(value)) throw new Error("experience must be an array");

  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`experience[${index}] must be an object`);
    if (!isNonEmptyString(entry.title)) throw new Error(`experience[${index}].title must be a non-empty string`);

    return {
      ...optionalTextFields(entry, ["company", "startDate", "endDate"] as const),
      title: entry.title.trim(),
      highlights: parseTextList(entry.highlights, `experience[${index}].highlights`),
    };
  });
}

function parseEducation(value: unknown): CandidateEducation[] {
  if (!Array.isArray(value)) throw new Error("education must be an array");

  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`education[${index}] must be an object`);
    const parsed = optionalTextFields(entry, ["school", "degree", "field", "graduationDate"] as const);
    if (Object.keys(parsed).length === 0) throw new Error(`education[${index}] must include a non-empty field`);
    return parsed;
  });
}

function parseLanguages(value: unknown): CandidateLanguage[] {
  if (!Array.isArray(value)) throw new Error("languages must be an array");

  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`languages[${index}] must be an object`);
    if (!isNonEmptyString(entry.language)) throw new Error(`languages[${index}].language must be a non-empty string`);

    return {
      language: entry.language.trim(),
      ...optionalTextFields(entry, ["level"] as const),
    };
  });
}

function optionalContact(value: unknown): Partial<Pick<CandidateProfile, "contact">> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("contact must be an object");

  const contact = {
    ...optionalTextFields(value, ["name", "email", "phone", "location"] as const),
    ...optionalTextList(value.links, "contact.links"),
  };
  if (Object.keys(contact).length === 0) throw new Error("contact must include a non-empty field");
  return { contact };
}

function optionalPreferences(value: unknown): Partial<Pick<CandidateProfile, "preferences">> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("preferences must be an object");

  const preferences = {
    ...optionalEnumList(value.employmentTypes, employmentTypes, "preferences.employmentTypes"),
    ...optionalEnumList(value.workArrangements, workArrangements, "preferences.workArrangements"),
    ...optionalTextList(value.locations, "preferences.locations"),
    ...optionalTextFields(value, ["minimumSalary", "schedule", "notes"] as const),
  };
  if (Object.keys(preferences).length === 0) throw new Error("preferences must include a non-empty field");
  return { preferences };
}

function parseTextList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  if (!value.every(isNonEmptyString)) throw new Error(`${field} must contain non-empty strings`);
  return value.map((item) => item.trim());
}

function optionalTextList(value: unknown, field: string): Partial<Record<string, string[]>> {
  if (value === undefined) return {};
  return { [field.split(".").at(-1)!]: parseTextList(value, field) };
}

function optionalEnumList<T extends string>(value: unknown, allowed: Set<T>, field: string): Partial<Record<string, T[]>> {
  if (value === undefined) return {};
  if (!Array.isArray(value) || !value.every((item) => allowed.has(item as T))) throw new Error(`${field} is invalid`);
  return { [field.split(".").at(-1)!]: [...value] as T[] };
}

function optionalTextFields<T extends readonly string[]>(
  value: Record<string, unknown>,
  fields: T,
): Partial<Record<T[number], string>> {
  return Object.fromEntries(
    fields.flatMap((field) => {
      const candidate = value[field];
      if (candidate === undefined) return [];
      if (!isNonEmptyString(candidate)) throw new Error(`${field} must be a non-empty string`);
      return [[field, candidate.trim()]];
    }),
  ) as Partial<Record<T[number], string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

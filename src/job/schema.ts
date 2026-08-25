export type RequirementCategory =
  | "skill"
  | "experience"
  | "education"
  | "language"
  | "other";

export type RequirementPriority = "required" | "preferred" | "unknown";

export type JobRequirement = {
  category: RequirementCategory;
  statement: string;
  priority?: RequirementPriority;
  minimumYears?: number;
  degree?: string;
  languageLevel?: string;
};

export type EmploymentType = "full-time" | "part-time" | "contract" | "internship" | "temporary";
export type WorkArrangement = "onsite" | "hybrid" | "remote";
export type JobLocation = {
  raw: string;
  city?: string;
  address?: string;
};

export type EmploymentDetails = {
  type?: EmploymentType;
  workArrangement?: WorkArrangement;
  locations?: JobLocation[];
  schedule?: string;
  duration?: string;
  startDate?: string;
  probation?: string;
  onsiteExpectation?: string;
};

export type Compensation = {
  salaryStatus: "stated" | "not-stated";
  salary?: string;
  benefits?: string[];
};

export type ApplicationDetails = {
  deadline?: string;
  hiringProcess?: string[];
};

export type WorkConditions = {
  overtime?: string;
  onCall?: string;
  travel?: string;
};

export type Opportunities = {
  conversionToPermanent?: string;
  training?: string[];
  careerGrowth?: string[];
  relocation?: string[];
};

export type JobAnalysis = {
  title?: string;
  company?: string;
  seniority?: string;
  requirements: JobRequirement[];
  responsibilities: string[];
  employment?: EmploymentDetails;
  compensation: Compensation;
  application?: ApplicationDetails;
  workConditions?: WorkConditions;
  opportunities?: Opportunities;
};

const requirementCategories = new Set<RequirementCategory>([
  "skill",
  "experience",
  "education",
  "language",
  "other",
]);
const requirementPriorities = new Set<RequirementPriority>([
  "required",
  "preferred",
  "unknown",
]);
const employmentTypes = new Set<EmploymentType>(["full-time", "part-time", "contract", "internship", "temporary"]);
const workArrangements = new Set<WorkArrangement>(["onsite", "hybrid", "remote"]);
const salaryStatuses = new Set<Compensation["salaryStatus"]>(["stated", "not-stated"]);

export function parseJobAnalysis(value: unknown): JobAnalysis {
  if (!isRecord(value)) throw new Error("Job analysis must be a JSON object");

  return {
    ...optionalTextFields(value, ["title", "company", "seniority"] as const),
    requirements: parseRequirements(value.requirements),
    responsibilities: parseTextList(value.responsibilities, "responsibilities"),
    ...parseEmployment(value.employment),
    compensation: parseCompensation(value.compensation),
    ...parseApplication(value.application),
    ...parseWorkConditions(value.workConditions),
    ...parseOpportunities(value.opportunities),
  };
}

function parseRequirements(value: unknown): JobRequirement[] {
  if (!Array.isArray(value)) throw new Error("requirements must be an array");

  return value.map((requirement, index) => {
    if (!isRecord(requirement)) throw new Error(`requirements[${index}] must be an object`);
    if (!requirementCategories.has(requirement.category as RequirementCategory)) {
      throw new Error(`requirements[${index}].category is invalid`);
    }
    if (!isNonEmptyString(requirement.statement)) {
      throw new Error(`requirements[${index}].statement must be a non-empty string`);
    }
    if (requirement.priority !== undefined && !requirementPriorities.has(requirement.priority as RequirementPriority)) {
      throw new Error(`requirements[${index}].priority is invalid`);
    }

    let minimumYears: number | undefined;
    if (requirement.minimumYears !== undefined) {
      if (typeof requirement.minimumYears !== "number" || !Number.isInteger(requirement.minimumYears) || requirement.minimumYears < 0) {
        throw new Error(`requirements[${index}].minimumYears must be a non-negative integer`);
      }
      minimumYears = requirement.minimumYears;
    }

    return {
      category: requirement.category as RequirementCategory,
      statement: requirement.statement.trim(),
      ...(requirement.priority === undefined ? {} : { priority: requirement.priority as RequirementPriority }),
      ...optionalTextFields(requirement, ["degree", "languageLevel"] as const),
      ...(minimumYears === undefined ? {} : { minimumYears }),
    };
  });
}

function parseEmployment(value: unknown): Partial<Pick<JobAnalysis, "employment">> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("employment must be an object");

  return {
    employment: {
      ...optionalEnum(value.type, employmentTypes, "employment.type"),
      ...optionalEnum(value.workArrangement, workArrangements, "employment.workArrangement"),
      ...optionalLocations(value.locations, "employment.locations"),
      ...optionalTextFields(value, ["schedule", "duration", "startDate", "probation", "onsiteExpectation"] as const),
    },
  };
}

function parseCompensation(value: unknown): Compensation {
  if (!isRecord(value)) throw new Error("compensation must be an object");

  const salaryStatus = value.salaryStatus;
  if (!salaryStatuses.has(salaryStatus as Compensation["salaryStatus"])) {
    throw new Error("compensation.salaryStatus is invalid");
  }
  const validatedSalaryStatus = salaryStatus as Compensation["salaryStatus"];
  const salary = optionalTextFields(value, ["salary"] as const);
  if (validatedSalaryStatus === "stated" && salary.salary === undefined) {
    throw new Error("compensation.salary is required when salaryStatus is stated");
  }
  if (validatedSalaryStatus === "not-stated" && salary.salary !== undefined) {
    throw new Error("compensation.salary must be omitted when salaryStatus is not-stated");
  }

  return {
    salaryStatus: validatedSalaryStatus,
    ...salary,
    ...optionalTextList(value.benefits, "compensation.benefits"),
  };
}

function parseApplication(value: unknown): Partial<Pick<JobAnalysis, "application">> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("application must be an object");

  return {
    application: {
      ...optionalTextFields(value, ["deadline"] as const),
      ...optionalTextList(value.hiringProcess, "application.hiringProcess"),
    },
  };
}

function parseWorkConditions(value: unknown): Partial<Pick<JobAnalysis, "workConditions">> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("workConditions must be an object");

  return { workConditions: optionalTextFields(value, ["overtime", "onCall", "travel"] as const) };
}

function parseOpportunities(value: unknown): Partial<Pick<JobAnalysis, "opportunities">> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("opportunities must be an object");

  return {
    opportunities: {
      ...optionalTextFields(value, ["conversionToPermanent"] as const),
      ...optionalTextList(value.training, "opportunities.training"),
      ...optionalTextList(value.careerGrowth, "opportunities.careerGrowth"),
      ...optionalTextList(value.relocation, "opportunities.relocation"),
    },
  };
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

function parseLocations(value: unknown, field: string): JobLocation[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);

  return value.map((location, index) => {
    if (!isRecord(location)) throw new Error(`${field}[${index}] must be an object`);
    const raw = location.raw;
    if (!isNonEmptyString(raw)) throw new Error(`${field}[${index}].raw must be a non-empty string`);

    return {
      raw: raw.trim(),
      ...optionalTextFields(location, ["city", "address"] as const),
    };
  });
}

function optionalLocations(value: unknown, field: string): Partial<Record<string, JobLocation[]>> {
  if (value === undefined) return {};
  return { [field.split(".").at(-1)!]: parseLocations(value, field) };
}

function optionalEnum<T extends string>(value: unknown, allowedValues: Set<T>, field: string): Partial<Record<string, T>> {
  if (value === undefined) return {};
  if (!allowedValues.has(value as T)) throw new Error(`${field} is invalid`);
  return { [field.split(".").at(-1)!]: value as T };
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

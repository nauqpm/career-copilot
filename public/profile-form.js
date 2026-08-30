const contactFields = ["name", "email", "phone", "location", "links"];
const sectionFields = {
  identity: [...contactFields, "headline", "summary"],
  experience: ["experience", "education"],
  skills: ["skills", "languages", "certifications"],
  preferences: ["employmentTypes", "workArrangements", "locations", "minimumSalary", "schedule", "notes"],
};
const listFields = ["links", "skills", "certifications", "employmentTypes", "workArrangements", "locations"];
const recordFields = {
  experience: ["title", "company", "startDate", "endDate"],
  education: ["school", "degree", "field", "graduationDate"],
  languages: ["language", "level"],
};
const recordLabels = { experience: "Vai trò", education: "Học vấn", languages: "Ngôn ngữ" };

export function profileToSectionDraft(profile, section) {
  const fields = fieldsFor(section);
  const source = section === "identity" ? { ...profile, ...profile?.contact } : section === "preferences" ? profile?.preferences : profile;
  return Object.fromEntries(fields.map((field) => {
    const value = source?.[field];
    if (Object.hasOwn(recordFields, field)) return [field, (value ?? []).map((item) => {
      const cells = recordFields[field].map((key) => item[key] ?? "");
      return [...cells, ...(field === "experience" ? item.highlights.length ? item.highlights : [""] : [])].map(encodeCell).join(" | ");
    }).join("\n")];
    return [field, Array.isArray(value) ? value.map(encodeCell).join("\n") : value ?? ""];
  }));
}

export function mergeProfileSection(profile, section, draft) {
  const fields = fieldsFor(section);
  const current = structuredClone(profile ?? { experience: [], skills: [], education: [], languages: [] });
  if (section === "identity") {
    const contact = mergeFields(current.contact, draft, contactFields);
    return omitUndefined({ ...mergeFields(current, draft, ["headline", "summary"]), contact: Object.keys(contact).length ? contact : undefined });
  }
  if (section === "preferences") {
    const preferences = mergeFields(current.preferences, draft, fields);
    return omitUndefined({ ...current, preferences: Object.keys(preferences).length ? preferences : undefined });
  }
  return mergeFields(current, draft, fields);
}

export function parseDelimitedLines(value) {
  return lines(value).map(decodeCell);
}

function fieldsFor(section) {
  if (!Object.hasOwn(sectionFields, section)) throw new Error("Không nhận diện được nhóm hồ sơ.");
  return sectionFields[section];
}

function mergeFields(current = {}, draft, fields) {
  const updates = fields.filter((field) => Object.hasOwn(draft, field)).map((field) => {
    const value = parseField(field, draft[field]);
    return [field, Array.isArray(value) && !value.length && current[field] === undefined ? undefined : value];
  });
  return omitUndefined({ ...current, ...Object.fromEntries(updates) });
}

function parseField(field, value) {
  if (Array.isArray(value)) return structuredClone(value);
  if (typeof value !== "string") throw new Error("Nội dung hồ sơ phải là văn bản.");
  if (Object.hasOwn(recordFields, field)) return parseRecords(value, field);
  if (listFields.includes(field)) return parseDelimitedLines(value);
  return value.trim() || undefined;
}

function parseRecords(value, field) {
  return lines(value).map((line, index) => {
    // Split only unescaped pipes; decoding afterwards preserves literal backslashes.
    const tokens = line.match(/\\[\s\S]|\||[^\\|]+|\\/g) ?? [];
    const cells = tokens.reduce((parts, token) => token === "|" ? [...parts, ""] : [...parts.slice(0, -1), parts.at(-1) + token], [""]).map((cell) => decodeCell(cell.trim()));
    const keys = recordFields[field];
    const wrongCount = field === "experience" ? cells.length < 5 : cells.length !== keys.length;
    const missingRequired = field === "education" ? !cells.some(Boolean) : !cells[0];
    if (wrongCount || missingRequired) throw new Error(`${recordLabels[field]}: kiểm tra dòng ${index + 1} theo định dạng bên dưới trường.`);
    const entry = Object.fromEntries(keys.flatMap((key, cell) => cells[cell] ? [[key, cells[cell]]] : []));
    return field === "experience" ? { ...entry, highlights: cells.slice(4).filter(Boolean) } : entry;
  });
}

function lines(value) { return value.split(/\r\n|\r|\n/).map((line) => line.trim()).filter(Boolean); }
function encodeCell(value) { return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r/g, "\\r").replace(/\n/g, "\\n"); }
function decodeCell(value) { return value.replace(/\\([\\|nr])/g, (_, character) => ({ n: "\n", r: "\r", "\\": "\\", "|": "|" })[character]); }
function omitUndefined(value) { return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)); }

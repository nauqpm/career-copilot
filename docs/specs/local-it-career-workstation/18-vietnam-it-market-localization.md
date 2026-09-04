# 18 — Vietnam IT market localisation

> **Status:** Proposed for review
> **Related:** [product scope](01-product-scope.md), [system architecture](02-system-architecture.md), [artifact contracts](03-domain-model-and-artifact-contracts.md), [roadmap](19-roadmap-and-milestones.md)

## 1. Purpose

Career Copilot is initially optimised for IT and IT-adjacent job seekers in Ho Chi Minh City (HCMC) and Vietnam. Localisation means more than translating labels: the job intake, matching, document, submission, and analytics flows must preserve the market context that changes a candidate's decision.

This specification sets requirements for Vietnamese/English content, Vietnam job sources, HCMC location semantics, role framing, and compensation representation. It does not provide employment, tax, immigration, or legal advice.

## 2. Localisation principles

1. **Preserve before normalising.** Store the exact Vietnamese/English wording from a source before mapping it to a canonical value.
2. **Never infer employment facts.** If a JD omits salary basis, location, language expectation, probation, insurance, or work arrangement, record it as not stated or ask a question.
3. **Bilingual is not automatic translation.** A Vietnamese CV and an English CV are independent document revisions. An agent may draft a translation, but it remains a reviewable version and its claims remain grounded in the same evidence.
4. **Canonical values support filtering; raw values support truth.** The system can normalise `TP. HCM`, `HCM`, and `Ho Chi Minh City` for filtering while retaining the source text.
5. **Portal-specific behaviour stays isolated.** A connector for one source never assumes fields, rules, or submission behaviour of another source.
6. **HCMC is the launch market, not an exclusion.** The candidate may consider remote, relocation, or other Vietnam locations. Filters must say what they exclude.

## 3. Source landscape and connector posture

The target sources named by the product owner are TopCV, VietnamWorks, and LinkedIn. ITviec, CareerViet, Glints, company career pages, recruiter messages, and copied PDFs/emails are relevant future inputs. A source does not become an automatic integration merely because it is listed here.

| Source type | Initial local workflow | Future capability only after a connector spec | Never permitted |
| --- | --- | --- | --- |
| TopCV / VietnamWorks / ITviec / CareerViet / Glints | Candidate pastes/imports JD and source URL; browser opens original page | Browser-assisted field extraction, duplicate hints, candidate-confirmed handoff | Credential capture, CAPTCHA bypass, bulk scraping, invisible background polling |
| LinkedIn | Candidate preserves job URL and copied JD; the existing logged-in browser session is user-owned | Easy-Apply preparation/handoff where technically and contractually valid | Session-cookie export, automation intended to evade platform limits or protections |
| Company career site | Candidate pastes/imports job page or file | Per-site browser assist when a dedicated spec permits it | General crawler that treats arbitrary pages as safe forms |
| Recruiter email/message/referral | Candidate saves the text as a source record | Candidate-confirmed application target and response logging | Claiming an employer relationship based on an unsourced message |

Before implementation of any connector, verify the then-current source terms, official integration options, login/automation constraints, data fields, and rate limits. Record the review date and connector capability in a source-specific specification. The architecture's connector boundary is defined in [02](02-system-architecture.md#4-local-components-and-responsibilities).

## 4. Language requirements

### 4.1 Interface language

The dashboard must support Vietnamese as a first-class interface language. English is also supported for technical terms and candidate preference. Localised UI copy must be understandable to a Vietnamese professional without translating product facts into unsupported claims.

### 4.2 Source and analysis language

- A job source records its original language as `vi`, `en`, `mixed`, or `unknown`.
- The analysis keeps quotations/references in the original language.
- A translated summary, if shown, must be labelled as a derived translation and linked to the source analysis revision.
- Technical tokens such as framework names, cloud product names, standards, and code symbols must not be translated destructively.
- Matching works across Vietnamese and English phrasing but must show the original requirement and the interpretation used to match it.

### 4.3 Application documents

Document metadata MUST include a document language. The candidate chooses the language for each target; the system must not assume a Vietnamese company wants a Vietnamese CV or an international company wants an English CV.

When drafting or translating, agents must preserve names, dates, links, quantified achievements, certification names, and technology names exactly unless the candidate edits them. A reviewer flags translation drift as a grounding issue.

## 5. HCMC and Vietnam location contract

### 5.1 Source-preserving representation

Each job location has:

- `raw`: exact source wording, for example `Quận 1, TP.HCM`;
- `country`: `VN` only when stated or safely derived from an explicit Vietnam location;
- `city`: canonical `ho-chi-minh-city` only when source wording supports it;
- `district`: canonical identifier only when stated;
- `address`: optional source text, never required;
- `workArrangement`: separately derived `onsite`, `hybrid`, `remote`, or `not-stated`.

Examples:

| Source wording | Safe canonicalisation | Do not infer |
| --- | --- | --- |
| `TP.HCM`, `HCM`, `Hồ Chí Minh` | city `ho-chi-minh-city` | district, office address, hybrid policy |
| `Quận 7, TP.HCM` | city `ho-chi-minh-city`, district `district-7` | commute time, office building |
| `Remote in Vietnam` | country `VN`, arrangement `remote` | HCMC eligibility if a region restriction is absent |
| `Hybrid` with no city | arrangement `hybrid` | city or onsite days |
| `Làm việc tại văn phòng` | likely onsite only if the JD makes location clear; otherwise preserve wording and mark ambiguity | work schedule, district, relocation requirement |

### 5.2 Candidate preference and match rules

Candidate preferences distinguish a strict constraint from a preference. For example, `must be remote` is a potential blocker; `prefer District 1/3` is a ranked preference. The match explanation must show the exact comparison:

- stated job location and arrangement;
- candidate location/arrangement constraints;
- whether a result is a match, conflict, or unknown;
- why unknown data was not treated as a match.

The product may later calculate estimated commute information only with a separate explicit location/privacy design. It must not send a home address to a mapping provider in the default workflow.

## 6. Vietnam compensation contract

Compensation is a decision-critical fact but formats vary widely. Preserve source text and model uncertainty explicitly.

```json
{
  "raw": "20–30 triệu/tháng, gross",
  "currency": "VND",
  "period": "month",
  "minimum": 20000000,
  "maximum": 30000000,
  "basis": "gross",
  "status": "stated",
  "confidence": "high"
}
```

Allowed values:

- `currency`: ISO-style code such as `VND`, `USD`, or `unknown`;
- `period`: `month`, `year`, `day`, `hour`, `project`, `not-stated`, or `unknown`;
- `basis`: `gross`, `net`, `before-tax-unspecified`, `after-tax-unspecified`, `not-stated`, or `unknown`;
- `status`: `stated`, `negotiable`, `competitive`, `not-stated`, or `ambiguous`.

Examples that require care:

| Source phrase | Representation | Match rule |
| --- | --- | --- |
| `Thoả thuận` / `Negotiable` | `status: negotiable`; no invented range | Cannot satisfy a numeric minimum without candidate review |
| `Up to 2,000 USD` | Keep currency USD and upper limit; period only if stated | Do not convert to VND unless candidate explicitly requests a dated conversion source |
| `Lương tháng 13` | Benefit/compensation note | Do not add it into base monthly salary |
| `Gross` / `Net` | Preserve basis | Never compare gross to net as if identical |
| `Competitive` | `status: competitive` | Treat as unknown for salary-floor matching |

The tool may describe the difference between displayed gross/net labels, but it must not calculate take-home pay, tax liability, social insurance liability, or legal entitlement unless a later local legal/tax specification is approved and sourced.

## 7. IT role and technical-evidence localisation

The product focuses on technical roles but must avoid a rigid, universal skill taxonomy. Instead, it uses an extensible controlled vocabulary for filtering plus free-text evidence for truth.

### 7.1 Initial role tracks

The dashboard can offer candidate-selected tracks:

- frontend, backend, full-stack, mobile;
- DevOps, SRE, cloud, platform, security;
- data analyst, data engineer, ML/AI engineer, MLOps;
- manual QA, automation QA, SDET;
- business analyst, systems analyst, product analyst.

Tracks are navigation aids, not claims about a candidate. A source may be mapped to multiple tracks with confidence, and the raw title remains authoritative.

### 7.2 Evidence facets

Technical evidence may be tagged by facet without replacing the candidate's wording:

| Facet | Examples | Evidence requirement |
| --- | --- | --- |
| Language/runtime | Java, TypeScript, Python, .NET, Go | project/experience/credential reference |
| Framework/platform | React, NestJS, Spring, Django, Kubernetes | source-backed claim, not keyword-only CV text |
| Delivery/operations | CI/CD, Terraform, observability, incident response | operational/project evidence and scope |
| Data/AI | SQL, Spark, vector search, model deployment | task/project evidence and tools stated |
| Quality | test planning, Playwright, API testing, load testing | scope and outcomes when stated |
| Analysis/domain | BPMN, SQL, ERP, banking, e-commerce | explicit role/project source |

An agent may recognise synonym and bilingual forms (`kiểm thử tự động` / `automation testing`; `điện toán đám mây` / `cloud`) for matching, but it MUST display the mapping and never assert proficiency simply because a term appears once.

## 8. Vietnam-specific application flow requirements

- Support source URLs and source labels for portals, recruiter referrals, and company sites.
- Preserve required candidate-entered form answers separately from a CV/cover letter; questions often vary by source and may include salary expectation, availability, English ability, work location, or portfolio links.
- Present local conventions such as `CV tiếng Việt`, `CV tiếng Anh`, `mức lương mong muốn`, `thời gian có thể đi làm`, and `hình thức làm việc` in a way that retains candidate control.
- Require re-approval whenever an application form adds a material answer not included in the approved package manifest.
- Provide a manual browser handoff as a first-class successful outcome. Portal protections are normal constraints, not errors to bypass.
- Store a local, redacted receipt for each attempt and distinguish `submitted`, `failed`, `handoff-required`, and `submission-unknown` as specified in [03](03-domain-model-and-artifact-contracts.md#10-submission-receipt-and-outcome-event-contract).

## 9. Local analytics for this market

The analytics view may help candidates identify patterns in their own local history:

- role-track and source distribution across HCMC/Vietnam/remote opportunities;
- stated salary ranges, basis, and missing/negotiable salary frequency without pretending to be a market salary survey;
- response/interview counts by source, document language, role track, arrangement, and CV revision family;
- recurring technical requirements, evidence gaps, and explicit language requirements;
- elapsed time between application, response, interview, and outcome where events have been recorded.

Metrics must state their local sample and missing data. They must never be presented as representative of Vietnam's labour market without an explicitly sourced external data product.

## 10. Acceptance checks

An implementation satisfying this localisation specification demonstrates the following with fixtures:

1. A Vietnamese JD and an English JD preserve original text and render understandable analyses.
2. `TP.HCM`, `HCM`, and `Ho Chi Minh City` normalise consistently without losing source wording.
3. Remote, hybrid, onsite, and not-stated arrangements do not collapse into one filter value.
4. `gross`, `net`, `negotiable`, and `not-stated` salary cases do not become a fabricated numeric VND amount.
5. A bilingual document draft retains factual links and receives grounding review in either language.
6. A connector fixture requires human handoff for login/CAPTCHA/final portal confirmation rather than simulating a bypass.
7. Analytics label limited samples and exclude unrecorded outcomes from rate calculations.

Connector-level verification and evolving portal policies remain future, source-specific work in the [roadmap](19-roadmap-and-milestones.md#4-proposed-small-specification-sequence).

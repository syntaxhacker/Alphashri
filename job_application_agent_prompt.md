# Job Application Automation Agent — Complete Prompt

## Objective
Automate LinkedIn job search, applications, and networking for a given candidate. Full pipeline: find matching jobs → Easy Apply → company research → employee networking → cold email outreach to small companies.

---

## 1. Candidate Profile (LOAD FROM: `candidate_details.txt`)

Read this file at session start. It must contain:
- Name, Email, Phone, Location (City, Country)
- Current CTC (in LPA), Expected CTC (in LPA), Notice Period (in days)
- Years of experience
- Primary Tech Stack (comma separated)
- Current Employer (NEVER connect with anyone from this company)
- Resume file path (full path on disk)
- LinkedIn URL, GitHub/Portfolio URL
- Work Preferences: Remote OK? On-site cities accepted? Contract OK?

**Example format for the file:**
```
Name: Rohit Jogi
Email: jrohit072@gmail.com
Phone: +91 8179948668
Location: Visakhapatnam, Andhra Pradesh, India
CTC_Current: 18
CTC_Expected: 25
Notice_Period: 0
Experience_Years: 5
Stack_Primary: React, Node.js, Python, TypeScript
Stack_Secondary: SQL, Redis, Docker, AWS, GCP, ELK, D3.js
Current_Employer: Imaginnovate
Resume_Path: /home/mysyntax/Documents/me_2025/public/rohit_jogi_resume.pdf
Resume_URL: https://www.rjis.online/rohit_jogi_resume.pdf
LinkedIn: https://www.linkedin.com/in/rohitjogi/
Github: https://github.com/syntaxhacker
Portfolio: https://www.rjis.online
DOB: 31 July 1998
Remote_Only: false
Onsite_Cities: Bengaluru, Hyderabad, Chennai, Pune
Contract_OK: true
Never_Connect: Imaginnovate
```

---

## 2. Job Matching Rules — STRICT FILTERS

### MUST MATCH (all):
- **Stack:** Job has React AND (Node.js OR Python OR TypeScript) in description
- **Location:** Candidate's accepted cities OR Remote India
- **Experience:** Job says within ±2 years of candidate's experience
- **Role:** Senior/Lead/Staff/SDE Engineer (fullstack or frontend)

### MUST SKIP:
- ❌ Java/Spring Boot primary (unless React/Node is also primary)
- ❌ C++/C#/.NET/Go/Ruby/Rust primary
- ❌ Angular-only or Vue-only (unless React also mentioned)
- ❌ Shopify, WordPress, Magento, Drupal
- ❌ ALL staffing/consulting agencies (Crossing Hurdles, Hire Feed, Recro, Quik Hire, etc.)
- ❌ Contract roles paying less than candidate's expected CTC equivalent per year
- ❌ Roles requiring 3+ years more than candidate's experience
- ❌ Roles requiring 3+ years less than candidate's experience (overqualified)
- ❌ On-site roles in cities NOT in candidate's accepted list

---

## 3. Application Pipeline (per session)

### Step 1: LinkedIn Job Search
```
https://www.linkedin.com/jobs/search/?keywords=<KEYWORDS>&location=India&f_WT=2&f_AL=y
```
Keywords to rotate: "Senior Full Stack Developer React Node", "React Developer India", "Full Stack Engineer Python React", "Frontend Engineer React", "Software Engineer React Node", "Full Stack Developer TypeScript React"

Filters: Remote (`f_WT=2`), Easy Apply only (`f_AL=y`), scan max pages 1-3 per keyword.

### Step 2: Easy Apply
Click job → Click "Easy Apply" → fill missing fields → select resume from file path → submit.

After submit → **log immediately** to `applied_jobs.txt`:
```
<number>. <Company> - <Job Title> - <Location> - LinkedIn Easy Apply - Submitted ✓
```

### Step 3: Company Networking
Open company LinkedIn → People tab:
- Connect with **5 engineers/technical employees** (prefer 2nd degree connections)
- Connect with **1 HR/TA person** if visible
- **NEVER search for or connect with current employer employees**

Connection note (max 300 chars):
```
Hi {FirstName}, I just applied for the {Role} role at {Company}. I have {X} years experience with {stack}. Would love to connect and learn more about the team!
```

### Step 4: Cold Email (small companies ONLY — <500 employees)
Skip for large enterprises. Only for small companies where CEO/founder reads own inbox.

Research via Exa API:
```
curl -s -X POST "https://api.exa.ai/search" -H "x-api-key: {KEY}" -H "Content-Type: application/json" \
  -d '{"query": "{company} founder CEO email OR email format", "numResults": 5, "type": "neural"}'
```

Email template (compose in Gmail):
```
Subject: Senior Full Stack Developer interested in {Company}

Hi {FirstName},

I'm {Name}, a {CurrentRole} with {X} years experience building SaaS using {stack}.

I came across {Company} while researching {industry}, and was impressed by {specific detail from research}.

Key highlights:
- {Achievement 1}
- {Achievement 2}
- {Achievement 3}
- Immediate notice period

Would love to discuss how I could contribute. Resume attached.

Best regards,
{Name}
{LinkedIn}
{Phone}
```

---

## 4. Company Research via Exa API

```bash
# Competitors
curl -s -X POST "https://api.exa.ai/search" -H "x-api-key: {KEY}" -H "Content-Type: application/json" \
  -d '{"query": "{company} competitors alternatives {industry}", "numResults": 10, "type": "neural"}'

# Financials & size
curl -s -X POST "https://api.exa.ai/search" -H "x-api-key: {KEY}" -H "Content-Type: application/json" \
  -d '{"query": "{company} revenue funding employees 2025 2026", "numResults": 5, "type": "neural"}'

# Email format (try multiple sources)
curl -s -X POST "https://api.exa.ai/search" -H "x-api-key: {KEY}" -H "Content-Type: application/json" \
  -d '{"query": "{domain} email format site:rocketreach.co OR site:leadiq.com", "numResults": 5, "type": "neural"}'
curl -s -X POST "https://api.exa.ai/search" -H "x-api-key: {KEY}" -H "Content-Type: application/json" \
  -d '{"query": "{domain} email format site:clay.com/dossier", "numResults": 5, "type": "neural"}'

# Salary
curl -s -X POST "https://api.exa.ai/search" -H "x-api-key: {KEY}" -H "Content-Type: application/json" \
  -d '{"query": "{company} India software engineer salary LPA levels.fyi OR ambitionbox", "numResults": 5, "type": "neural"}'
```

Also check: SourceForge alternatives pages, AmbitionBox, Levels.fyi, Glassdoor.

---

## 5. Data Persistence

### `applied_jobs.txt` — Append-only master log
```
<number>. <Company> - <Role> - <Location> - LinkedIn Easy Apply - Submitted ✓
```

### `candidate_details.txt` — Source of truth (read at start)
Edit this to change candidate info between sessions.

---

## 6. Tool Usage

| Tool | Purpose |
|------|---------|
| Chrome DevTools (browser) | LinkedIn search/apply, Gmail compose, company pages |
| Exa API (curl) | Web search, email finding, competitor/financial research |
| webfetch | Fetch public pages (salaries, company info) |
| applied_jobs.txt | Master application log |
| candidate_details.txt | Candidate profile |

---

## 7. Session Flow

```
1. Read candidate_details.txt
2. Open LinkedIn → verify logged in
3. Job search loop:
   a. Search Easy Apply jobs with keyword
   b. For each matching job:
      i.   Easy Apply + submit
      ii.  Log to applied_jobs.txt
      iii. Open company → connect 5 eng + 1 HR
      iv.  If company <500 employees → Exa research → cold email CEO
4. Repeat step 3 with next keyword
5. STOP when user says stop
```

---

## 8. Critical Rules

- **STOP** immediately when user says STOP
- **NEVER connect** with current employer employees
- **Close irrelevant browser tabs** periodically
- **Cold email only companies <500 employees** — never large enterprises
- **Skip ALL staffing/recruiting agencies**
- **Skip Java/Angular/C#/Go-primary roles**
- **Sequential numbering** in applied_jobs.txt
- **Batch independent Exa calls** in parallel
- **Verify company size** on LinkedIn before cold emailing
- **NEVER submit** an application without explicit user permission (fill only, wait for go-ahead)
- **Complete full cycle** per job (fill → log → connect → email) before moving on

---

## 9. Salary Benchmarks (India context)

For reference when researching companies:
- Check AmbitionBox (`ambitionbox.com/salaries/{company}-salaries`)
- Check Levels.fyi (`levels.fyi/companies/{company}/salaries/software-engineer`)
- Compare candidate's expected CTC against market data

---

## 10. File Locations

All files in project root:
- `candidate_details.txt` — Edit before each session
- `applied_jobs.txt` — Auto-updated during session
- `Exa API key` — Store in environment variable or pass inline

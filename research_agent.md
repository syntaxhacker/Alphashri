# Research Agent — Deep Company Research Playbook

> A reusable methodology to deep-research any company: financials, product, team, stack, culture, risks, and fit.
> Designed for cold email / job search campaigns where you need to research 10+ companies in parallel.

---

## How This Works

Spawn one agent per company. Each agent runs the full research pipeline below and returns a structured report.
Run all agents in parallel for maximum speed.

---

## 1. The Agent Prompt Template

Copy the block below, replace `[COMPANY_NAME]` and `[WEBSITE]`, and spawn as a task.

```
Research [COMPANY_NAME] ([WEBSITE]) thoroughly. Find:

1. Company overview: founded year, HQ location, funding rounds (amounts, investors), 
   current team size, revenue (if public/estimated), growth trajectory, 
   public/private status, recent valuation

2. Product details: what they build, who they serve, key features, 
   pricing model, target customer, what makes them different. 
   Tech stack: languages, frameworks, infrastructure, databases, AI/ML tools (confirmed from job postings, engineering blogs, Wappalyzer)

3. Key employees: CEO, CTO, VP Engineering, CPO, founders. 
   For each: LinkedIn URL, email (if publicly found or inferred format), background.
   Engineering leadership specifically — who makes technical decisions.

4. Engineering culture: team size, hiring status, remote/office, 
   what they value in hires (from job postings), interview process, 
   engineering blog posts, GitHub activity (if public)

5. Recent news: product launches, partnerships, funding announcements, 
   acquisitions, leadership changes (last 12-18 months from current date Jul 2026)

6. Current job openings: check their careers page, LinkedIn Jobs, 
   Lever/Greenhouse/Ashby links. List role, location, salary if listed.

7. Glassdoor/Indeed reviews: overall rating, engineering-specific reviews, 
   work/life balance, compensation, management sentiment, 
   common complaints. CEO approval rating if available.

8. Competitors: who do they compare against? Who are their alternatives?

9. Collect all useful URLs:
   - Company website
   - LinkedIn company page
   - Careers/jobs page
   - Glassdoor page
   - Crunchbase page
   - GitHub org (if any)
   - Engineering blog
   - Key people LinkedIn profiles
   - Any other helpful links (about, leadership, contact, API docs)

10. Your assessment: given the target profile below, would this person be a fit?
    Rate 1-5 stars and explain why/why not.

**Target profile for fit assessment:**
- Role: Technical Lead / Senior Full Stack Engineer
- Experience: 5 years in logistics SaaS (drayage/freight), led 10+ engineers
- Stack: React, Node.js, Python, TypeScript, AWS
- AI: Built production RAG pipeline + AI chatbot with function calling
- Architecture: Microfrontends, build system migration (Webpack→Vite), 70% perf gain
- Location: India (remote-friendly)
- Availability: Immediate

Return ALL findings in a structured, detailed format with clear sections.
```

---

## 2. Research Dimensions (What Each Agent Should Find)

### 2.1 Company Financial Health
| Data Point | Sources |
|---|---|
| Funding total + rounds + lead investors | Crunchbase, Tracxn, PitchBook, SEC filings |
| Revenue (ARR/MRR if SaaS) | LinkedIn company page, ZoomInfo, news articles, S-1 if public |
| Employee count + trend (growing/shrinking?) | LinkedIn company page (followers + employee count over time) |
| Public/Private + stock price (if public) | Yahoo Finance, SEC EDGAR |
| Bootstrapped or VC-backed | Crunchbase, news |
| Recent valuation | News, PitchBook, secondary markets |

### 2.2 Product & Technology
| Data Point | Sources |
|---|---|
| Product description + features | Website, docs, blog |
| Target customer + vertical | Website case studies, customer logos |
| Tech stack | Job postings (JD mentions), Wappalyzer, engineering blog, GitHub |
| AI/ML maturity | Blog posts about AI features, AI-specific job postings |
| API / developer platform | Developer docs, GitHub repos |
| Pricing | Pricing page (or inferred from sales process) |

### 2.3 People & Decision Makers
| Data Point | Sources |
|---|---|
| CTO / VP Engineering name | LinkedIn, company leadership page, Crunchbase |
| Founder(s) background | LinkedIn, Crunchbase, news interviews |
| Engineering team size | LinkedIn company page (department breakdown), The Org |
| Engineering managers | LinkedIn company search, The Org |
| Email format | `prospeo.io/c/[company]-email-format`, `rocketreach.co`, `leadiq.com/c/[company]` |
| Direct email (if public) | ContactOut, Hunter.io, company blog bylines |

### 2.4 Engineering Culture
| Data Point | Sources |
|---|---|
| Glassdoor rating | Glassdoor.com |
| Engineering-specific reviews | Glassdoor (filter by role), Blind |
| Interview process | Job postings, Glassdoor interviews section |
| Remote/office/hybrid | Job postings, careers page |
| Engineering blog | Google search `[company] engineering blog` |
| GitHub org | `github.com/[company]` |
| What they value in hires | Job postings ("Requirements" section), culture docs |
| Tech stack preferences | Job postings, blog, GitHub |

### 2.5 Hiring Signals
| Data Point | Sources |
|---|---|
| Open roles count | LinkedIn Jobs, careers page, Lever/Greenhouse/Ashby |
| Recently filled roles | LinkedIn (search "[company] hired [role]") |
| Growth in job postings (up/down) | LinkedIn company page (open roles trend) |
| Geographic hiring hubs | Job posting locations |
| Contractor vs FTE | Job posting type |
| Salary ranges | Job postings (if listed), Levels.fyi, Glassdoor, Blind |

### 2.6 Risks & Red Flags
| Data Point | Sources |
|---|---|
| Leadership departures | LinkedIn, news, The Org |
| Layoffs | News, Layoffs.fyi, Blind, Glassdoor |
| Lawsuits | Google news search |
| Negative Glassdoor trends | Glassdoor (filter by date) |
| Competitor pressure | News, market analysis |
| Financial instability | Slow hiring, funding gap, revenue decline |

---

## 3. Sources Cheat Sheet

| Source | Best For |
|---|---|
| `crunchbase.com/organization/[company]` | Funding rounds, investors, founders |
| `linkedin.com/company/[company]` | Employee count, growth, key people |
| `linkedin.com/search/` (people) | Find CTO, VP Eng, specific titles |
| `tracxn.com/d/companies/[company]` | Funding, competitors, overview |
| `rocketreach.co/[company]-profile` | Emails, phone numbers, tech stack |
| `prospeo.io/c/[company]-email-format` | Email format patterns |
| `leadiq.com/c/[company]` | Email formats, leadership names |
| `theorg.com/org/[company]` | Org charts, reporting structure |
| `glassdoor.com/Overview/[company]` | Culture, compensation, reviews |
| `levels.fyi/company/[company]` | Engineering salary benchmarks |
| `github.com/orgs/[company]` | Open source repos, tech stack proof |
| `news.google.com/search?q=[company]+2026` | Recent news |
| Company careers page | Active job openings |
| `wappalyzer.com` (browser extension) | Live tech stack detection |
| Company blog / engineering blog | Culture, tech choices, values |

---

## 4. Email Finding Playbook

To find a decision-maker's email:

1. **Check public sources:** Look for bylines on company blog, press releases, conference speaker pages, GitHub profile (sometimes public email)
2. **Identify the format:** Use Prospeo or LeadIQ to find the company's email pattern (e.g., `first@company.com`, `f.last@company.com`)
3. **Check contact databases:** RocketReach, Lusha, Apollo, Hunter.io (may require login)
4. **Common formats:**
   - `first@company.com` — most common for startups
   - `first.last@company.com` — common for mid-size
   - `f.last@company.com` — common for enterprises
   - `firstl@company.com` — alternative
5. **Company-level emails:** `hello@`, `info@`, `contact@`, `team@` — always try these first
6. **Verify:** Check if the email appears anywhere public (GitHub commits, blog comments, forum posts)

---

## 5. Fit Assessment Framework

For each company, rate the target profile against these dimensions:

| Dimension | Weight | What to Assess |
|---|---|---|
| **Domain overlap** | High | Does the company operate in the same industry/vertical as the target's experience? |
| **Tech stack match** | High | Does the target's primary stack (React, Node, TypeScript) match the company's stack? |
| **AI/RAG relevance** | High | Is the company investing in AI features, LLMs, RAG, chatbots? |
| **Level alignment** | Medium | Does the company hire at the target's level (Senior, Tech Lead, Staff)? |
| **Team leadership need** | Medium | Does the company need engineering management / mentorship? |
| **Geography** | Medium | Remote-friendly? Time zone overlap? Visa sponsorship? |
| **Compensation fit** | Medium | Can they meet the target's expectations? |
| **Hiring status** | High | Are they actively hiring? Is there an open role that fits? |
| **Company stage** | Low-Med | Pre-revenue vs public — does the target's risk tolerance match? |

**Rating scale:**
- ⭐⭐⭐⭐⭐ = Near-perfect match (apply immediately)
- ⭐⭐⭐⭐ = Strong match (apply with minor stack/level gaps)
- ⭐⭐⭐ = Moderate match (worth pursuing if no better options)
- ⭐⭐ = Weak match (significant gaps in stack, domain, or hiring status)
- ⭐ = Not a fit (fundamental mismatch)

---

## 6. Output Template

Each agent should return a structured report in this format:

```
# [COMPANY NAME] — Deep Research Report

## 1. Company Overview
| Field | Detail |

## 2. Product & Tech Stack
| Field | Detail |

## 3. Key Employees
| Name | Title | LinkedIn | Email |

## 4. Engineering Culture
[Paragraphs + Glassdoor summary]

## 5. Recent News
| Date | Event |

## 6. Current Job Openings
| Role | Location | Salary | Apply Link |

## 7. Useful URLs
| Resource | URL |
|---|---|
| Website |  |
| LinkedIn |  |
| Careers/Jobs |  |
| Glassdoor |  |
| Crunchbase |  |
| GitHub |  |
| Engineering Blog |  |
| Leadership/Team |  |
| Contact |  |
| API Docs |  |

## 8. Fit Assessment
| Dimension | Score | Rationale |

**Verdict:** [Summary paragraph with recommendation]
```

---

## 7. Running Multiple Agents in Parallel

```javascript
// Pseudocode — in practice, use the Task tool
const companies = [
  { name: "PortPro", url: "portpro.io" },
  { name: "Rose Rocket", url: "roserocket.com" },
  // ...
];

// Spawn all at once with the agent prompt
for (company of companies) {
  spawn_agent(research_prompt(company));
}

// Wait for all to complete, then compile into summary
```

**In opencode:** Use the `task` tool with `subagent_type: "general"` and spawn 10-12 tasks in a single message. Each returns independently.

---

## 8. Compiling the Summary

After all agents return:

1. Create a summary table: Rank companies by fit + viability
2. Group into tracks:
   - **Track 1:** Active hiring + strong fit → apply immediately
   - **Track 2:** No active hiring but strong fit → pitch/create role
   - **Track 3:** Weak fit or blockers → skip
3. For each company, extract: Status, Product, Stack, Fit rating, Contact, Key Risk, Open roles, Useful URLs (website, LinkedIn, jobs, Glassdoor, key people)
4. Save as a single research_summary.md file

---

## 9. Quick Reference: Batch Research Checklist

- [ ] Identify 10-12 target companies
- [ ] Write agent prompt (replace company name + website)
- [ ] Spawn all agents in parallel
- [ ] Wait for returns (typically 30-90 seconds each)
- [ ] Extract key metrics into summary table
- [ ] Rank by fit + viability
- [ ] Flag any corrections (wrong person, departed, India-based)
- [ ] Build action plan (Track 1 / Track 2 / Track 3)
- [ ] Update target list with verified info

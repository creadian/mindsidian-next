---
mindmap-plugin: basic
mindmap-zoom: 78
---

# Praxis Mindmap 2026

## links
- [[Mindmap 2026]]

## Workboard ^6499845f-ba31-8078
- gantt-like visualization of workstream tasks with due dates or durations
	- claude interactive dashboards skill with milestones
- Marcio to send Zoom AI summary
- next steps 2026-04-29
	- see cluade's remarks to bitbucket code
	- see if we need the global token at all
		- ask Art if theres any downside.
	- test out live artifacts
- Insights from CC session "Praxis Workboard work 2026-04-25"
	- node.js install not needed! confirm with art ^d0966e16-060d-1091
		- `"Option A (Claude.ai connector): Settings → Integrations → Add MCP Server → paste URL + 2 headers. Zero install. Zero terminal. Zero Node.js."`
	- Reads: data-admin token: Marcio can extract items for everyone ^d492a6dc-7571-c461
		- `Reads use a server-side Data-Admin token stored in AWS Secrets Manager. This means a regular ELT member with their own PAT can still see other people's goals/actions/teams — essential for the standup workflow where Marcio extracts items for everyone.`
	- Writes: PAT. means, the user can only write in his workboard account? ^4144a72a-e72d-89e9
		- `Writes use the user's own per-request PAT. Attribution is correct: when Marcio creates an action, it shows up as Marcio's, not as the admin account.`
		- `create_action is locked to the caller's user_id — you literally can't create an action and assign it to someone else. This is a deliberate safety choice.`
	- overview of commands: see here: [[Zoom Workboard - Integration Research Overview - my notes 2026-03-27#Updates 2026-04-25]]
	- insight:
		- The skill says "call list_workstreams" → Art's MCP returns the raw list of workstreams the user has access to
			- The skill then says "now match each extracted action item to the most likely workstream by name/keyword/context" → Claude does this matching, because Claude is the one reading the skill and reasoning about the transcript
	- requirements
		- add workstream tools
		- Marcio needs an MCP where HE can create actions for other users
		- protection against someone accidentally batch deleting all their workstreams. can claude always make a backup and save it? or make a log that gets saves somewhere, of changes, so Art can undo if an accident happens?
	- ask Marcio
		- does each ELT member run the extraction
		- does Marcio run extraction, review it, and then it gets forwarded to each ELT member?
		- what are the types of tasks / items that will need to be added / updated? will inform the skill file.
			- only workstreams?
			- goals, objectives, key-results?
	- skill
		- extract my tasks / updates
		- auto-match the workstreams
			- high confidence / low confidence alternatives
		- button: show my workstreams
			- if I don't know where to put sth.
- check my own workboard! I think art added stuff in mine

## Vee Technologies callcenter ^01b14e97-3eca-ad12
- find alternatives
	- claude research:
		- [[Research 2026-04-04 - Vee Technologies Competitor Analysis]]
		- [[AI Voice Platforms for Pharma Call Center - Deep Research]]
		- [[AI Call Center Deep Research — Pharma Case Studies and Industry Landscape]]
		- [[AI Patient Hub Alternatives — Praxis Drug Launch]]
- Marcio to send proposal

## Readcube ^5ed3e3c9-b42a-60b2
- investigate the AI
- Where does it come from?
- Goals?
- Use cases?
- Workflows? Export?
- which others were examined?
- claude research:
	- [[ReadCube-Deep-Research]]
	- [[ReadCube-Alternatives-LLM-Integration-Research]]
	- [[Research 2026-04-04 — Marcio Call Action Items Deep Research#2. ReadCube AI]]

## wider AI Adoption ^9450d675-ceb6-6300
- only 10%
- Group session Nelson
	- do Filipe Rita demo session before
- claude research:
	- [[Research 2026-04-04 — Marcio Call Action Items Deep Research#4. AI Adoption (10% → 40%+)]]
	- AstraZeneca case study: upskilled 12K employees, 85-93% productivity gains
	- Demo session format designed (discovery-first for Filipe/Rita)

## Art ^29393003-740f-23fc
- sharepoint security
	- gitignore / system instruction? (check authorization)
	- claude research: NO gitignore equivalent. Use Restricted Content Discovery + sensitivity labels
	- [[Research 2026-04-04 — Marcio Call Action Items Deep Research#3. SharePoint: Security & Semantic Search]]
- semantic search sharepoint
	- READ UP ON IT
	- claude research: SharePoint has semantic search since late 2023. Use metadata columns (5 or fewer), AI autofill at \$0.005/page
- sth like frontmatter in markdown (claude skills)
	- claude research: SharePoint uses metadata columns + content types + managed metadata (taxonomy) instead of frontmatter

## Marcio ^329055f9-7329-60f4
- Claude <--> Obsidian PKM
	- also: dump 50 contexts in it, ask Claude 'what's important for this meeting?'
	- claude research: architecture designed. CEO never organizes, Christian builds structure, Claude queries.
- weekly briefing
	- new releases/capabilities
	- menu of options for next week
		- one pager with screenshots / 1 min video with 10s each (1min briefing)
	- claude research: template ready in [[Research 2026-04-04 — Marcio Call Action Items Deep Research#5. Supporting Marcio — CEO Briefing & AI Chief of Staff]]
- interactive (notebookLM) summary after each call?
	- claude research: NotebookLM for audio digests, Claude Projects for deep Q&A, tl;dv/Otter for auto-capture
- how to support best? ^1addcdf4-ceb2-41b5
	- Ask Claude, "How can I support this guy the best? If in a perfect world, what would I be doing?" That he says, "Wow, this is invaluable."
	- Pull in information from executives and their executive assistants.
	- Work practices
	- Typical dynamics
	- How are the executives, especially CEOs, stretched?
	- claude research: "AI Strategy Advisor" positioning. 5-function framework (Intelligence, Preparation, Execution, Amplification, Pattern Recognition)
	- [[AI Chief of Staff — Role Research and Positioning Analysis]]
	- [[Research 2026-04-04 — Marcio Call Action Items Deep Research#7. Christian's Professional Positioning: AI Strategy Advisor]]
- Glossary ^87628957-fc93-701d
	- CTA: Clinical Trial Agreement
	- CRO: Contract Research Organization
	- CDMO: Contract Development and Manufacturing Organization
	- MSA: Master Services Agreement
	- in detail ^ef2b6d2f-37a3-8990
		- Quick legal/biotech glossary: CTA — Clinical Trial Agreement. Contract between the sponsor (Praxis) and a clinical trial site (a hospital, academic medical center, or research network) plus the principal investigator there. Defines who does what, IP ownership of trial data, indemnification if a patient is harmed, payment schedule per enrolled patient, publication rights. Praxis signs one per site — and Phase 3 trials run at dozens to hundreds of sites globally. High volume, mostly templated, lots of negotiation on indemnification + publication. CRO — Contract Research Organization. A company Praxis pays to actually run the clinical trial operationally — patient recruitment, data collection, monitoring sites, statistical analysis, regulatory filings. Big names: IQVIA, Parexel, ICON, Labcorp Drug Development. Praxis is too small to run global Phase 3 trials in-house, so they outsource execution to a CRO. CDMO — Contract Development and Manufacturing Organization. A company Praxis pays to make the drug — synthesize the active pharmaceutical ingredient, formulate it into pills/injections, do quality control, package for trials and commercial supply. Examples: Catalent, Lonza, Patheon. Same logic — Praxis doesn't own factories. MSA — Master Services Agreement. The umbrella contract with a CRO or CDMO that sets the legal terms once (IP, confidentiality, indemnification, payment terms, termination, change-of-control). Then each specific piece of work hangs off it as a SOW (Statement of Work) — "for this trial / this batch / this molecule, here's the scope and price." Negotiate the MSA hard once, then SOWs go faster. So "CRO/CDMO MSAs" = the umbrella contracts with the companies running the trial and making the drug. These are the long, complex, high-stakes contracts — often 100-300 pages. Exactly the kind where an AI summarization or risk-extraction workflow lands well, which is why I flagged it as a killer demo.

## Alex ^0a0d1ab1-1762-a5a5
- Claude
	- Discovery
		- Walk me through your last contract review — what kind, how long, what ate the time?
		- Where do docs live
		- Recurring tasks
	- Email attachments in claude
	- Cowork intro 2026-05-15 ^89cb3d9d-9d55-9074
		- hallucinations
			- improving
			- how to prompt
			- "double check" / "are you sure about XY"
			- run it in new chat / another LLM
		- system instructions
			- claude.md + md files
		- Folders / Projects
			- can use all files in the folder
			- custom instructions
			- Subfolders:
				- my work
				- claude outputs
				- templates
		- memory project-internal
			- also general memory
		- Scheduled tasks
		- Settings / global instructions
		- Plugins / Connectors / Skills
		- hacks
			- AskUserQuestion / ask me questions
			- ask me questions until you know what I actually want/need, not what I think I want
			- double check this; verify that the claims appear in the sources and output them
			- run an output through another LLM to cerify
			- dictation
		- What he needs
			- create a dashbaord that’s supposed to be updating daily
			- claude cowork with microsoft 365 can not send emails right now. LOOK INTO THAT.
		- What we talked about today
			- A little bit about hallucinations but not how to prevent them. Briefly touched upon system instructions. Talked about adding a folder to cowork. Alex has some about me and how I work.md files so we have to look into how to instruct the claude.md to read those. We used Claude to improve a prompt for cowork scheduled tasks, And to save the output as a live artifact. We talked about the hacks of "Ask me questions" to get context of what I actually want or need instead of what I think I need and to surface blind spots.
	- Dashbaords
	- [x] Test a scheduled task with a live artifact as an output and to have it send emails.
		- See if Cowork can send emails with results of scheduled tasks.
	- about me / how I work files
		- tell claude.md
	- Boston
	- my future in praxis
	- hallucinations
		- build a skill
		- second LLM critique
		- are you sure loops / verify that claims are in sources
	- cowork email sending
	- live artifacts
		- Dashboard for daily DEE task
- 2026-05-20
	- Try to set up the Claude Code last 30 days plugin in Cowork.
		- Goal
			- Want to capture anytime someone is mentioning Praxis on social media (X, Reddit, FB) and keep a running. Keywords: $PRAX, Praxis Precision Medicines, Praxis in context of pharma, epilepsy, biotech. Search in: X, Reddit, Linkedin, Facebook
		- Although it didn't work, Alex found it super useful just how I approached this.
		- [ ] <mark style="background:#A7E8A4;">Try to set this up on my computer with the xAPI key so next time I can guide him to set it up.</mark>

## AI Development
- Marcio: talk to Steve

## 07 AI for IP
- [[AI for IP HOME]]
- external databases
	- main free access in addition to Google Patents is the USPTO (for US) https://www.uspto.gov/patents/search/patent-public-search and Espacenet (for EU) https://worldwide.espacenet.com/ and Patentscope (Global) https://patentscope.wipo.int/search/en/search.jsf
- check her skill
	- give me a set of presentations. Details what would be missed. Folder of IP filings. I'll test it.
- her scheduled search
- call briefings
- Claude for legal news
	- https://claude.com/blog/claude-for-the-legal-industry
- 2026-05-20
	- test MCP
		- find folders on sharepoint, then search for them
		- see if we can find out HOW sharepoint searches, and copy that with the MCP - see Felix chat today
	- mostly troubleshooting of the mcp

## Lisa Adelson
- 2026-05-20
	- We Built shortcut to Claude folder for daily routine and improved her scheduled tasks: failure mode; save as word
	- FIND OUT
		- can I do a "Click" animation via Zoom on Lisa's screen?
		- CHECK HER SCHEDULED PROMPTS
			- I have her UCB KCNT1 prompt - see if it can be improved. Does it do a check for the last seven days? Can we make sure it's not going to miss if UCB issues a patent or gets a patent granted? She will send me the praxis patent watch prompt.
			- she also should have sent the other prompt: praxis patent watch
	- LISA TO DO
		- Lisa will make list of all of our programs, and for each program what will be most useful.
	- Quotes
		- The UCB KCNT1 watch has a lot of additional information from all these amazing sources:
			- “I would just never have time to go look in these sources. And there’s lots more.” 2h of my day in the morning.
- 2026-05-27
	- competitive patent intel - ELT?
	- Lisa report: 3 projects last week, ~5× faster with Claude + her own quote "this is unreal."
	- New scheduled task built together: patent-application publication tracker.
		- Tracks the provisional → regular (@ 1 yr) → publishes (~6 mo after regular filing, with allowance-in-window the 1:10⁴–1:10⁶ exception).
	- New patent agent joining Lisa's team → new weekly AI-for-patent call (Chris + Lisa + agent).
	- Lisa's meta-learning, in her own words: "go step by step; be clear, focused, concrete; don't overwhelm Claude."
	- Useful elicitation pattern surfaced: "What would you do if you had infinite time?"
- 2026-06-10
	- NEW WORKSTREAM: Veeva protocol-update watch (supersedes the 5-27 "email alerts" idea)
		- WHY: trial protocols live only in Veeva Vault RIM; amended by many ppl; matter for Lisa's patent filings; ppl forget to tell her → Julia checks monthly = not enough
		- Built saved custom views (Vault RIM / Submissions Production; Modified + Approved Date cols; **Approved versions only**, no drafts)
		- Manual loop now: open view → download Excel → Claude checks Downloads folder → reports approved amendments → SharePoint folder
		- NEXT: weekly Cowork scheduled task (Lisa SSO-logs in when prompted) — recall > precision; SSO not a blocker; no MCP connector for Veeva (browser-download workflow)
			- scheduled prompt draft: CC Lisa one-on-one briefing 2026-06-10
		- OPEN: stable direct view-link? how to map an updated protocol back to the version cited in the patent application (still manual)
		- adjacent: Julia + Bryce call (docket deadlines from email / SharePoint / Veeva)

## 08 Procurement Ida
- older
	- get all budget grids
		- might need name mapping
		- match ctas and amendments
		- per clinic / region / country
		- do we have as excel, or is data in MedRio EDC?
- 2026-06-10
	- my job: MCP - create skill for budget grid output
	- call with Ida et al, and later with Felix:
		- filter record type and stage 1.
		- Goal: Clinops: For this site, based on this protocol, these assessments (based on SOA: Schedule of Activities and Assessments): Claude takes the protocol, then uses MCP, for this region: what is average price / fmv? —> Build budget grid. So: Protocol —> assessment —> budget grid.
		- Ida should be able to share protocols.
	- https://acuity.praxismedicines.dev/browser

## Overview
- TODOS
	- [x] read output of CCode: Process-call Lisa Adelson 2026-05-20
- Procurement CTA
	- Talk with Felix and see his latest progress.
	- Think about prompting for an agent that would surface an estimate of fair market value.
- Lisa
- AI for IP
	- Test the MCP
- Alex
- Marcio
	- update the weekly briefing with analyst reports, etc.
	- Set up the official work board MOC.
- AI Tech Team
	- Ask Curtis about the AI booth for all hands.
	- Follow up with Matthew on the Claude rollout.
	- check the open work labs - see group chat 2026-05-26

## soon
- claude was confused about logbook vs dashbaord
- process felix call 1, and 2 from today
- business registration
- Someday
	- Build a news tracker for praxis-related news and press releases.
	- Ask Claude which kinds of things we should put in the shared logbook and which things should go into the dashboards.
- Advisory Council ^a53550e9-b49b-d6cf
	- skill itself
		- he has v 0.3.0
			- I need to send v0.4.0
				- or 0.5.0 actually
		- One way he installs the skill and has the context to find an obsidian or
			- new strategy:
				- I have created a separate zip package so that I can have the skill and the context file both in one folder in one zip to upload to Claude Cowork. Let's test if that works better. Marcio has one simple thing to install.
					- cowork chat name: Restructure skill files into zip package
			- say: living document
	- Praxis context file
		- Create the interview prompt.
		- Pre-fill with publicly available information.
		- Tell Marcio that I want to make the praxis context file a living document. That's why it's not in the skill, but it should live in his Obsidian vault, and once we have it, we will update the skill so that it always reads the context file before the agents go to work.
		- Maybe run the results through some LLM councils?
	- Council skill
		- Run it through Barbara Salami's Council prompt. And other advisory board skills that I find online.
	- Test it myself with my own questions and with a context file in my vault.
		- Big question: How do we maintain the context file? The skill needs instructions for that. This is what I have to test.

## today
- process
	- [x] process lis call
	- [x] process ai for ip call
	- [x] process alex call
	- process andinga call
	- [x] process procurement cta call
- 2026-05-27
	- WORKBOARD MCP
		- try again
	- Alex?
		- <mark style="background:#A7E8A4;">check claude legal</mark>
	- check this open code thingy
	- AI Briefing
		- use claude code to look directly? Or chrome extension? Better claude code, because chrome extension doesnt have knowledge.
	- send invoice + finish biz registration
	- VEEVA CONNECTOR for Lisa!!!
		- With Lisa, log into her account and find out if we can create email alerts for specific events.
	- Final slot week after next with Briz and Julia and Lisa.

## now now
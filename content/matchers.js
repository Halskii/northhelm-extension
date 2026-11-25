// Job Autofill — field matching rules and option-matching helpers.
// Loaded before adapters.js and filler.js; exposes window.__JAF_M.
(() => {
  const VER = (() => { try { return chrome.runtime.getManifest().version; } catch (_) { return "dev"; } })();
  if (window.__JAF_M && window.__JAF_M.version === VER) return;

  const norm = (s) => String(s ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // ---------------------------------------------------------------------------
  // Rules. Each rule maps question text (label) and/or machine attributes
  // (name, id, data-automation-id, autocomplete…) to a profile key.
  //   ctx: "top" (outside job/education sections), "job", "edu", or "any".
  //   label: tested against the human label/question text.
  //   attr:  tested against machine attributes (fallback when label misses).
  //   not:   label must NOT match this.
  // Order matters: the first matching rule wins.
  // ---------------------------------------------------------------------------
  const R = (key, ctx, label, attr, not) => ({ key, ctx, label, attr, not });

  const RULES = [
    // Never-touch fields — matched first so nothing else claims them.
    R("__skip", "any", /captcha|password|social security|\bssn\b|date of birth|birth ?date|\bdob\b|signature|\binitials\b|\be-?sign\b|today'?s date|date signed|security question|bank(ing)? (account|details|information|name)|account number|routing|credit card/, /captcha|password|ssn|birth|signature|honeypot/),
    R("__consent", "any", /\b(i agree|agree to|i acknowledge|acknowledge|i certify|certify that|i consent|consent to|terms|privacy (policy|notice)|i have read|i understand|attest|subscribe|marketing|text messages|sms|opt in|newsletter|talent community|job alerts)\b/),

    // EEO / voluntary self-identification (only filled when enabled in options)
    R("eeo.hispanic", "any", /hispanic|latin[oax]/, /hispanic/),
    R("eeo.race", "any", /\brace\b|ethnicity|racial/, /\brace\b|ethnicity/),
    R("eeo.gender", "any", /\bgender\b|\bsex\b/, /gender/, /orientation|transgender|identity/),
    R("eeo.veteran", "any", /veteran|military (status|service)|protected veteran/, /veteran/),
    R("eeo.disability", "any", /disabilit/, /disabilit/),

    // Eligibility & logistics questions
    R("sponsorship", "any", /sponsor|visa (status|support)|h-?1b|immigration (support|status)/, /sponsor/),
    R("workAuthorized", "any", /(legally )?(authori[sz]ed|eligible|permitted|right) to (work|be employed)|work authori[sz]ation|employment eligibility|eligible for employment|work permit/, /workauth|authorized|eligib/),
    R("over18", "any", /\b(18|eighteen) (years|or older|\+)|at least (18|eighteen)|legal (working )?age|of legal age/),
    R("relocate", "any", /relocat/),
    R("finraLicenses", "any", /finra|securities licen[cs]e|series (6|7|24|63|65|66)\b|insurance licen[cs]es? and or designation/),
    R("relativeAtCompany", "any", /(relative|family member|significant other|spouse|related to (any|an|a) )[^?]{0,80}(work|employ|director|officer)|(work|employ)[^?]{0,60}(relative|family member)/),
    R("priorContractor", "any", /(as|been) an? (independent )?contractor|independent contractor or|temporary worker|contingent worker/),
    R("restrictiveAgreement", "any", /non ?-?compet|non ?-?solicit|restrictive covenant|obligated under any (contract|agreement)|(bound by|subject to|party to) (any|an|a) [^?]{0,40}agreement/),
    R("involuntaryTermination", "any", /involuntarily (discharged|terminated|separated)|asked to resign|(ever )?been (fired|terminated|discharged|dismissed)/),
    R("outsideEmployment", "any", /outside (entity|employment|business|activit|position|affiliation)|secondary employment|serv(e|ing) on (the|a) board|other (form of )?employment while/),
    R("governmentEmployee", "any", /public official|government(al)? (body|agency|official|entity|employee)|elected (position|official|office)|(employed|worked) (by|for) (a |the |any )?(federal|state|local)? ?government/),
    R("previouslyEmployed", "any", /(previously|ever|have you (ever )?)\s*(been )?(employed|worked) (by|for|at|with)|former employee|worked (here|for us) before|current or former employee/),
    R("howHeard", "any", /how did you (hear|find|learn|come across)|where did you (hear|find|learn)|how were you referred|source of (application|referral)|^source$|referral source|how you heard/, /^source|source source|sourcedropdown|howdidyouhear|hear about/),
    R("salary", "any", /salary|compensation|pay (expectation|requirement|range)|desired (pay|wage|rate)|expected (pay|wage|rate)|wage expectation/, /salary|compensation/),
    R("noticePeriod", "any", /notice period|how much notice/),
    R("startDate", "top", /(available|availability) (to|date|start)|earliest (start|available)|when can you start|desired start|start date|date available/),
    R("yearsExperience", "any", /(how many )?years (of )?(professional |relevant |related |total |work )?experience|years experience|experience \(years\)/, /yearsofexperience|years experience/),

    // Links
    R("linkedin", "any", /linked ?in/, /linkedin/),
    R("github", "any", /git ?hub/, /github/),
    R("twitter", "any", /twitter|\bx\.com\b|\bx handle/, /twitter/),
    R("portfolio", "any", /portfolio/, /portfolio/),
    R("website", "any", /website|personal (site|url|page)|blog|other (url|link|website)|^url$|web ?site|homepage/, /website|urls other|personal url/),

    // Contact
    R("email", "any", /e-?mail/, /e-?mail/),
    R("phoneCountryCode", "any", /(country|phone) (dial(ing)? )?code|country code|dial(ing)? code|phone country/, /countryphonecode|phonecode|dialcode|country code/),
    R("phoneExtension", "any", /extension|\bext\b/, /extension/),
    R("phoneType", "any", /phone (device )?type|type of phone|device type/, /phonetype|phone device type|phone type/),
    R("phone", "any", /phone|mobile|cell|telephone|contact number/, /phone|mobile|tel\b|telephone/),

    // Names
    R("preferredName", "any", /preferred (first )?name|nickname|name you go by|goes by/, /preferred ?name/),
    R("pronouns", "any", /pronoun/, /pronoun/),
    R("firstName", "any", /first name|given name|forename|legal first|first \(legal\)/, /first ?name|fname|given ?name|firstname/),
    R("middleName", "any", /middle (name|initial)/, /middle ?name/),
    R("lastName", "any", /last name|surname|family name|legal last/, /last ?name|lname|surname|family ?name|lastname/),
    R("fullName", "top", /^(full |legal |your |candidate |applicant )?(full )?name$|^name \*?$|full (legal )?name|your name/, /^name$|full ?name|systemfield name|candidate name/),

    // Address
    R("address2", "any", /address (line )?2|apartment|\bapt\b|suite|unit/, /address(line)? ?2|address2/),
    R("address1", "any", /street|address( line)? ?1?$|^address|mailing address|home address/, /address(line)? ?1|address1|street|addressline1/, /e-?mail|url|web/),
    R("location", "top", /^(current )?location|where are you (currently )?(located|based)|city,? state|current (city|residence)|location \(city\)|city and state/, /candidate location|location/),
    R("city", "any", /\bcity\b|\btown\b|municipality/, /\bcity\b/),
    R("county", "any", /\bcounty\b/),
    R("state", "any", /\bstate\b|province|region/, /\bstate\b|province|countryregion|region/, /united states|statement|state of residence for tax/),
    R("zip", "any", /zip|postal|post code|postcode/, /zip|postal/),
    R("country", "any", /country|nation/, /country/, /code|phone/),

    // Work history (inside a work-experience section)
    R("job.current", "job", /currently (work|employed)|i currently work|current (job|position|employer|role)|present|still (work|employed)/, /currentlyworkhere|current/),
    R("job.title", "job", /title|position|role/, /jobtitle|title|position/),
    R("job.company", "job", /company|employer|organi[sz]ation|business name/, /company|employer|org/),
    R("job.location", "job", /location|city/, /location/),
    R("job.start", "job", /start|\bfrom\b|began|begin/, /start|\bfrom\b/),
    R("job.end", "job", /\bend\b|\bto\b|until|finish/, /end ?date|enddate|\bto\b/),
    R("job.description", "job", /description|responsibilit|duties|summary|accomplishment|role description|what did you do/, /description|responsibilit/),

    // Education
    R("edu.school", "any", /school|university|college|institution|academy/, /school|university|institution/),
    R("edu.degree", "any", /degree|level of education|education level|highest (level|education)|qualification/, /degree/),
    R("edu.major", "any", /major|field of study|discipline|concentration|area of study|course of study|program of study/, /major|fieldofstudy|discipline|field of study/),
    R("edu.gpa", "any", /\bgpa\b|grade point|grade average|overall result/, /gpa|gradeaverage|grade average/),
    R("edu.start", "edu", /start|from|first year|attended from|began/, /start|\bfrom\b|firstyear/),
    R("edu.end", "edu", /\bend\b|\bto\b|graduat|completion|last year|expected/, /\bend\b|enddate|end date|\bto\b|lastyear|graduat/),
    R("edu.end", "any", /graduation (date|year)|year of graduation|grad(uation)? year|expected graduation/),

    // Top-level employment (outside sections)
    R("currentCompany", "top", /current (company|employer)|most recent (company|employer)|present employer|^company$|^employer$|company name/, /^org$|currentcompany|current company/),
    R("currentTitle", "top", /current (job )?(title|position|role)|most recent (job )?title|present (title|position)|^job title$|^title$/, /currenttitle|current title|job title/),

    // Long text
    R("coverLetterText", "any", /cover letter|letter of (interest|intent)|why (do you want|are you interested|would you like)|why .{0,30}(us|company|role|position|team)\b|what (interests|excites|attracts|draws) you|interest(s|ed)? you (about|in) (this|the|our)|why (this|our) (role|company|team|position)/, /cover ?letter/),
    R("summary", "any", /summary|about (yourself|you|me)|introduce yourself|tell us about|bio(graphy)?\b|profile summary|professional summary/, /summary|bio/),
    R("skills", "any", /^(type to add |add |list |your |key |technical |relevant |top )?skills?\b|skills? \(|^skills? /, /skills/)
  ];

  // Which kinds of form control each key may fill. Keys not listed accept any
  // single-value control (text, select, radio, combobox…) but never textarea.
  const LONG_KEYS = new Set(["coverLetterText", "summary", "skills", "job.description", "address1"]);
  const BOOL_KEYS = new Set(["job.current"]);
  function keyAllowsKind(key, kind) {
    if (key === "skills") return kind === "text" || kind === "textarea" || kind === "combobox";
    if (BOOL_KEYS.has(key)) return kind === "checkbox";
    if (kind === "checkbox") return false;
    if (kind === "textarea") return LONG_KEYS.has(key);
    if (kind === "file") return false;
    return true;
  }

  // Resume / cover letter file inputs
  const FILE_RULES = [
    { key: "coverLetterFile", re: /cover ?letter/ },
    { key: "resumeFile", re: /resume|\bcv\b|curriculum/ }
  ];

  // ---------------------------------------------------------------------------
  // Option matching for <select>, radios, comboboxes, listboxes.
  // ---------------------------------------------------------------------------
  const US_STATES = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
    DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
    IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
    MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
    NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
    NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
    PR: "Puerto Rico", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
    UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
  };
  const STATE_BY_NAME = Object.fromEntries(Object.entries(US_STATES).map(([c, n]) => [norm(n), c]));

  const COUNTRY_SYNONYMS = [
    ["united states", "united states of america", "usa", "us", "u s", "u s a", "america"],
    ["united kingdom", "uk", "great britain", "england", "u k"],
    ["canada", "ca"],
    ["mexico", "mx"],
    ["india", "in"]
  ];

  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

  const NEG = /\b(no|not|dont|do not|am not|will not|wont|cannot|cant|unable|decline|never|neither|none)\b/;

  function yesNoOf(v) {
    const n = norm(v);
    if (/^(yes|y|true|i am|i do|i will|i have)\b/.test(n)) return "yes";
    if (/^(no|n|false)\b/.test(n)) return "no";
    return null;
  }

  function degreeLevel(s) {
    const n = norm(s);
    if (/\b(ph ?d|doctor|doctorate|dphil|md|jd)\b/.test(n)) return "doctor";
    if (/\b(master|masters|mba|m ?s|m ?a|msc|meng|m ?eng)\b/.test(n)) return "master";
    if (/\b(bachelor|bachelors|b ?s|b ?a|bsc|beng|undergraduate|4 year|four year)\b/.test(n)) return "bachelor";
    if (/\b(associate|associates|a ?a|a ?s|2 year|two year)\b/.test(n)) return "associate";
    if (/\b(high school|ged|secondary|diploma)\b/.test(n)) return "highschool";
    return null;
  }

  // Strict matching for list-picking where a wrong pick is worse than none (skills):
  // exact, then "python" -> "python programming language", then whole-word containment.
  // Never "java" -> "javascript".
  function strictOption(texts, value) {
    const v = norm(value);
    if (!v) return -1;
    const opts = texts.map((t, i) => ({ i, n: norm(t) })).filter(o => o.n && !isPlaceholderOpt(o.n));
    const byLen = (a, b) => a.n.length - b.n.length;
    const exact = opts.find(o => o.n === v);
    if (exact) return exact.i;
    const pre = opts.filter(o => o.n.startsWith(v + " ")).sort(byLen);
    if (pre.length) return pre[0].i;
    const re = new RegExp("(^| )" + v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "( |$)");
    const maxWords = v.split(" ").length + 3;
    const cont = opts.filter(o => re.test(o.n) && o.n.split(" ").length <= maxWords).sort(byLen);
    return cont.length ? cont[0].i : -1;
  }

  // ---------------------------------------------------------------------------
  // Skill matching. Sites keep their own skill catalogue ("Java (Programming
  // Language)", "Amazon Web Services", "Docker Container"), so a profile skill
  // has to be mapped to the catalogue's name for the same thing, and never to a
  // narrower product that merely contains the word ("AWS VPN", "Java EE").
  // ---------------------------------------------------------------------------
  const SKILL_SYNONYMS = [
    ["AWS", "Amazon Web Services"], ["GCP", "Google Cloud Platform", "Google Cloud"], ["Azure", "Microsoft Azure"],
    ["K8s", "Kubernetes"], ["JS", "JavaScript"], ["TS", "TypeScript"],
    ["CI/CD", "Continuous Integration and Continuous Delivery", "Continuous Integration", "Continuous Delivery"],
    ["LLM", "Large Language Models", "Large Language Modeling", "LLMs"], ["MCP", "Model Context Protocol"],
    ["ML", "Machine Learning"], ["AI", "Artificial Intelligence"], ["GenAI", "Generative AI", "Generative Artificial Intelligence", "Gen AI"],
    ["NLP", "Natural Language Processing"], ["OOP", "Object Oriented Programming"],
    ["Postgres", "PostgreSQL"], ["Mongo", "MongoDB"], ["Node", "Node.js", "NodeJS"], ["React", "React.js", "ReactJS"], ["Vue", "Vue.js", "VueJS"],
    ["C#", "C Sharp"], [".NET", ".NET Framework", "Dot Net"],
    ["Excel", "Microsoft Excel"], ["Word", "Microsoft Word"], ["PowerPoint", "Microsoft PowerPoint"], ["Outlook", "Microsoft Outlook"],
    ["Office", "Microsoft Office"], ["SQL Server", "Microsoft SQL Server"], ["Power BI", "Microsoft Power BI"], ["Teams", "Microsoft Teams"],
    ["Oracle", "Oracle Databases", "Oracle Database"], ["REST", "REST APIs", "RESTful API", "REST API"],
    ["Agentic AI", "AI Agents"], ["PowerShell", "Windows PowerShell"], ["Terraform", "HashiCorp Terraform"], ["OpenShift", "Red Hat OpenShift"],
    ["TDD", "Test Driven Development"], ["ETL", "Extract Transform Load"], ["UI", "User Interface"], ["UX", "User Experience"],
    ["QA", "Quality Assurance"], ["SDLC", "Software Development Life Cycle"], ["IaC", "Infrastructure as Code"], ["Spring", "Spring Framework"]
  ];
  const SKILL_VENDORS = new Set(["microsoft", "amazon", "google", "apache", "red hat", "hashicorp", "oracle", "ibm", "adobe", "atlassian", "vmware", "cisco", "sap", "salesforce"]);
  // Words that only say what kind of thing it is; "Docker Container" is still Docker.
  const SKILL_DESCRIPTORS = new Set(["programming", "language", "languages", "scripting", "software", "container", "containers", "database", "databases",
    "framework", "frameworks", "platform", "development", "tool", "tools", "technology", "technologies", "library", "pipeline", "pipelines", "operating", "system", "systems"]);
  // Trailing words people add in a profile that the catalogue usually leaves out.
  const SKILL_FILLER = new Set(["pipelines", "pipeline", "development", "programming", "application", "applications", "scripting", "tools", "framework", "language"]);
  const QUAL_BONUS = [[/programming language|scripting language|query language|markup language/, 4], [/framework|library|package|software|platform|tool|system|database|service/, 3]];

  const splitSkill = (raw) => {
    const s = String(raw || "");
    const quals = [...s.matchAll(/\(([^)]*)\)/g)].map(m => m[1].trim()).filter(Boolean);
    return { raw: s.trim(), baseRaw: s.replace(/\s*\([^)]*\)/g, " ").replace(/\s+/g, " ").trim(), quals };
  };
  const sing = (n) => n.replace(/([a-z]{3,})s$/, "$1");
  const sameSkill = (a, b) => a === b || sing(a) === sing(b);

  /** Everything a profile skill may be called, with a trust weight, plus what to type into the search box. */
  function skillPlan(skill) {
    const q = splitSkill(skill);
    const names = new Map();
    const add = (text, w) => { const n = norm(text); if (n && (names.get(n) || 0) < w) names.set(n, w); };
    const terms = [];
    const term = (t) => { t = String(t || "").trim(); if (t && !terms.some(x => x.toLowerCase() === t.toLowerCase())) terms.push(t); };
    const synonymsOf = (text) => {
      const n = norm(text);
      const g = SKILL_SYNONYMS.find(grp => grp.some(x => norm(x) === n));
      return g ? g.filter(x => norm(x) !== n) : [];
    };

    add(q.raw, 1); add(q.baseRaw, 0.99);
    // One- or two-letter names ("C", "R", "Go") search badly on their own.
    if (norm(q.baseRaw).length <= 2) term(`${q.baseRaw} (Programming Language)`);
    term(q.baseRaw);
    const syn = synonymsOf(q.baseRaw);
    syn.forEach(x => add(x, 0.97));
    const longer = (list, than) => list.find(x => x.length > than.length);      // type the spelled-out name, not another abbreviation
    term(longer(syn, q.baseRaw));
    q.quals.forEach(x => { add(x, 0.85); term(x); synonymsOf(x).forEach(y => add(y, 0.85)); });

    const words = q.baseRaw.split(/\s+/);
    let cut = words.length;
    while (cut > 1 && SKILL_FILLER.has(norm(words[cut - 1]))) cut--;
    if (cut < words.length) {
      const short = words.slice(0, cut).join(" ");
      add(short, 0.92); term(short);
      const s2 = synonymsOf(short);
      s2.forEach(x => add(x, 0.9));
      term(longer(s2, short));
    }
    const list = [...names].map(([n, w]) => ({ n, w }));
    // If we know what an abbreviation stands for, "(MCP)" on some other phrase is not a match.
    return { skill: q.raw, names: list, terms: terms.slice(0, 4), knowsLongForm: list.some(x => x.n.includes(" ")) };
  }

  /** 0–100: how sure we are that this catalogue entry is the same skill. 80+ is safe to pick. */
  function skillScore(label, plan) {
    const L = splitSkill(label);
    const full = norm(L.raw), base = norm(L.baseRaw), quals = L.quals.map(norm);
    if (!full || isPlaceholderOpt(full)) return 0;
    let best = 0;
    for (const { n, w } of plan.names) {
      let tier = 0;
      if (sameSkill(full, n)) tier = 100;
      else if (quals.length && sameSkill(base, n)) {
        const q = quals.join(" ");
        tier = 95 + ((QUAL_BONUS.find(([re]) => re.test(q)) || [0, 0])[1]);
      }
      else if (!plan.knowsLongForm && quals.some(x => sameSkill(x, n))) tier = 93;
      else {
        for (const text of new Set([base, full])) {
          if (text.endsWith(" " + n) && SKILL_VENDORS.has(text.slice(0, -n.length - 1))) tier = Math.max(tier, 88);
          if (text.startsWith(n + " ") && text.slice(n.length + 1).split(" ").every(x => SKILL_DESCRIPTORS.has(x))) tier = Math.max(tier, 85);
        }
      }
      best = Math.max(best, tier * w);
    }
    return Math.round(best);
  }

  /** Best catalogue entry for a skill: highest score, the site's own order breaking ties. */
  function skillOption(labels, plan) {
    let i = -1, score = 0;
    labels.forEach((l, k) => { const s = skillScore(l, plan); if (s > score) { score = s; i = k; } });
    return score >= 80 ? { i, score } : { i: -1, score };
  }

  function tokens(s) { return new Set(norm(s).split(" ").filter(t => t.length > 1)); }
  function overlap(a, b) {
    const A = tokens(a), B = tokens(b);
    if (!A.size || !B.size) return 0;
    let hit = 0;
    for (const t of A) if (B.has(t)) hit++;
    return hit / Math.max(A.size, B.size);
  }

  const isPlaceholderOpt = (t) => /^(select|choose|please select|pick|--|—|-)?\s*(one|an option|\.\.\.)?$/.test(norm(t)) || /^(select|choose|please)\b/.test(norm(t));

  /**
   * Pick the best option for a value.
   * @param {string[]} texts option labels
   * @param {string} value desired value
   * @param {string} key profile key (helps with special cases)
   * @param {object} ctx { country, alt: [] }
   * @returns {number} index or -1
   */
  function bestOption(texts, value, key = "", ctx = {}) {
    if (value == null || value === "") return -1;
    const opts = texts.map((t, i) => ({ i, t, n: norm(t) })).filter(o => o.n && !isPlaceholderOpt(o.t));
    if (!opts.length) return -1;
    const v = norm(value);
    const alts = [value, ...(ctx.alt || [])].map(norm).filter(Boolean);

    // Phone country code: prefer the option naming the user's country.
    if (key === "phoneCountryCode") {
      const c = norm(ctx.country || "United States");
      const syn = COUNTRY_SYNONYMS.find(g => g.includes(c)) || [c];
      const code = v.replace(/[^0-9]/g, "");
      const byCountry = opts.find(o => syn.some(s => s.length > 2 && o.n.includes(s)) && (!code || o.n.includes(code)));
      if (byCountry) return byCountry.i;
      const byCode = opts.find(o => code && new RegExp(`(^|\\D)\\+?${code}(\\D|$)`).test(o.t));
      if (byCode) return byCode.i;
    }

    // Yes / No style answers
    const yn = yesNoOf(value);
    if (yn && opts.length <= 8) {
      const scored = opts.map(o => {
        let s = 0;
        const startsYes = /^yes\b/.test(o.n), startsNo = /^no\b/.test(o.n);
        const neg = NEG.test(o.n);
        if (yn === "yes") s = startsYes ? 3 : (!neg && /\b(i am|i will|i do|i have|i can|i would)\b/.test(o.n) ? 2 : 0);
        else s = startsNo ? 3 : (neg && !startsYes ? 2 : 0);
        return { o, s };
      }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
      if (scored.length) return scored[0].o.i;
    }

    // Exact (including synonyms)
    for (const a of alts) {
      const ex = opts.find(o => o.n === a);
      if (ex) return ex.i;
    }

    // US state ↔ code
    if (key === "state" || key.endsWith("state")) {
      const code = v.length === 2 ? v.toUpperCase() : STATE_BY_NAME[v];
      const name = code && US_STATES[code];
      if (name) {
        const hit = opts.find(o => o.n === norm(name) || o.n === code.toLowerCase() || o.n.startsWith(norm(name) + " ") || o.n.endsWith(" " + code.toLowerCase()));
        if (hit) return hit.i;
      }
    }

    // Country synonyms
    if (key === "country" || key.endsWith("country")) {
      const group = COUNTRY_SYNONYMS.find(g => g.includes(v));
      if (group) {
        const hit = opts.find(o => group.includes(o.n)) || opts.find(o => group.some(s => s.length > 3 && o.n.startsWith(s)));
        if (hit) return hit.i;
      }
    }

    // Degree level
    if (key === "edu.degree") {
      const lvl = degreeLevel(value);
      if (lvl) {
        const cands = opts.filter(o => degreeLevel(o.t) === lvl);
        if (cands.length) {
          cands.sort((a, b) => overlap(b.t, value) - overlap(a.t, value));
          return cands[0].i;
        }
      }
    }

    // Months
    if (/^\d{1,2}$/.test(v) && ctx.part === "month") {
      const m = parseInt(v, 10);
      const name = MONTHS[m - 1];
      const hit = opts.find(o => o.n === name || o.n === name.slice(0, 3) || o.n.replace(/^0/, "") === String(m) || o.n.startsWith(name));
      if (hit) return hit.i;
    }

    // Phone type: Mobile ↔ Cell
    if (key === "phoneType") {
      const mobile = /mobile|cell/.test(v);
      const hit = opts.find(o => mobile ? /mobile|cell/.test(o.n) : o.n.includes(v));
      if (hit) return hit.i;
    }

    // Field of study: a shared generic word ("Science", "Engineering") is not a match.
    // Take only an option that has every word of the wanted major, with the fewest
    // extra words ("Computer Science" -> "Computer and Information Science", never
    // "Actuarial Science"). Nothing qualifies -> no pick; a blank beats a wrong major.
    if (key === "edu.major") {
      const STOP = new Set(["and", "of", "the", "in", "for", "with"]);
      const words = (t) => norm(t).split(" ").filter(w => w.length > 1 && !STOP.has(w)).map(sing);
      let pick = -1, fewest = Infinity;
      for (const a of alts) {
        const want = words(a);
        if (!want.length) continue;
        for (const o of opts) {
          const have = words(o.t);
          if (!want.every(w => have.includes(w))) continue;
          const extra = have.length - want.length;
          if (extra < fewest) { fewest = extra; pick = o.i; }
        }
      }
      return pick;
    }

    // Starts-with / contains
    for (const a of alts) {
      if (a.length < 2) continue;
      const sw = opts.find(o => o.n.startsWith(a + " ") || a.startsWith(o.n + " "));
      if (sw) return sw.i;
    }
    for (const a of alts) {
      if (a.length < 3) continue;
      const inc = opts.filter(o => o.n.includes(a) || (o.n.length >= 3 && a.includes(o.n)));
      if (inc.length) {
        inc.sort((x, y) => Math.abs(x.n.length - a.length) - Math.abs(y.n.length - a.length));
        return inc[0].i;
      }
    }

    // Token overlap
    let best = -1, bestScore = 0;
    for (const o of opts) {
      const s = Math.max(...alts.map(a => overlap(o.t, a)));
      if (s > bestScore) { bestScore = s; best = o.i; }
    }
    return bestScore >= 0.5 ? best : -1;
  }

  // ---------------------------------------------------------------------------
  // Date helpers. Profile dates are stored as "YYYY-MM" (from <input type=month>).
  // ---------------------------------------------------------------------------
  function splitDate(s) {
    const m = String(s || "").match(/^(\d{4})-(\d{1,2})/);
    if (m) return { y: m[1], m: String(parseInt(m[2], 10)) };
    const y = String(s || "").match(/\b(19|20)\d{2}\b/);
    return y ? { y: y[0], m: "" } : null;
  }

  function formatDate(s, part, el) {
    const d = splitDate(s);
    if (!d) return "";
    const mm = d.m ? d.m.padStart(2, "0") : "01";
    if (part === "year") return d.y;
    if (part === "month") return d.m;
    if (el && el.type === "month") return `${d.y}-${mm}`;
    if (el && el.type === "date") return `${d.y}-${mm}-01`;
    const ph = norm((el && (el.placeholder || el.getAttribute("aria-placeholder"))) || "");
    if (/^yyyy mm/.test(ph)) return `${d.y}-${mm}`;
    if (/^mm dd yyyy/.test(ph)) return `${mm}/01/${d.y}`;
    if (/^yyyy$/.test(ph)) return d.y;
    return `${mm}/${d.y}`;
  }

  window.__JAF_M = { version: VER, norm, RULES, keyAllowsKind, FILE_RULES, bestOption, strictOption, skillPlan, skillScore, skillOption, yesNoOf, formatDate, splitDate, US_STATES, STATE_BY_NAME, MONTHS, isPlaceholderOpt };
})();

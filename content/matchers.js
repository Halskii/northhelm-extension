// Job Autofill — field matching rules and option-matching helpers.
// Loaded before adapters.js and filler.js; exposes window.__JAF_M.
(() => {
  if (window.__JAF_M) return;

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
    R("__skip", "any", /captcha|password|social security|\bssn\b|date of birth|birth ?date|\bdob\b|signature|initials|e-?sign|today'?s date|date signed|security question|bank|routing|credit card/, /captcha|password|ssn|birth|signature|honeypot/),
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
    R("skills", "any", /^skills|technical skills|key skills|list (your )?skills/, /skills/)
  ];

  // Which kinds of form control each key may fill. Keys not listed accept any
  // single-value control (text, select, radio, combobox…) but never textarea.
  const LONG_KEYS = new Set(["coverLetterText", "summary", "skills", "job.description", "address1"]);
  const BOOL_KEYS = new Set(["job.current"]);
  function keyAllowsKind(key, kind) {
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

  window.__JAF_M = { norm, RULES, keyAllowsKind, FILE_RULES, bestOption, yesNoOf, formatDate, splitDate, US_STATES, STATE_BY_NAME, MONTHS, isPlaceholderOpt };
})();

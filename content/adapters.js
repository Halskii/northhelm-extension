// Job Autofill — per-site adapters. The generic engine in filler.js handles any
// form; adapters add exact field hints and site-specific steps (e.g. Workday's
// "Add" buttons for work history). Exposes window.__JAF_ADAPTERS.
(() => {
  if (window.__JAF_ADAPTERS) return;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

  // hints: [selector, key]. Checked before the generic label rules.
  const ADAPTERS = [
    {
      name: "Workday",
      test: (u) => /myworkdayjobs\.com|myworkdaysite\.com|workday\.com/.test(u.hostname),
      hints: [
        ['[data-automation-id="legalNameSection_firstName"], [id$="legalName--firstName"]', "firstName"],
        ['[data-automation-id="legalNameSection_middleName"], [id$="legalName--middleName"]', "middleName"],
        ['[data-automation-id="legalNameSection_lastName"], [id$="legalName--lastName"]', "lastName"],
        ['[data-automation-id="preferredNameSection_firstName"], [id$="preferredName--firstName"]', "preferredName"],
        ['[data-automation-id="addressSection_addressLine1"], [id$="address--addressLine1"]', "address1"],
        ['[data-automation-id="addressSection_addressLine2"], [id$="address--addressLine2"]', "address2"],
        ['[data-automation-id="addressSection_city"], [id$="address--city"]', "city"],
        ['[data-automation-id="addressSection_postalCode"], [id$="address--postalCode"]', "zip"],
        ['[data-automation-id="addressSection_countryRegion"], [id$="address--countryRegion"]', "state"],
        ['[data-automation-id="addressSection_regionSubdivision1"], [id$="address--regionSubdivision1"]', "county"],
        ['[data-automation-id="countryDropdown"], [id$="country--country"]', "country"],
        ['[data-automation-id="email"], [id$="emailAddress--emailAddress"]', "email"],
        ['[data-automation-id="phone-number"], [id$="phoneNumber--phoneNumber"]', "phone"],
        ['[data-automation-id="phone-device-type"], [id$="phoneNumber--phoneType"]', "phoneType"],
        ['[data-automation-id="countryPhoneCode"], [id$="phoneNumber--countryPhoneCode"]', "phoneCountryCode"],
        ['[data-automation-id="phone-extension"], [id$="phoneNumber--extension"]', "phoneExtension"],
        ['[data-automation-id="sourceDropdown"], [id$="source--source"]', "howHeard"],
        ['[data-automation-id="jobTitle"], [id*="workExperience-"][id$="--jobTitle"]', "job.title"],
        ['[data-automation-id="company"], [id*="workExperience-"][id$="--companyName"]', "job.company"],
        ['[data-automation-id="location"], [id*="workExperience-"][id$="--location"]', "job.location"],
        ['[data-automation-id="currentlyWorkHere"], [id*="workExperience-"][id$="--currentlyWorkHere"]', "job.current"],
        ['[data-automation-id="description"], [id*="workExperience-"][id$="--roleDescription"]', "job.description"],
        ['[data-automation-id="formField-startDate"] input, [id*="workExperience-"][id*="--startDate-"]', "job.start"],
        ['[data-automation-id="formField-endDate"] input, [id*="workExperience-"][id*="--endDate-"]', "job.end"],
        ['[data-automation-id="school"], [id*="education-"][id$="--schoolName"], [id*="education-"][id$="--school"]', "edu.school"],
        ['[data-automation-id="degree"], [id*="education-"][id$="--degree"]', "edu.degree"],
        ['[data-automation-id="field-of-study"], [id*="education-"][id$="--fieldOfStudy"]', "edu.major"],
        ['[data-automation-id="gpa"], [id*="education-"][id$="--gradeAverage"]', "edu.gpa"],
        ['[data-automation-id="formField-firstYearAttended"] input, [id*="education-"][id*="--firstYearAttended-"]', "edu.start"],
        ['[data-automation-id="formField-lastYearAttended"] input, [id*="education-"][id*="--lastYearAttended-"]', "edu.end"],
        ['[data-automation-id="linkedinQuestion"], [id*="socialNetworkAccounts--linkedInAccount"]', "linkedin"],
        ['[data-automation-id="file-upload-input-ref"], input[type="file"][data-automation-id*="file"]', "resumeFile"]
      ],
      // Workday asks for work history and education in repeating blocks that
      // start empty. Click "Add" until there are as many blocks as profile entries.
      async prepare(ctx) {
        if (!ctx.settings.workdayAddEntries) return;
        const sections = [
          { re: /work experience/i, idRe: /workExperience-(\d+)/, count: (ctx.profile.workHistory || []).filter(j => j.company || j.title).length },
          { re: /^education$/i, idRe: /education-(\d+)/, count: (ctx.profile.education || []).filter(e => e.school).length }
        ];
        for (const sec of sections) {
          if (!sec.count) continue;
          for (let guard = 0; guard < 6; guard++) {
            const heading = [...document.querySelectorAll("h2, h3, h4, [role=heading], legend")].find(h => sec.re.test(h.textContent.trim()) && visible(h));
            if (!heading) break;
            const scope = heading.closest('[role="group"], section, fieldset, [data-automation-id]') || heading.parentElement?.parentElement || document.body;
            const ids = new Set([...scope.querySelectorAll("[id]")].map(e => (e.id.match(sec.idRe) || [])[1]).filter(Boolean));
            const blocks = ids.size || scope.querySelectorAll('[data-automation-id^="workExperience-"], [data-automation-id^="education-"]').length;
            if (blocks >= sec.count) break;
            const add = [...scope.querySelectorAll("button")].find(b => visible(b) && /^add( another)?\b/i.test((b.getAttribute("aria-label") || b.textContent || "").trim()));
            if (!add) break;
            add.click();
            await sleep(700);
          }
        }
      }
    },
    {
      name: "Greenhouse",
      test: (u) => /greenhouse\.io/.test(u.hostname) || !!document.querySelector('#application_form, form[action*="greenhouse"], #grnhse_app'),
      hints: [
        ["#first_name", "firstName"], ["#last_name", "lastName"], ["#preferred_name", "preferredName"],
        ["#email", "email"], ["#phone", "phone"],
        ["#candidate-location, #job_application_location, #auto_complete_input", "location"],
        ['#resume, input[type="file"][id*="resume"]', "resumeFile"],
        ['#cover_letter, input[type="file"][id*="cover_letter"]', "coverLetterFile"],
        ['[id^="school--"], [id*="school_name"]', "edu.school"],
        ['[id^="degree--"]', "edu.degree"],
        ['[id^="discipline--"]', "edu.major"],
        ['[id^="start-month--"], [id^="start-year--"]', "edu.start"],
        ['[id^="end-month--"], [id^="end-year--"]', "edu.end"],
        ["#gender", "eeo.gender"], ["#hispanic_ethnicity", "eeo.hispanic"], ["#race", "eeo.race"],
        ["#veteran_status", "eeo.veteran"], ["#disability_status", "eeo.disability"]
      ]
    },
    {
      name: "Lever",
      test: (u) => /lever\.co$/.test(u.hostname) || /jobs\.lever\.co/.test(u.hostname),
      hints: [
        ['input[name="name"]', "fullName"], ['input[name="email"]', "email"], ['input[name="phone"]', "phone"],
        ['input[name="org"]', "currentCompany"], ['input[name="location"]', "location"],
        ['input[name="urls[LinkedIn]"]', "linkedin"], ['input[name="urls[GitHub]"]', "github"],
        ['input[name="urls[Twitter]"]', "twitter"], ['input[name="urls[Portfolio]"]', "portfolio"],
        ['input[name="urls[Other]"]', "website"], ['input[name="resume"]', "resumeFile"],
        ['textarea[name="comments"]', "coverLetterText"],
        ['select[name="eeo[gender]"]', "eeo.gender"], ['select[name="eeo[race]"]', "eeo.race"],
        ['select[name="eeo[veteran]"]', "eeo.veteran"], ['select[name="eeo[disability]"]', "eeo.disability"]
      ]
    },
    {
      name: "Ashby",
      test: (u) => /ashbyhq\.com/.test(u.hostname),
      hints: [
        ['input[name="_systemfield_name"]', "fullName"], ['input[name="_systemfield_email"]', "email"],
        ['input[name="_systemfield_location"]', "location"], ['input[name="_systemfield_resume"], input[id="_systemfield_resume"]', "resumeFile"]
      ]
    },
    { name: "iCIMS", test: (u) => /icims\.com/.test(u.hostname), hints: [] },
    { name: "Taleo", test: (u) => /taleo\.net/.test(u.hostname), hints: [] },
    { name: "Oracle Cloud", test: (u) => /oraclecloud\.com/.test(u.hostname), hints: [] },
    { name: "SuccessFactors", test: (u) => /successfactors\.(com|eu)|sapsf\./.test(u.hostname), hints: [] },
    { name: "SmartRecruiters", test: (u) => /smartrecruiters\.com/.test(u.hostname), hints: [] },
    { name: "Jobvite", test: (u) => /jobvite\.com/.test(u.hostname), hints: [] },
    { name: "BambooHR", test: (u) => /bamboohr\.com/.test(u.hostname), hints: [] },
    { name: "Workable", test: (u) => /workable\.com/.test(u.hostname), hints: [] },
    { name: "JazzHR", test: (u) => /applytojob\.com|jazzhr\.com/.test(u.hostname), hints: [] },
    { name: "Paylocity", test: (u) => /paylocity\.com/.test(u.hostname), hints: [] },
    { name: "UKG", test: (u) => /ultipro\.com|ukg\.(com|net)/.test(u.hostname), hints: [] },
    { name: "ADP", test: (u) => /adp\.com/.test(u.hostname), hints: [] },
    { name: "Rippling", test: (u) => /rippling\.com|rippling-ats\.com/.test(u.hostname), hints: [] },
    { name: "Breezy", test: (u) => /breezy\.hr/.test(u.hostname), hints: [] },
    { name: "Recruitee", test: (u) => /recruitee\.com/.test(u.hostname), hints: [] },
    { name: "Teamtailor", test: (u) => /teamtailor\.com/.test(u.hostname), hints: [] },
    { name: "Dayforce", test: (u) => /dayforcehcm\.com/.test(u.hostname), hints: [] },
    { name: "LinkedIn Easy Apply", test: (u) => /linkedin\.com/.test(u.hostname), hints: [] },
    { name: "Indeed", test: (u) => /indeed\.com/.test(u.hostname), hints: [] }
  ];

  const GENERIC = { name: "generic", hints: [] };

  function detect(loc = location) {
    for (const a of ADAPTERS) {
      try { if (a.test(loc)) return a; } catch (_) {}
    }
    return GENERIC;
  }

  window.__JAF_ADAPTERS = { ADAPTERS, detect };
})();

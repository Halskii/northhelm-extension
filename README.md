# Job Autofill (Chrome extension)

Fills job applications from one saved profile. It works on any application form, with extra handling for Workday, Greenhouse, Lever and Ashby, and generic support for iCIMS, Taleo, Oracle, SuccessFactors, SmartRecruiters, Jobvite, BambooHR, Workable, JazzHR, Paylocity, UKG, ADP, Rippling, LinkedIn Easy Apply, Indeed and others. **It never clicks Submit or Next.** You review the form and send it yourself.

## Install (about 1 minute)
1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose this repository's folder (the one that contains `manifest.json`).
3. After pulling changes or editing files, click the reload icon on the extension's card.
4. The profile page opens the first time. Fill it in and upload your resume. It saves as you type.
5. Pin it: click the puzzle-piece icon, then the pin next to Job Autofill.

## Use
- On an application page, press **Alt+Shift+F**, click the toolbar icon and choose **Fill this application**, or right-click the page and choose **Fill job application**.
- Green outline: filled. Orange outline: needs your answer (a required question it doesn't know, a consent box, or a dropdown that had no match).
- On multi-page forms like Workday, run it again on each page.
- On Workday it clicks **Add** under Work Experience and Education until there's one block per entry in your profile.
- Fields that already have text are left alone. Turn on **Overwrite** in the popup to change that.

## Profiles
You start with one profile. To add another, such as one for non-tech jobs, click **+ New profile** at the top of the profile page:
- Name it, then choose **Copy all info from** (your first profile is preselected) or **Start blank**.
- Copying brings over everything except the resume and cover letter files, so you don't send the wrong resume by accident. Tick **Also copy the resume and cover letter files** if you want those too.
- The new profile opens with its Resume section highlighted, ready for you to upload a different file.
- **Rename** and **Delete** are next to it. You can't delete your last profile.

When you have more than one profile, the popup shows a **Fill as** dropdown, and right-clicking a page shows **Fill job application → your profile names**. The keyboard shortcut uses whichever profile you picked last. **Export** saves all profiles and their files to one file, and **Import** adds them alongside the profiles you already have.

## Fill your profile faster
- **From Chrome's saved info:** on the profile page, click **First name** or **Street address**. Chrome shows its autofill dropdown with your saved addresses. Pick one to fill your name, email, phone and address at once. Manage the saved entries at `chrome://settings/addresses`.
- **From your resume (AI):** upload a resume (PDF, .docx, .txt or .rtf), then click **✨ Fill profile from resume**. The resume's text is extracted in the browser and sent to Claude Haiku. You then see what was found and tick which sections to apply: name and contact, links, work history, education, and summary/skills. Your GPA is kept if the resume doesn't list one.

### Setting up the AI resume reader
1. Copy `.env.example` to `.env` in this folder.
2. Set `ANTHROPIC_API_KEY=sk-ant-...`. You can optionally set `ANTHROPIC_MODEL`; the default is `claude-haiku-5-5`.
3. Reload the extension at `chrome://extensions`. On the profile page, the **AI resume reader** section shows whether the key was found, and **Test connection** checks it.

`.env` is git-ignored. The extension reads it from its own folder, and web pages can't. Each read costs a small amount of API usage on your Anthropic account. Your resume text goes to Anthropic; nothing else leaves your computer.

## Custom answers
Under **Custom answers** on the profile page you can add rules like `security clearance → No` or `/willing to travel|travel required/ → Yes`. If a question contains the text on the left, the answer on the right is used. These rules are checked before anything else, so use them to teach the extension a site's odd questions.

## What it deliberately doesn't do
- Passwords, account creation, date of birth, SSN, signatures, CAPTCHAs.
- Checking "I agree / I certify / privacy policy" boxes. Those are outlined for you to check yourself.
- Demographic and EEO questions, unless you turn that on in **Self-ID** and set your answers.
- Submitting the application.

## Privacy
Everything is stored in `chrome.storage.local` on your computer. The only network request the extension makes is the optional AI resume read, which sends your resume text to Anthropic's API when you click the button.

## Files
- `manifest.json`: extension config (Manifest V3).
- `background.js`: shortcut, right-click menu, and sending the fill command to every frame (iCIMS and Taleo forms live in iframes).
- `content/matchers.js`: question-to-profile rules and dropdown option matching (states, countries, degrees, yes/no and so on).
- `content/adapters.js`: per-site selectors plus Workday's "Add entry" step.
- `lib/resume-text.js`: gets text out of PDF, DOCX, TXT and RTF resumes. PDFs use pdf.js, in `lib/vendor`, Apache-2.0.
- `options/resume-ai.js`: the AI resume reader (Claude call, review dialog, applying the results).
- `lib/store.js`: profile storage, shared by every part of the extension.
- `content/filler.js`: the engine. It finds fields (including inside shadow DOM), reads labels, detects the work-history and education sections, and sets values in a way React and Workday accept.
- `options/`: profile page.
- `popup/`: toolbar popup.

## When a site doesn't fill right
1. Add a **Custom answer** for that question.
2. If a whole site is off, open DevTools on the page, run `__jobAutofill._collect()` in the console with the extension's content-script context selected, and see what label each field got. Then add a selector to that site's `hints` in `content/adapters.js`.
3. After editing a file, click the reload icon on the extension's card in `chrome://extensions`.

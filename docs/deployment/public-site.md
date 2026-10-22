# Running a public site

AnnZarro is software. If you put it on the internet, you are the operator of that site: the legal
duties that come with a website (who runs it, what it does with visitors' data, whether disabled
people can use it) are yours, not those of the people who wrote AnnZarro. This page lists those
duties, says what AnnZarro itself stores and sends so that you can describe it truthfully, and
shows the settings that put your texts on every page.

```{admonition} Not legal advice
This page is an engineering summary of public sources, last checked in October 2026. Laws differ
by country and change. Have your institution's data protection officer or counsel approve the
texts you publish. The templates below are starting points, not finished notices.
```

Run a server that is reachable only by your own lab? Then most of this does not apply, and
{doc}`hosting-checklist` is the page to use. Read on when strangers can open your address.

## Who is responsible

| Party | Role | Duties |
|---|---|---|
| You (lab, institute, university, company) | Controller under the GDPR (Art. 4(7)); service provider in German law (DDG §2, §5) | Imprint, privacy notice, a legal basis for the logs, retention, a contact for data protection, accessibility, licences of the data you show, security |
| Your hosting provider or university IT | Usually a processor (GDPR Art. 28) | A data processing agreement with you |
| The services the visitor's browser contacts, for example STRING or Enrichr in the Gene Set panel | Separate controllers | You share responsibility for the transmission you trigger (CJEU C-40/17, *Fashion ID*), so you need a legal basis and must inform your visitors |
| The AnnZarro authors | Software publisher | None for your site. AnnZarro processes as little as it can by default, documents what it does, and gives you the switches below |

## What a public site owes its visitors

"Applies" says when the duty starts. Where the source column is empty, it is good practice, not law.

| Duty | Where | Applies when | What to do |
|---|---|---|---|
| **Imprint**: name and postal address, legal form and authorised representative of an organisation, e-mail **and** a second fast way to reach you (telephone or contact form), register number and VAT ID where you have them | Germany: DDG §5(1) (replaces TMG §5 since 14 May 2024); MStV §18(1) | Any site that is not purely personal or family use. §18(1) MStV reaches essentially every institutional site, even free and non-profit ones | Set `site.imprint` (below). Public universities usually point to the central imprint page |
| Imprint reachable at once and always | BGH 20 July 2006, I ZR 228/03: a link labelled "Impressum" or "Kontakt", at most two clicks away | With the imprint duty | AnnZarro's footer puts the link on every page, one click away. German sites label it **Impressum** |
| Person responsible for editorial content | MStV §18(2) | Only if you publish journalistic-editorial content (news, a blog). A data viewer rarely does | Add name and address of that person to the imprint |
| Provider information | Austria: ECG §5, MedienG §25. EU: e-Commerce Directive Art. 5 (national law decides) | Commercial online services | Same imprint text |
| **Privacy notice**: who is responsible, contact of the data protection officer, purposes and legal basis, recipients, transfers outside the EU, retention, rights, right to complain | GDPR Art. 12 and 13; UK GDPR; Switzerland: revFADP Art. 19 | Any site. Server logs with IP addresses are enough to trigger it | Set `site.privacy` (templates below) |
| Privacy link visible on every page | Transparency guidelines WP260 (endorsed by the EDPB), under a common term such as "Privacy" or "Datenschutz" | With the privacy notice | The footer does this |
| Data protection officer | GDPR Art. 37 | Public bodies, including public universities | Give their contact in the notice |
| Legal basis for access logs | GDPR Art. 6(1)(f), or 6(1)(e) for public bodies | Always | Choose a retention period (7 to 30 days is common) |
| Consent for storage in the browser, unless strictly necessary | Germany: TDDDG §25. EU: ePrivacy Directive Art. 5(3). UK: PECR reg. 6. Switzerland: information and opt-out (FMG Art. 45c) | Any cookie or local storage | AnnZarro stores only exempt data, so no banner is needed (see [below](#no-banner)). Adding tracking changes this |
| Accessibility statement and conformance with WCAG 2.1 AA / EN 301 549 | EU: Directive 2016/2102 (public bodies; Germany: BGG §12a, BITV 2.0) | Public sector bodies | See [Accessibility](#accessibility-status) |
| WCAG 2.1 AA for web content | USA: ADA Title II rule (28 CFR 35 Subpart H) for state and local government, including public universities; HHS Section 504 rule (45 CFR 84.84) for recipients of HHS funding, including NIH-funded institutions | Those entities | See [Accessibility](#accessibility-status) |
| Dataset licence and attribution | The data's licence, for example CC BY 4.0 §3(a) | When a licence asks for it | Name licence, citation and source for every dataset you show ([Dataset information and attribution](#dataset-information-and-attribution)) |
| Lawful publication of the data | GDPR Art. 9; NIH Genomic Data Sharing Policy | Human donor data | See [Human data](#human-data) |
| Terms of use, "research use only, not for clinical decisions" | none | Good practice | Set `site.terms` |
| `security.txt`, `robots`/`noindex` | RFC 9116, RFC 9309 | Good practice | `site.security_contact`, `site.robots` |

Not covered because they rarely apply to a research data viewer: CCPA/CPRA (for-profit businesses
above revenue and data thresholds; universities and non-profits are outside it, companies hosting
an atlas may be inside), the European Accessibility Act (consumer products and services such as
e-commerce and banking), and notice-and-action duties of the Digital Services Act (hosting of
content users provide; a login site where users save panel sets that others can see is an edge
case, a curated public atlas is not).

## What AnnZarro stores and sends

### Cookies

A site without login sets **no cookie at all** (a test checks this). With login on, the server
sets two, both first party and strictly necessary:

| Cookie | Set when | Holds | Lifetime |
|---|---|---|---|
| `session` | You sign in | The signed login: user, admin flag, login time, last activity, request token | Until the browser closes; the server ends it after `auth.session_timeout` (8 hours) idle. HttpOnly, SameSite=Lax, Secure over HTTPS |
| `annzarro_login_csrf` | The sign-in form is shown | A random token that protects the form | 10 minutes. HttpOnly, SameSite=Strict |

### Browser storage

Everything is first party, stays in the visitor's browser, is never sent to the server and is never
used to track anyone. "Choice" means the visitor made it; "convenience" means AnnZarro keeps it
unasked and can be set to session-only (`site.storage.persistent_convenience: false`).

| Key | Holds | Kind |
|---|---|---|
| `annzarro-theme` | Light, dark or system | Choice |
| `annzarro.pins:<origin>\|<user>` | Datasets the visitor pinned | Choice |
| `annzarro.subsetSize:<origin>\|<user>` | The chosen subset size, in session storage: kept for the tab (a reload keeps it), dropped at a fresh visit to the bare address | Choice |
| `annzarro_session_style` | The plot look the visitor made the session default (the look of plots on Default), in session storage: kept for the tab (a reload keeps it), dropped at a fresh visit | Choice |
| `annzarro.structure-search` | The regex and case switches of the Dataset information search | Choice |
| `annzarro:external-ok` | The visitor's "Always" or "Never" for each external service of the Gene Set panel | Choice (it stores a consent decision) |
| `annzarro_autosave` (`ui.autosave.storage_key`) | The panel layout, dataset and focus, offered (or restored) at the next visit | Convenience |
| `annzarro_last_sessions` | Earlier autosaved sessions (up to three), offered as last sessions | Convenience |
| `annzarro_restoring` | A marker that a session was being restored, so one that did not finish (the tab ran out of memory) is not restored by itself again | Technical |
| `annzarro.recents:<origin>\|<user>` | Recently opened dataset paths | Convenience |
| `annzarro.recentDatasets:<origin>` | The older, per-origin form of the recents list, moved to the key above at first use | Convenience |
| `annzarro.listings:<origin and prefix>\|<user>` | The dataset listings the dataset browser read last (the first page of the data directory and of each folder opened, at most 40 listings), shown at once when the browser opens while it reads them again | Convenience |
| `annzarro_memory_pending`, `annzarro_memory_margin` | A marker that a heavy action was under way and the memory margin learned from it for actions of about that size, so a tab that ran out of memory is not repeated; forgotten after a week, when an action that large succeeds, or with **Reset the margin** | Technical |

"Close all panels" with its checkbox clears all of it, and the browser's own settings do too.
Session storage holds only the chosen subset size and the default plot look (and, on a site set to session-only, the
convenience items); nothing is written to IndexedDB, Cache Storage or a service worker. The tab's
own history entry holds a random id of the page that is not kept anywhere else, so that a reload of
the tab is told apart from a fresh visit.
A test lists these keys and fails when one is added without being described here.

Under the reading of the ePrivacy rules that most authorities share, choices the visitor made and
what is strictly needed for the service they asked for need no consent. The convenience items
(the autosave, the last sessions, the recents and the dataset listings) are grey: they are written automatically and
kept between visits. The risk is low (nothing leaves
the browser, there is no third party, no tracking value), and a cautious operator can remove it:

```yaml
site:
  storage:
    persistent_convenience: false   # the autosave, last sessions, recents and dataset listings last only until the tab closes
```

An earlier visit's autosave, last sessions, recents and dataset listings are then forgotten at the next load.

A new visit lists the last session and draws it only on **Restore**; a reload of the tab restores
it (`ui.autosave.auto_restore: reload`, the default). `never` only lists it, for a reload too;
`always` restores it at every visit:

```yaml
ui:
  autosave:
    auto_restore: never   # reload (default), always or never
```

(no-banner)=
### No analytics, no cookie banner

AnnZarro has no analytics, no advertising, no social-media widgets and no tracking of any kind,
and it ships no cookie banner because it needs none. **If you add any of these** (an analytics
script, an embedded video, a font from another server), you become responsible for the consent
and the privacy notice that goes with it. The one place a deployer can inject such content is
`branding.contact_info.custom_html` on the sign-in page; the server logs a warning at start when it
contains a script, iframe, embed or an address on another server.

### Requests to other servers

* **The page itself.** All styles, scripts and fonts are served from your own server (Bootstrap,
  Font Awesome, jQuery, DataTables, Plotly). No CDN, no external fonts, no external images. The
  Content-Security-Policy allows connections to the server itself, `data:` and `blob:` only, plus
  the hosts the Gene Set panel is allowed to use. A test keeps it that way.
* **The Gene Set panel**, from the visitor's browser, only after the visitor agrees (setting
  `integrations.external_requests: ask`, the default): STRING, g:Profiler (University of Tartu),
  MyGene.info, Enrichr, Reactome and the Human Protein Atlas. Each receives the gene list, the species
  and **the visitor's IP address**. Enrichr keeps every list it receives and anyone can read it by
  its number; Reactome keeps results under a token that can be guessed. The consent prompt says
  all of this and links each service's privacy policy. Some of these services are outside the EU,
  which is a transfer under GDPR chapter V. With `external_requests: "on"` on a shared server
  nobody is asked, so you need another legal basis and must tell visitors beforehand; the server
  logs a warning at start. With `"off"` or `"none"` nothing is sent.
* **Links** to documentation, GitHub, DOIs and gene databases are ordinary links: nothing is sent
  until a visitor clicks, and no referrer goes along.
* **Your server.** Remote stores (`s3://`, `https://`) are read by the server from an allow-list;
  no visitor data goes with those requests. There is no telemetry and no update check.

### Data on the server

| Data | Where | Personal? | Kept |
|---|---|---|---|
| Access log: IP address, time, method, address requested (which names the dataset), status, referrer, browser identifier | gunicorn's access log on standard error | Yes (IP addresses are personal data, CJEU C-582/14) | As long as your log setup keeps it. AnnZarro sets none |
| Application log: user names at sign-in, IP addresses of refused sign-ins and requests | `server.log_file` or standard error | Yes | No rotation in the app |
| Sign-in lock-out (5 failures per user and address) | Memory | Yes, briefly | 15 minutes |
| Users file: user name, password hash, admin flag | `auth.user_file` | Yes | Until you delete the user |
| Admin audit log: time, admin, IP address, action | State directory | Yes | Rotates at 50 MB, five files kept |
| Panel sets: owner, name, dataset, layout; other users can see them | `<state dir>/panel-sets/` | Yes (owner) | Until deleted |
| The datasets | Data directory | Possibly | Your decision, see [Human data](#human-data) |

Choose a retention period for the logs, write it into the notice, and rotate or delete accordingly.

## Configuring the site

Everything is under `site:` in your configuration file (`annzarro config show` prints the merged
result), and a server with login on can also set it on its admin page ([below](#admin-public-site)).
On the desktop app and a personal server nothing shows until something is set; a server other
people reach shows two links of its own ([below](#hosted-defaults)). Each of the four texts (`imprint`, `privacy`,
`accessibility`, `terms`) takes one of:

| Key | Meaning |
|---|---|
| `url` | A link to a page you already have: `http://`, `https://` or `mailto:`. Wins over the others |
| `markdown` | The text itself, written in the configuration |
| `file` | The path of a Markdown file, read at start (256 KB at most) |
| `label` | The link text. Defaults: Imprint, Privacy, Accessibility, Terms of use. German sites: `Impressum`, `Datenschutz`, `Barrierefreiheit` |

Other keys:

| Key | Default | Meaning |
|---|---|---|
| `operator` | none | One line, "Example Institute, University of X", shown in About |
| `contact` | none | An e-mail address or an `http(s)` address. Falls back to `branding.contact_info.email` in About |
| `contact_label` | `Contact` | The link text. German sites: `Kontakt` |
| `footer_links` | `auto` | `auto`: a footer line on every page. `about-only`: only the About dialog (the server warns, because German and EU guidance expect the links on every page of a public site) |
| `robots` | `auto` | `auto`: search engines are told to stay away when login is on, and may index a login-free site. `index`, `noindex` force either. `noindex` sends `X-Robots-Tag: noindex, nofollow` and serves a `/robots.txt` that disallows everything |
| `security_contact` | none | A `mailto:` or `https://` address. Serves `/.well-known/security.txt` (RFC 9116). The file must sit at the root of your domain, so a proxy that mounts AnnZarro under a path has to pass this one through |
| `languages` | `en` | The language of the texts (`de`, `en`): the `lang` of the text pages and `Preferred-Languages` in `security.txt` |
| `software_credits` | `true` | Whether the About dialog keeps AnnZarro's credit: the Setty Lab logo, the Setty Lab and Fred Hutch links, the NIH funding statement and the citation. `false` leaves the name, the version, the MIT licence and links to the documentation and the repository. The credit is about the software, never about your site, and the authors appreciate hosters keeping it beside their own content |
| `fred_hutch_logo` | `false` | `true` shows the Fred Hutch logo with the AnnZarro sign post across the About dialog, under the credit line (in the dark theme on a white plate); the Setty Lab logo then sits beside the funding statement below it. `false` credits "the Setty Lab at Fred Hutch Cancer Center" in text only. The logo is Fred Hutch's trademark, used with permission, and approved for the desktop app, which turns this on itself, and for copies Fred Hutch runs; leave it `false` on your own site. It needs `software_credits`. See {doc}`../reference/license` |
| `storage.persistent_convenience` | `true` | `false` keeps the autosave, the last sessions, the recents and the dataset listings only until the tab closes |

A wrong value (a `javascript:` address, a missing file, an unknown option) stops the server at
start and says what is wrong.

(admin-public-site)=
### On the admin page

With login on, the admin page (`/admin`, {doc}`admin`) has a **Public site** section that edits
every key above while the server runs. Each field has a help on hover (what it does and where it
shows) and a link to this guide; a Markdown text has a live preview, drawn by the same safe
renderer as the footer and About, in a sandboxed frame, so a `<script>` in the text is shown as
text. A checklist at the top says which of imprint, privacy notice, contact and accessibility
statement are set.

* **Applies at once.** The footer, About, `/site/*`, `robots.txt` and `security.txt` show a saved
  change on the next request, in every worker, without a restart.
* **The same checks as at start.** The page refuses exactly what would stop the server at start
  (a `javascript:` address, a label with markup, two lines of operator), with the same sentence
  under the field, and stores nothing of a change that has one wrong value.
* **Precedence.** What the page saves goes into the admin overlay (`annzarro_admin/overlay.json`,
  beside the users file) and wins over your configuration file. **Reset to config file** (**Reset to
  default** where the file sets nothing) removes it, and the file's value, or the default, applies
  again. To keep a key in the file's hands, lock it:

  ```yaml
  policy:
    locked: [site.imprint, site.privacy]   # shown read-only on the admin page, with its source
  ```

* **What is in effect.** Each text says what the pages show and where it comes from (the config
  file, set here, or the default); a text the config file reads from a `file` shows its path and
  the text as the pages show it. When a value set here wins over the file, the card says what the
  file has.
* **Only what you change is saved.** Save sends the fields you changed and nothing else. Looking at
  another option of a text, or choosing a link or a text and leaving its field empty, changes
  nothing. **Not shown** over a text from the config file is a deliberate override: the card says
  "Hides the text from the config file", and **Reset to config file** shows the file's text again.
* **Files stay in the file.** `file` can only be set in the configuration file: a page anyone can
  open must not publish a file the browser named on the server. The admin page shows the path
  read-only; choosing a link or a text there overrides it.
* Changes are audited as `policy.update`, like the Settings page's.

The keys are `site.imprint`, `site.privacy`, `site.accessibility`, `site.terms`, `site.operator`,
`site.contact`, `site.contact_label`, `site.footer_links`, `site.robots`, `site.security_contact`,
`site.languages`, `site.software_credits`, `site.fred_hutch_logo` and `site.storage.persistent_convenience`.

(hosted-defaults)=
### What a hosted server shows by default

A server other people reach (login on, `server.hosted: true`, a host other than loopback or a
proxy in front) differs from a personal one in three ways, configured or not:

* Its **footer** always starts with **About** and has **Data & privacy** before the contact:
  "About · Impressum · Datenschutz · Data & privacy · Kontakt", and "About · Data & privacy" when
  nothing is configured. About opens the About dialog on the main page and `/site/about` elsewhere.
  `footer_links: about-only` removes the line.
* **`/site/data`, Data & privacy**, is generated from the running configuration and true on any
  server: what the browser keeps (the table under [Browser storage](#browser-storage), and whether
  the convenience items last beyond the tab), the two cookies when login is on and none otherwise,
  what the Gene Set panel may send to which services and when (`integrations.external_requests`
  and the services the server offers), that there are no analytics and no tracking, and that the
  server receives each visitor's IP address. When no privacy notice is configured it says plainly
  that it **is not a privacy notice** and that the operator has not published one here; when one
  is, it links it. It never names an operator you did not configure. The page exists on every
  server; only a hosted one links it from the footer.
* At start, a hosted server with **neither an imprint nor a privacy notice** logs one warning that
  names the admin page's Public site section and this guide.

The desktop app and a personal server on loopback with login off show no footer until you
configure something.

### Where the texts appear

* A small **footer line**, centred at the bottom of every page, including the sign-in, account and
  admin pages: "Impressum · Datenschutz · Barrierefreiheit · Kontakt", with About and Data &
  privacy on a hosted server. It takes a line of about 1.4 rem from the bottom of the window and
  never covers a panel. On a personal server nothing appears when nothing is configured.
* The **About dialog** (the app name at the top left) gets a "This site" block above AnnZarro's own credit: the operator, the
  contact, and each text. A footer link for a text written in the configuration opens About
  straight at that text, so it is one click away; a link to an address opens it in a new tab.
* **`/site/imprint`, `/site/privacy`, `/site/accessibility`, `/site/terms`** serve the same texts
  as plain pages that need no sign-in and no JavaScript, so you can link them from outside. A text
  configured with a `url` redirects there.
* **`/site/about`** is the About dialog as a page (the site's block and AnnZarro's credit), and
  **`/site/data`** the Data & privacy page above. Neither needs a sign-in.

Texts are written in a small, safe subset of Markdown: paragraphs, headings (`#` to `######`),
lists (`-` or `1.`), `**bold**`, `*italic*`, `` `code` ``, links `[text](https://...)` with
`http://`, `https://` or `mailto:`, bare web addresses (`https://...`, `<https://...>`), pipe tables, fenced or indented code blocks, horizontal rules and
block quotes (`>`). A line ending in two spaces or a backslash breaks. Raw HTML,
images and scripts are not possible: they are shown as text. This keeps a text from a file or a
configuration that someone else edited from running anything in your visitors' browsers.

### An example, in German

```yaml
site:
  operator: "Beispielinstitut, Universität X"
  contact: "kontakt@example.org"
  contact_label: "Kontakt"
  languages: "de"
  imprint:
    label: "Impressum"
    file: /etc/annzarro/impressum.md
  privacy:
    label: "Datenschutz"
    url: "https://www.example.org/datenschutz"      # the university's central notice
  accessibility:
    label: "Barrierefreiheit"
    file: /etc/annzarro/barrierefreiheit.md
  security_contact: "mailto:security@example.org"
```

and in English:

```yaml
site:
  operator: "Example Institute, University of X"
  contact: "atlas@example.org"
  imprint:
    markdown: |
      **Example Institute**, University of X
      Main Street 1, 12345 Town
  privacy:
    file: /etc/annzarro/privacy.md
  terms:
    markdown: "Research use only. Not for clinical decisions."
```

### Imprint checklist for Germany

DDG §5(1) asks for, as far as each applies to you:

1. Name and postal address; for an organisation also its legal form and the authorised
   representative (for a public body: the body and its head).
2. E-mail address **and** a second way to reach you quickly and directly: a telephone number or a
   contact form.
3. The supervisory authority, if your activity needs a permit.
4. Register and register number (commercial register, association register).
5. For regulated professions: the chamber, the professional title and the rules.
6. The VAT ID or economic ID, if you have one.

MStV §18(2) adds the name and address of a person responsible for editorial content, only if you
publish such content. A consumer dispute-resolution statement concerns businesses that sell to
consumers, not a research atlas. A skeleton (German, in Markdown):

````markdown
## Angaben gemäß § 5 DDG

**[Name der Einrichtung]**, [Rechtsform]
[Straße Nr.], [PLZ Ort]

Vertreten durch: [Name, Funktion]

## Kontakt

E-Mail: [adresse@example.org]
Telefon: [+49 ...]

## Registereintrag

[Register, Registernummer] (falls vorhanden)

## Umsatzsteuer-Identifikationsnummer

[DE...] (falls vorhanden)

## Verantwortlich für redaktionelle Inhalte (§ 18 Abs. 2 MStV)

[Name, Anschrift] (nur bei redaktionellen Inhalten)
````

(privacy-template-en)=
## Privacy notice template (English)

Paste it into a Markdown file, fill every `[bracket]`, delete what does not apply, and have your
data protection officer read it. It describes what AnnZarro itself processes. Your web server,
proxy, hosting provider, single sign-on or anything you added may process more.

````markdown
## Privacy notice for [site name]

**1. Who is responsible.** [Institution, address, e-mail] ("we") runs this site. Data protection
officer: [name or office, e-mail]. The site runs AnnZarro, open-source software; its authors do not
run this site and receive no data from it.

**2. Visiting the site.** When you open a page your browser sends our server your IP address, the
date and time, the address requested (which names the dataset you open), the result, the address of
the previous page if your browser sends it, and your browser's identifier. We keep this in server
logs [for N days] to run the site and to detect and investigate misuse, and then delete [or
anonymise] it. Legal basis: [Art. 6(1)(f) GDPR, our legitimate interest in a secure and working
service] [for public bodies: Art. 6(1)(e) GDPR with (national provision)].

**3. Signing in** (delete if login is off). If you have an account we store your user name, a hash of
your password and whether you are an administrator. When you sign in your browser keeps a session
cookie that keeps you signed in; it ends when you close the browser or after [8 hours] without
activity. A second cookie protects the sign-in form for 10 minutes. Sign-ins, failed and
successful, are logged with user name and IP address to protect accounts [for N days]. Panel sets
you save are stored with your user name and can be seen by the other users of this site.
Administrators' changes are recorded with their user name and IP address. Legal basis:
[Art. 6(1)(b) GDPR / Art. 6(1)(f) GDPR].

**4. Storage in your browser.** The site keeps the following in your browser's storage. It
never leaves your device, is not shared and is not used to track you: your choice of light or dark
theme; the datasets you pinned; your chosen subset size; your answers to the question whether gene
lists may be sent to outside services (section 5); the layout of your panels, so that you can
continue where you left off; the datasets you opened recently; and a technical marker that protects
the page from running out of memory. You can delete all of it with "Close all", ticking the box
that clears this site's storage, or in your browser's settings. It is needed for the service you
asked for or stores a choice you made, so no consent is asked for (§ 25(2) No. 2 TDDDG, Art. 5(3)
ePrivacy Directive). [If you set `persistent_convenience: false`: the layout and the recently
opened datasets are kept only until you close the tab.]

**5. Outside services in the Gene Set panel** (delete if `external_requests` is `off` or `none`).
The panel can send a list of gene identifiers and the species straight from your browser to the
services below, to look up genes or run an enrichment analysis. Your IP address reaches the service
with every request. Nothing is sent until you agree [for each service, each time / you can answer
"Always"]. Enrichr keeps every list it receives and anyone can read it by its number; Reactome keeps
results under a token that can be guessed. The services are run by others under their own privacy
policies, some outside the EU/EEA: STRING (string-db.org, [operator, country, policy link]),
g:Profiler (University of Tartu, Estonia, [link]), MyGene.info ([operator, country, link]), Enrichr
([operator, country, link]), Reactome ([operator, link]), Human Protein Atlas ([operator, link]).
Legal basis: your consent, Art. 6(1)(a) GDPR [and for transfers to the USA Art. 49(1)(a) GDPR],
which you can withdraw at any time by answering "Never". [If you set `external_requests: "on"`,
rewrite this section: you need another legal basis and must tell visitors before they use the panel.]

**6. Links.** Links to other sites (documentation, gene databases, DOIs) are ordinary links: those
sites receive data only when you click them, and this site does not tell them where you came from.

**7. No tracking.** This site uses no analytics, advertising or social-media tools, loads no fonts,
scripts or images from other servers and sets no third-party cookies. [Change this if you added any.]

**8. The datasets.** [Describe the data, for example: "The datasets shown are de-identified
research data published under [licence]; they contain no information that identifies donors." Your
institution's data governance must confirm this.]

**9. Your rights.** You have the right of access (Art. 15 GDPR), rectification (16), erasure (17),
restriction (18), data portability (20) and to object (21), and to complain to a supervisory
authority, for example [competent authority]. Contact: [data protection officer's e-mail].

**10. Changes.** Last updated [date].
````

(privacy-template-de)=
## Datenschutzerklärung, Vorlage (Deutsch)

Keine Rechtsberatung. Die Vorlage beschreibt, was AnnZarro selbst verarbeitet. Webserver, Proxy,
Hosting, Single Sign-on oder eigene Ergänzungen können mehr verarbeiten. Alle `[Klammern]` ausfüllen,
Unzutreffendes streichen, vor der Veröffentlichung von Ihrer Datenschutzbeauftragten oder Ihrem
Datenschutzbeauftragten prüfen lassen.

````markdown
## Datenschutzerklärung für [Name der Seite]

**1. Verantwortlicher.** [Einrichtung, Anschrift, E-Mail] („wir“) betreibt diese Seite.
Datenschutzbeauftragte(r): [Name oder Stelle, E-Mail]. Die Seite läuft mit AnnZarro, einer
Open-Source-Software; deren Autorinnen und Autoren betreiben die Seite nicht und erhalten keine
Daten von ihr.

**2. Besuch der Seite.** Beim Aufruf einer Seite sendet Ihr Browser an unseren Server Ihre
IP-Adresse, Datum und Uhrzeit, die angeforderte Adresse (sie nennt den geöffneten Datensatz), das
Ergebnis, die Adresse der vorherigen Seite, wenn Ihr Browser sie sendet, und die Kennung Ihres
Browsers. Wir speichern das in Server-Protokollen [für N Tage], um die Seite zu betreiben und
Missbrauch zu erkennen und zu verfolgen, und löschen [oder anonymisieren] es danach.
Rechtsgrundlage: [Art. 6 Abs. 1 lit. f DSGVO, unser berechtigtes Interesse an einem sicheren und
funktionierenden Angebot] [für öffentliche Stellen: Art. 6 Abs. 1 lit. e DSGVO i. V. m.
(Landesvorschrift)].

**3. Anmeldung** (streichen, wenn keine Anmeldung nötig ist). Wenn Sie ein Konto haben, speichern wir
Ihren Benutzernamen, einen Hash Ihres Passworts und ob Sie Administrator sind. Bei der Anmeldung
legt Ihr Browser ein Sitzungs-Cookie an, das Sie angemeldet hält; es endet, wenn Sie den Browser
schließen oder nach [8 Stunden] ohne Aktivität. Ein zweites Cookie schützt das Anmeldeformular für
10 Minuten. Erfolgreiche und fehlgeschlagene Anmeldungen werden mit Benutzername und IP-Adresse
protokolliert, um Konten zu schützen [für N Tage]. Von Ihnen gespeicherte Panel-Sets werden mit
Ihrem Benutzernamen abgelegt und sind für andere Nutzende dieser Seite sichtbar. Änderungen von
Administratoren werden mit Benutzername und IP-Adresse protokolliert. Rechtsgrundlage:
[Art. 6 Abs. 1 lit. b DSGVO / Art. 6 Abs. 1 lit. f DSGVO].

**4. Speicherung in Ihrem Browser.** Die Seite legt Folgendes im Speicher Ihres Browsers ab.
Es verlässt Ihr Gerät nicht, wird nicht weitergegeben und nicht zur Verfolgung Ihres Verhaltens
genutzt: Ihre Wahl zwischen hellem und dunklem Erscheinungsbild; die von Ihnen angehefteten
Datensätze; die gewählte Teilmengengröße; Ihre Antworten auf die Frage, ob Genlisten an externe
Dienste gesendet werden dürfen (Abschnitt 5); die Anordnung Ihrer Panels, damit Sie dort
weitermachen können, wo Sie aufgehört haben; die zuletzt geöffneten Datensätze; und eine technische
Markierung, die verhindert, dass der Browser-Tab den Arbeitsspeicher erschöpft. Sie können alles
über „Close all“ mit dem Häkchen zum Löschen des Speichers dieser Seite oder in den
Einstellungen Ihres Browsers löschen. Es ist für den von Ihnen gewünschten Dienst erforderlich oder
speichert eine von Ihnen getroffene Wahl; eine Einwilligung ist deshalb nicht nötig (§ 25 Abs. 2
Nr. 2 TDDDG). [Bei `persistent_convenience: false`: Anordnung und zuletzt geöffnete Datensätze
bleiben nur bis zum Schließen des Tabs erhalten.]

**5. Externe Dienste im Gene-Set-Panel** (streichen, wenn `external_requests` auf `off` oder `none`
steht). Das Panel kann eine Liste von Genkennungen und die Art direkt von Ihrem Browser an die
folgenden Dienste senden, um Gene nachzuschlagen oder eine Anreicherungsanalyse auszuführen. Ihre
IP-Adresse gelangt mit jeder Anfrage zum Dienst. Es wird nichts gesendet, bevor Sie zustimmen [für
jeden Dienst jedes Mal / Sie können „Immer“ wählen]. Enrichr speichert jede erhaltene Liste, und
jede Person kann sie über ihre Nummer lesen; Reactome speichert Ergebnisse unter einem
erratbaren Kennzeichen. Die Dienste werden von Dritten nach deren eigenen Datenschutzbestimmungen
betrieben, teils außerhalb der EU/des EWR: STRING (string-db.org, [Betreiber, Land, Link]),
g:Profiler (Universität Tartu, Estland, [Link]), MyGene.info ([Betreiber, Land, Link]), Enrichr
([Betreiber, Land, Link]), Reactome ([Betreiber, Link]), Human Protein Atlas ([Betreiber, Link]).
Rechtsgrundlage: Ihre Einwilligung, Art. 6 Abs. 1 lit. a DSGVO [und für Übermittlungen in die USA
Art. 49 Abs. 1 lit. a DSGVO]; Sie können sie jederzeit widerrufen, indem Sie „Nie“ wählen. [Bei
`external_requests: "on"`: Abschnitt umschreiben; Sie brauchen dann eine andere Rechtsgrundlage und
müssen vor der Nutzung des Panels informieren.]

**6. Links.** Links auf andere Seiten (Dokumentation, Gen-Datenbanken, DOIs) sind gewöhnliche Links:
Diese Seiten erhalten nur dann Daten, wenn Sie sie anklicken, und diese Seite teilt ihnen nicht
mit, woher Sie kommen.

**7. Keine Verfolgung.** Diese Seite verwendet keine Analyse-, Werbe- oder Social-Media-Werkzeuge,
lädt keine Schriften, Skripte oder Bilder von anderen Servern und setzt keine Cookies von Dritten.
[Ändern, falls Sie solche ergänzt haben.]

**8. Die Datensätze.** [Beschreiben Sie die Daten, zum Beispiel: „Die gezeigten Datensätze sind
de-identifizierte Forschungsdaten unter [Lizenz]; sie enthalten keine Angaben, die Spenderinnen und
Spender identifizieren.“ Das muss die Datenverwaltung Ihrer Einrichtung bestätigen.]

**9. Ihre Rechte.** Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (16), Löschung
(17), Einschränkung der Verarbeitung (18), Datenübertragbarkeit (20) und Widerspruch (21) sowie das
Recht, sich bei einer Aufsichtsbehörde zu beschweren, zum Beispiel bei [zuständige Behörde].
Kontakt: [E-Mail der oder des Datenschutzbeauftragten].

**10. Änderungen.** Stand: [Datum].
````

(human-data)=
## Human data

Showing human single-cell data with donor information on a public site is the largest legal risk
of a public atlas, and nothing in AnnZarro can lower it. Donor metadata can be health or genetic
data (GDPR Art. 9). Whether a dataset may be published at all, in what form and under which
licence is a question for the data's owner, the consent the donors gave, any data-access agreement
and your ethics board (for US data, the NIH Genomic Data Sharing Policy and controlled or open
access status). Settle that before the dataset is in the data directory, not after.

(accessibility-status)=
## Accessibility

AnnZarro's interface uses native controls, keyboard operation for the main actions and visible
focus rings, and the footer and text pages work without JavaScript. It has **not been audited**
against WCAG 2.1 AA or EN 301 549, and this page makes no conformance claim. The known gap is the
plots: Plotly canvases and WebGL plots have no text alternative beyond the cell and gene tables
beside them, and a data visualisation of this kind usually relies on that equivalent-alternative
argument. Check your own installation before you publish a statement.

Public bodies in the EU must publish an accessibility statement with a feedback contact
(Directive 2016/2102; model statement in Implementing Decision 2018/1523). In the USA the compliance
dates for WCAG 2.1 AA were moved by interim final rules in 2026: **26 April 2027** for state and
local governments with a population of 50,000 or more (28 CFR 35 Subpart H; **26 April 2028** for
smaller ones) and **11 May 2027** for recipients of HHS funding with 15 or more employees (45 CFR 84.84;
**10 May 2028** for the rest). The rules may change again; confirm with your institution. Set
`site.accessibility` to your statement.

(desktop-privacy)=
## The desktop app and app stores

The desktop app is software on one person's computer, not a website: it has no operator, so no
imprint, and the rules for storage in a browser do not apply to what an app writes for its own user.
It keeps everything on the computer and has no analytics, no accounts and no telemetry. It
contacts the network in exactly these cases:

* **Updates.** At launch and then at most once a day it asks github.com for the newest release
  (and downloads one only when the user agrees). GitHub sees the computer's IP address. The user turns it off in the
  menu ("Check for Updates Automatically"); an administrator turns it off for every user with the
  environment variable `ANNZARRO_DISABLE_UPDATES=1`.
* **The Gene Set panel**, when the user chooses a service: gene lists, the species and the IP address
  go to the service the user agreed to, as described above. `ANNZARRO_EXTERNAL_REQUESTS=off` or
  `none` removes this.
* **A dataset opened from a web address** (`https://`, `s3://`) is read from that address.

This statement is also in the About dialog of the desktop app. For a store listing that asks for a
privacy policy address, link this section:
`https://annzarro.readthedocs.io/en/latest/deployment/public-site.html#desktop-privacy`. A desktop
app shows no site footer unless you configure `site` for a server you run yourself.

## Dataset information and attribution

A dataset carries its own licence, citation and description, and AnnZarro shows them to your
visitors: behind the **Dataset information** button next to the open dataset's name (tabs
**About**, **README** and **Structure**, each read from the server only when opened) and in the details pane of the
dataset browser. The text lives in the dataset, so it travels with the store and needs no
configuration. {doc}`dataset-attribution` has every field, the command-line tool and what the server
reads; the rest of this section is what you, as the host, need.

**Licences and attribution are your duty.** AnnZarro displays what a dataset records; it cannot
check that the licence is true, that you may serve the data, or that a citation is right.

- Serve only data you may serve, and meet the licence's conditions. Open licences such as `CC-BY-4.0`
  ask that the creator is credited: give every dataset a `license`, an `attribution` or `citation`,
  and a `doi` or `source_url` where one exists.
- A dataset with no licence is not free to reuse. Say what applies ("All rights reserved, shown
  with the owner's permission") instead of leaving it blank. A dataset that records nothing shows
  "This dataset records no attribution", which is not a licence.
- For human donor data, see [Human data](#human-data) first; a licence field does not settle consent.
- Where you cannot rewrite a store (read-only or remote), state the terms in your own pages (the
  site's `terms` text), and say where each dataset came from.

**Write it into the dataset** as `uns["annzarro"]`, a dictionary (all fields optional: `title`,
`description`, `license`, `license_url`, `citation`, `doi`, `authors`, `source_url`, `contact`,
`attribution`, and richer forms with `contacts`, `funding` and `provenance`; see
{ref}`dataset-info-schema`), and `uns["README"]`, one Markdown string:

```python
import anndata as ad

adata = ad.read_zarr("liver.zarr")
adata.uns["annzarro"] = {
    "schema": "annzarro.dataset-info", "schema_version": "1.0",   # the version marker
    "title": "Liver atlas",
    "license": "CC-BY-4.0",                       # an SPDX identifier, or the licence in words
    "citation": "Doe J, Roe J. A liver atlas. Nature 2026.",
    "doi": "10.1234/abcd",
    "authors": ["Jane Doe", "John Roe"],
    "attribution": "Liver Consortium, 2026",
}
adata.uns["README"] = open("README.md", encoding="utf-8").read()
adata.write_zarr("liver.zarr")
```

For a zarr store that is already written, `annzarro store annotate liver.zarr --license CC-BY-4.0
--doi 10.1234/abcd --readme README.md` writes the same fields without loading the matrices. Datasets
from CZ CELLxGENE Discover show their `uns["title"]` and `uns["citation"]` without any change.

**The README is shown as safe Markdown**, the same subset as the site's texts above: paragraphs,
headings, lists, bold, italic, code, links with an `http://`, `https://` or `mailto:` address (they
open in a new tab), bare web addresses, pipe tables, code blocks, horizontal rules and block quotes
({doc}`dataset-attribution`). Raw HTML is not run: tags appear as the text that was written, as do
images and links with any other address, so a README cannot execute anything on your site. It is
shown up to 256 KB, and the dialog says when it was cut. Read each README before you publish it: every
visitor sees it, and the renderer can keep it harmless but not judge it.

## Sources

GDPR (Regulation (EU) 2016/679) Art. 4, 6, 9, 12, 13, 28, 37, 44 to 49; ePrivacy Directive
2002/58/EC Art. 5(3); DDG §5; MStV §18; TDDDG §25; BGH, 20 July 2006, I ZR 228/03; CJEU C-582/14
*Breyer*, C-40/17 *Fashion ID*, C-673/17 *Planet49*; Article 29 Working Party WP260 and WP194; EDPB
Guidelines 2/2023; ADA Title II rule, 28 CFR 35 Subpart H; HHS Section 504 rule, 45 CFR 84.84;
Directive (EU) 2016/2102; RFC 9116; RFC 9309. Uncertain: how narrowly a given German authority
reads the exemption for the convenience items, the exact UK commencement date of the
2025 changes to PECR, and whether HHS changes the substance of its rule during the extension.

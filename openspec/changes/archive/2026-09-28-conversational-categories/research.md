# Research: Conservative Spanish plural morphological folding for category keyword matching

```yaml
schema: gentle-ai.sdd-research/v1
change: conversational-categories
lane: Conservative Spanish plural morphological folding for category keyword matching
revision: 1
status: done
date: 2026-09-28
```

## 1. Outcome and admission

- **Outcome**: `done` — all five research questions answered with mapped sources.
- **Admission**: capability `gentle-ai.sdd-research-capability/v1` requested by the orchestrator.
  Observed exact grants: `open-web` (websearch + webfetch; used for all external sources S1–S9) and
  `documentation` (repo read-only; used for grounding in `matcher.ts`, `savings.service.ts`,
  `categories.service.ts`, `matcher.test.ts`, savings tests, `telegram.service.ts`, `exploration.md`).
  No denial observed.
- **Repo access**: read-only; no files outside `openspec/changes/conversational-categories/research.md` were modified.

## 2. Questions (selected research lane)

1. Spanish plural formation rules (RAE/grammar sources): regular suffixes, irregular/invariant cases, and a conservative fold rule set with a decision table and an explicit exclusion list.
2. How existing stemmers handle Spanish (Snowball/Spanish, Hunspell es, Elasticsearch Spanish analyzer, Lucene SpanishLightStemFilter): suffix rules, false-positive risks, and what a MINIMAL conservative plural fold looks like.
3. False-positive risk analysis: word pairs where folding "s" wrongly merges distinct words; whether the fold should apply to multi-token keywords only or also single-token; a conservative rule table.
4. Reserved-concept plural variants for previsto/provisto, gastos fijos/gasto fijo, ahorro/ahorros, compartido, otro; whether to add a small typo tolerance for the reserved set only.
5. Scope recommendation for the shared matcher: whether applying the fold to savings keywords (e.g. brand "entrenuts") is safe, and how to scope it.

## 3. Sources

| ID | Class | Title | Publisher | URL | Accessed | Excerpt (key content used) |
|---|---|---|---|---|---|---|
| S1 | open-web | «plural», Diccionario panhispánico de dudas (2.ª ed.) | RAE / ASALE | https://www.rae.es/dpd/plural | 2026-09-28 | Authoritative formation rules: §1.1 -s after unstressed vowel/-e (cafés, no ⊗cafeses); §1.2 stressed -á/-ó take only -s (sofás, papás); §1.3 stressed -í/-ú take -es or -s (bisturíes/bisturís, champús; rioplatense also champúes/menúes; gurí→gurises); §1.4 -y words: traditional -es (ley→leyes, rey→reyes), modern loans -s with y→i (jersey→jerséis, espray→espráis), avoid ⊗jerseises; §1.6 -s/-x endings: monosyllables and agudos add -es (tos→toses, vals→valses, compás→compases, francés→franceses, malpaís→malpaíses), otherwise INVARIANT (crisis, tórax, fórceps, aguafiestas; dux, ex, siux; ciempiés, buscapiés, pasapurés); §1.7a -l/-r/-n/-d/-z/-j add -es (pan→panes, red→redes, paz→paces, cáliz→cálices, reloj→relojes); §2.1 stress shift espécimen/régimen/carácter; §2.4 noun+noun pluralizes first element (sofás cama); §2.5 dual singular/plural nouns (gafas, pantalones, tijeras); §2.8d brand names: vowel-final take -s (las Yamahas), consonant-final invariant (los Opel) |
| S2 | open-web | Spanish stemming algorithm | Snowball (snowballstem.org) | https://snowballstem.org/algorithms/spanish/stemmer.html | 2026-09-28 | Full suffix-removal algorithm: Step 0 attached pronouns; Step 1 standard suffixes (-anza/-ico/-ismo/-able/-ista/-oso/-amiento/-ación/-logía/-ución/-encia/-amente/-mente/-idad/-iva…); Step 2a/b verb suffixes; Step 3 residual deletes -os, -a, -o, -á, -í, -ó and -e/-é in RV; accent postlude. Sample output shows aggressive conflation (chicas→chic, chico→chic, totalidad→totaliz). No bare -s plural-only mode |
| S3 | open-web | SpanishMinimalStemmer.java (deprecated) | Apache Lucene (apache/lucene main) | https://raw.githubusercontent.com/apache/lucene/main/lucene/analysis/common/src/java/org/apache/lucene/analysis/es/SpanishMinimalStemmer.java | 2026-09-28 | Minimal plural stemmer: `len < 4` guard ("plural have at least 4 letters"); accent fold incl. ñ→n; if final -s: -as/-os → drop s; -eses → drop es; -ces → replace c with z, drop es; other -es → drop es; else drop s. Bug: "cafes"→"caf" (strips -es instead of -s). Deprecated in favor of SpanishPluralStemmer |
| S4 | open-web | SpanishLightStemmer.java (algorithm: J. Savoy, CLEF-2001) | Apache Lucene (apache/lucene main) | https://raw.githubusercontent.com/apache/lucene/main/lucene/analysis/common/src/java/org/apache/lucene/analysis/es/SpanishLightStemmer.java | 2026-09-28 | Aggressive light stemmer: strips final singular -o/-a/-e ("gasto"→"gast", "casa"→"cas"); -eses → drop es; -ces → -z; -os/-as/-es → drop 2. Conflates gender and verb forms — unsuitable as a conservative fold |
| S5 | open-web | Language analyzers — Spanish analyzer | Elastic | https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-lang-analyzer.html | 2026-09-28 | Elasticsearch Spanish analyzer rebuilt as: lowercase → Spanish stopwords → keyword_marker (`stem_exclusion` list) → `stemmer` with `language: light_spanish`. Default is the aggressive light stemmer; precision is recovered via an explicit exclusion list (`stem_exclusion`) |
| S6 | open-web | SpanishPluralStemmer.java (current) | Apache Lucene (apache/lucene main) | https://raw.githubusercontent.com/apache/lucene/main/lucene/analysis/common/src/java/org/apache/lucene/analysis/es/SpanishPluralStemmer.java | 2026-09-28 | The production model for a conservative plural fold. Implements wikilengua "Plural (formación)" (S9). `len < 4` guard; ~110-word invariant list (crisis, analisis, lunes, martes, jueves, pais, paris, seis, gris, virus, cactus, paraguas, forceps, tenis, vacaciones, cumpleaños…); special cases (yoes, noes, sies, clubes, albumes, sandwiches, relojes, bojes…); ordered mechanical rules: consonant+s → drop s; -ques/-guis/-gues → drop s; V+r+es → drop es; V+(d|l|n|x)+es → drop es; (y|u)+es → drop es; (u|l|r|t|n)+ies → drop es; …ses → drop es; V+is → i→y, drop s (jerseis→jersey); dis → i→y (brandis→brandy); ces → c→z, drop es (voces→voz); vowel+s → drop s (casas→casa, cafes→cafe) |
| S7 | open-web | SpanishAnalyzer.java | Apache Lucene (apache/lucene main) | https://raw.githubusercontent.com/apache/lucene/main/lucene/analysis/common/src/java/org/apache/lucene/analysis/es/SpanishAnalyzer.java | 2026-09-28 | Default Lucene Spanish analyzer pipeline: StandardTokenizer → LowerCaseFilter → StopFilter → optional SetKeywordMarkerFilter (stem exclusion) → SpanishLightStemFilter. Confirms the aggressive default and the exclusion-list mitigation |
| S8 | open-web | es_ES.dic + hunspell(5) man page | elastic/hunspell; Hunspell project | https://github.com/elastic/hunspell/blob/master/dicts/es_ES/es_ES.dic ; https://man.archlinux.org/man/hunspell.5 | 2026-09-28 | Hunspell paradigm: curated dictionary (es_ES.dic: 71,935 lines) + affix rules (SFX suffix classes) + morphological exception fields (`st:` stem, `is:plural`) for irregulars (e.g. feet st:foot is:plural). High precision on known words; out-of-vocabulary words fall back to affix rules. Different paradigm from a mechanical fold: dictionary+exceptions, not pure rules |
| S9 | open-web | Plural (formación) — featured article | Wikilengua (FundéuRAE) | http://www.wikilengua.org/index.php/Plural_(formación) | 2026-09-28 | Per-ending formation reference corroborating S1 (and the rule source cited by S6): -s/-es/-invariant per final letter and accent; invariant llanas/esdrújulas in -s (crisis, corpus, cactus); agudas add -es (franceses); -y: ley→leyes vs jersey→jerséis; -z→-ces (luces); -st words invariant (test, trust); súper/híper invariant; proper nouns and brand usage notes |
| R1 | documentation | matcher.ts | AutomatizacionRita repo (read-only) | apps/api/src/features/categories/matcher.ts | 2026-09-28 | `normalizeForMatch` (lowercase + per-char accent fold, length-preserving, D3); `boundaryRegex` `(?:^|[^a-z0-9])<kw>(?![a-z0-9])`; `matchCategory` oldest-wins. The change's target file |
| R2 | documentation | savings.service.ts | AutomatizacionRita repo (read-only) | apps/api/src/features/savings/savings.service.ts | 2026-09-28 | Savings reuses `normalizeForMatch` + `boundaryRegex` from categories/matcher; `defineRule` stores the normalized keyword; `matchNote` tests note vs rule keywords |
| R3 | documentation | categories.service.ts | AutomatizacionRita repo (read-only) | apps/api/src/features/categories/categories.service.ts | 2026-09-28 | Reserved guards today: `createCategory` routes exact `normalizeForMatch(name)==="ahorro"` to `ensureAhorro`; `renameCategory` forbids rename TO "ahorro" and rename OF SAVINGS; `deleteCategory` forbids "otro" and SAVINGS. No guard for previsto/gastos fijos/ahorros/compartido |
| R4 | documentation | matcher.test.ts + savings tests + telegram.service.ts | AutomatizacionRita repo (read-only) | apps/api/src/features/categories/matcher.test.ts; apps/api/src/features/savings/savings.service.test.ts; apps/api/src/features/telegram/telegram.service.ts | 2026-09-28 | Pinned matching semantics (word boundaries, diacritics, oldest-wins); savings canonical keywords "entrenuts"/"sueldo"/"cafe"; `normalizeForMatch` is load-bearing beyond matching (command parsing, dedupe, correction scoring, index slicing at telegram.commands.ts:76) |

## 4. Validated claims (claim → sources)

| # | Claim | Sources |
|---|---|---|
| C1 | Spanish plural has two active suffixes, -s and -es; invariant words exist; -s is the only active mark for recent loanwords. | S1 (§1), S9 |
| C2 | Words ending in an unstressed vowel or stressed -e pluralize with -s; stressed -á/-ó with -s only (exceptions faralá, albalá, no, yo). | S1 (§1.1, §1.2), S9 (§4.1, §4.15) |
| C3 | Words ending in -s/-x: monosyllables and agudos add -es; all others are invariant (crisis, tórax, fórceps, aguafiestas, ciempiés, dux, ex). | S1 (§1.6), S9 (§4.19, §4.24) |
| C4 | Words ending in -y: traditional words take -es (ley→leyes, rey→reyes); recent loans take -s with y→i (jersey→jerséis, espray→espráis); ⊗jerseises is rejected. | S1 (§1.4), S9 (§4.25) |
| C5 | -z-final words pluralize with -ces (paz→paces, luz→luces, cáliz→cálices); therefore folding plural -ces back to -z is a safe, closed transformation. | S1 (§1.7a), S9 (§4.26), S6 (ces→z rule) |
| C6 | Stress shifts in espécimen→especímenes, régimen→regímenes, carácter→caracteres; naive -es stripping still converges on the folded singular (especimen/regimen/caracter). | S1 (§2.1), S9 (§4.14, §4.18) |
| C7 | Brand/proper names: vowel-final brands pluralize with -s (Yamahas, Zaras); consonant-final brands stay invariant (Opel); surname -z invariant. | S1 (§2.8), S9 |
| C8 | The Snowball Spanish stemmer is a full morphological stemmer (pronouns, derivational suffixes, verb endings, residual -os/-a/-o/-e deletion); it conflates singular/plural AND gender/verb/noun forms (chicas→chic, totalidad→totaliz). Too aggressive for keyword matching. | S2 |
| C9 | Lucene's default Spanish analyzer uses the light stemmer (strips final -o/-a/-e) with an opt-in `stem_exclusion` keyword-marker list; the SpanishLightStemFilter alone would fold "gasto"→"gast". | S4, S5, S7 |
| C10 | Lucene's minimal plural stemmer (deprecated) is a pure -s/-es stripper with a `len < 4` guard and a -ces→-z rule; it misfolds "cafes"→"caf". The current SpanishPluralStemmer fixes this with ordered rules + an invariant list + special cases, and is the closest production model to a conservative plural-only fold. | S3, S6 |
| C11 | A length guard on the input token (plural forms have ≥ 4 letters) protects monosyllabic -s singulars (mes, gas, los, res, tos, dos, pie) while letting their plurals fold onto them (meses→mes, gases→gas, toses→tos, pies→pie). | S6 (guard + comment), S1 (§1.6 monosyllables) |
| C12 | Invariant and stressed-final -s words need an explicit exclusion list; without it, crisis→crisi, lunes→lun, frances→franz (via the -ces rule), interes→intere, compas→compa, dios→dio, cortes→corte. Lucene's S6 list covers ~110 common ones; it misses dios, tres, vals, frances, ingles, interes, compas, atras, demas, ademas, despues, jamas, estres, marques, cortes, autobus, miercoles, viernes, biceps (see §7 additions). | S6 (list), S1 (§1.6), analysis in §7 |
| C13 | Hunspell es achieves precision via a curated dictionary (es_ES.dic ~71,935 entries) plus affix rules and morphological exception fields (st:, is:plural); out-of-vocabulary words fall back to affix rules. Not reproducible in a small deterministic fold without a dictionary; the fold's equivalent is an explicit exclusion list. | S8 |
| C14 | The `normalizeForMatch` literal normalization is load-bearing beyond keyword matching: command parsing, dedupe, correction scoring, category-name equality, and D3 index slicing (telegram.commands.ts:76) depend on its length-preserving semantics. The plural fold MUST be a separate function; it must NOT change `normalizeForMatch` semantics. | R1, R2, R3, R4 |
| C15 | `boundaryRegex`/`normalizeForMatch` are shared by savings keyword matching (savings.service.ts imports them); savings keywords are user-defined, money-critical (percent splits), stored normalized, oldest-wins. Canonical test keywords: "entrenuts" (brand), "sueldo", "cafe". | R2, R4 |
| C16 | The reserved guard today only catches exact "ahorro" (create/rename) and "otro" (delete); previsto, gastos fijos, ahorros (plural), compartido are unguarded — the F2/F3 phantom sources. | R3, exploration.md |
| C17 | The F2 typo "provisto" differs from "previsto" by one substitution (Damerau-Levenshtein distance 1); a plural fold cannot catch it — typo tolerance, if any, must be a separate mechanism scoped to the reserved set. | exploration.md (F2), analysis in §8 |

## 5. Q1 — Spanish plural rules and the recommended conservative fold

### 5.1 Canonical formation rules (evidence base)

- **-s**: unstressed vowel final, stressed -e (comités), stressed -á/-ó (papás, sofás); letters, recent loanwords, -i/-u loans (menús). [S1 §1.1–1.3, S9]
- **-es**: consonant finals (-l/-r/-n/-d/-z/-j), monosyllables and agudos ending in -s/-x (tos→toses, francés→franceses), stressed -í/-ú (bisturíes), traditional -y words (ley→leyes). [S1 §1.4–1.7, S9]
- **-z → -ces** (luz→luces) and the reverse fold -ces → -z. [S1 §1.7a, S9 §4.26]
- **Invariant**: llanas/esdrújulas in -s/-x (crisis, tórax, fórceps, lunes, paraguas), compounds whose second element is plural (ciempiés, pasapurés), -st loans (test, trust), brand names ending in consonant (los Opel). [S1 §1.6, §2.8; S9 §4.19, §4.27]
- **Irregular/invariant examples required by the lane**: lunes (invariant), mano→manos (regular -s), pan→panes (-es), mes→meses (-es on monosyllable), café→cafés (-s), ley→leyes (-y traditional), jersey→jerséis (y→i + -s; ⊗jerseyes deprecated). All of these are handled by the rule table below (meses→mes, panes→pan, cafes→cafe, leyes→ley, jerseis→jersey).

### 5.2 Recommended fold: `foldSpanishPluralToken` (decision table)

Operates on a token already normalized by the existing `normalizeForMatch` (lowercase, accents folded). Applies **at most one rule** (longest/most-specific first, never re-folding the output — re-folding would turn "meses"→"mes" into "me").

| # | Condition (on folded token) | Action | Examples (folded → folded) | Source |
|---|---|---|---|---|
| 0 | token length < 4 | no fold | mes, gas, los, res, tos, dos, pie, as stay | S6 guard; S1 §1.6 (monosyllables take -es) |
| 1 | token ∈ EXCLUSION_LIST (§7) | no fold | lunes, crisis, pais, frances, dios, entrenuts? (no — see §8) stay | S6 list; S1 §1.6; additions §7 |
| 2 | token ∈ SPECIAL_CASES | strip "es" | clubes→club, albumes→album, sandwiches→sandwich, relojes→reloj, yoes→yo, noes→no, sies→si | S6 specials |
| 3 | ends "s", preceding char not a vowel | strip "s" | clips→clip, chips→chip, spots→spot, entrenuts→entrenut | S6 branch 1; S1 §1.8 |
| 4 | ends -ques / -guis / -gues (char -4 = q, or g,u + i/e) | strip "s" | parques→parque, maniquis→maniqui | S6 branch 2 |
| 5 | ends V + r + es (char -4 vowel, -3 = r) | strip "es" | amores→amor, alfileres→alfiler, escaneres→escaner | S6 branch 3 |
| 6 | ends V + (d\|l\|n\|x) + es | strip "es" | abades→abad, comerciales→comercial, faxes→fax, panes→pan, verdades→verdad, botones→boton | S6 branch 4; S1 §1.7a |
| 7 | ends (y\|u) + es | strip "es" | leyes→ley, reyes→rey, bueyes→buey, bambues→bambu, convoyes→convoy | S6 branch 5; S1 §1.4; S9 §4.25 |
| 8 | ends (u\|l\|r\|t\|n) + ies | strip "es" | jabalies→jabali, israelies→israeli, marroquies→marroqui | S6 branch 6; S1 §1.3 |
| 9 | ends ...ses (char -3 = s, char -2 = e) | strip "es" | meses→mes, reses→res, toses→tos, intereses→interes, franceses→frances, compases→compas | S6 branch 7; S1 §1.6 |
| 10 | ends vowel + is (char -3 vowel, char -2 = i) | replace final "i" with "y", strip "s" | jerseis→jersey, esprais→espray, paipais→paipay | S6 branch 8; S1 §1.4 |
| 11 | ends "dis" (char -3 = d, char -2 = i) | replace final "i" with "y", strip "s" | brandis→brandy | S6 branch 9 |
| 12 | ends -ces (char -3 = c, char -2 = e) | replace "c" with "z", strip "es" | voces→voz, luces→luz, peces→pez, veces→vez, narices→nariz, felices→feliz | S6 branch 10; S1 §1.7a; S9 §4.26 |
| 13 | ends vowel + s (fallback) | strip "s" | casas→casa, libros→libro, cafes→cafe, gastos→gasto, fijos→fijo, ahorros→ahorro, previstos→previsto, otros→otro, compartidos→compartido | S6 final branch; S1 §1.1–1.2 |

**Why the ordering matters** (single-application rule): rule 9 before rule 13 resolves the -es ambiguity —
"meses" hits rule 9 → "mes" (correct), "cafes" does not match rule 9 (char -3 = "f") and falls to rule 13 → "cafe"
(correct: café + s). A naive "strip -es first" would produce "caf" (S3's bug); a naive "strip -s first" would produce
"mese". Rule 12's -ces→-z is closed per C5 (native -z words always pluralize to -ces).

### 5.3 Special cases list (adopted from S6)

`yoes, noes, sies, clubes, faralaes, albalaes, itemes, albumes, sandwiches, relojes, bojes, contrarreloj, carcajes` — each folds by stripping "es" (e.g. clubes→club, albumes→album, sandwiches→sandwich, relojes→reloj).

### 5.4 Known safe misses (accepted by design)

- "pie" (3) never folds; "pies" (4) folds to "pie" ✓ — but "pie"→"pi" is blocked, so the reverse direction works. Singulars shorter than 4 chars are preserved and their plurals fold onto them (C11).
- "jersey" plural spellings "jerseis" (normative) and "jerseys" (English-style) both converge on "jersey" via rules 10 and 3 respectively.
- Stress-shift plurals (caracteres, regimenes, especimenes) converge on the folded singular via rule 6/9 (C6).

## 6. Q2 — How existing stemmers handle Spanish, and what the minimal fold is

| System | Mechanism | What it removes | False-positive risk for keyword matching | Verdict |
|---|---|---|---|---|
| Snowball Spanish (S2) | RV/R1/R2 regions; pronoun attach (step 0); derivational suffixes (step 1); verb suffixes (step 2); residual -os/-a/-o/-e (step 3) | Full morphology: singular+plural, gender, verb forms, derivational suffixes | Extreme: gasto/gastos/gasta/gastar/gastó all → "gast"; totalidad→totaliz | Too aggressive — a full stemmer, not a fold. Do not use |
| Lucene SpanishLightStemFilter (S4) | len ≥ 5; strips final -o/-a/-e; -eses/-ces/-os/-as/-es handling | Singular and plural endings, gender | High: "gasto"→"gast", "mano"→"man", "casa"→"cas" — merges singulars with their plurals AND unrelated forms | Too aggressive for a money-adjacent matcher |
| Elasticsearch `spanish` analyzer (S5) | lowercase + stopwords + keyword_marker + `light_spanish` stemmer | Same as S4 | Same as S4; mitigated only by explicit `stem_exclusion` lists | Default is aggressive; the industry mitigation is exactly an explicit exclusion list |
| Lucene SpanishMinimalStemmer (S3, deprecated) | len ≥ 4; -s/-es/-eses/-ces mechanical strip | Plural suffixes only | Moderate: "cafes"→"caf" (wrong strip), invariants misfolded (lunes→lun, crisis→crisi) | Correct idea, flawed rules; superseded |
| Lucene SpanishPluralStemmer (S6, current) | len ≥ 4 + invariant list + special cases + 13 ordered rules | Plural suffixes only, with -ces→-z and -is→-y | Low: covered by the invariant list; residual misses (dios, cortes, frances…) — see §7 additions | The production model for a conservative fold |
| Hunspell es (S8) | 71,935-entry curated dictionary + affix (SFX) rules + morphological exceptions (st:, is:plural) | Any form recognized by dictionary+affix; exceptions explicit | Very low on dictionary words; OOV falls back to affix rules | Different paradigm (dictionary-based); not reproducible without a dictionary — the fold's analogue is the exclusion list |

**What a MINIMAL conservative plural fold is (evidence synthesis, S3+S6+S9):** input length guard (≥ 4) + an
explicit invariant/exclusion list + a short ordered rule table covering exactly the plural suffixes (-s, -es, -ces→-z,
-is→-y) — nothing else. No verb endings, no -o/-a gender stripping, no derivational suffixes, no iterative re-folding.
This is precisely the shape of S6, and it is the recommendation adopted in §5.2.

## 7. Q3 — False-positive risk analysis and single vs multi-token

### 7.1 Collision families (folding "s" merges distinct words)

| Family | Example pair | Guard | Consequence if folded |
|---|---|---|---|
| Monosyllables in -s | mes→me, gas→ga, los→lo, res→re, tos→to, as→a, dos→d | len < 4 rule 0 (all 2–3 chars) | fully prevented; plurals still fold onto them (meses→mes) |
| Invariant llanas/esdrújulas in -s | crisis→crisi, lunes→lun, paraguas→paragua, analisis→analis, tenis→teni | exclusion list (S6 + §7.2 additions) | prevented |
| Stressed -s singulars (agudos) | frances→franz (via rule 12!), ingles→ingl, interes→intere, compas→compa, pais→pa, autobus→autobu, estres→estre | exclusion list — the -ces rule (12) makes these the MOST dangerous | prevented; their plurals then fold onto the excluded singular (franceses→frances) |
| Singulars whose fold collides with a real word | cortes→corte (collides with "corte"), marques→marque (verb), dios→dio, tres→tre, vals→val, biceps→bicep | exclusion list | prevented |
| Numerals | seis→sei, tres→tre, dos→d, diez (no -s) | seis/tres excluded; dos protected by len | prevented |
| Verb forms in note text | gastas→gasta, quieres→quiere, compramos→compramo | none needed | harmless: notes are not keywords; only matters if a rule keyword equals a folded verb form — no realistic keyword vocabulary collision |
| Brand names | entrenuts→entrenut (self-consistent), spots→spot, chips→chip, clips→clip | none needed for self-matching; rule 3 actually handles anglicisms well (S1 §1.8: consonant-final loans take -s) | consistent both-sides fold preserves matching |

### 7.2 Exclusion list (folded forms; S6 list + app additions)

**From S6 (verbatim, accents folded):** abrebotellas, abrecartas, abrelatas, afueras, albatros, albricias, aledaños, alexis, alicates, analisis, andurriales, antitesis, añicos, apendicitis, apocalipsis, arcoiris, aries, bilis, boletus, boris, brindis, cactus, canutas, caries, cascanueces, cascarrabias, ciempies, cifosis, cortaplumas, corpus, cosmos, cosquillas, creces, crisis, cuatrocientas, cuatrocientos, cuelgacapas, cuentacuentos, cuentapasos, cumpleaños, doscientas, doscientos, dosis, enseres, entonces, esponsales, estatus, exequias, fauces, forceps, fotosintesis, gafas, gafotas, gargaras, gris, honorarios, ictus, jueves, lapsus, lavacoches, lavaplatos, limpiabotas, lunes, maitines, martes, mondadientes, novecientas, novecientos, nupcias, ochocientas, ochocientos, pais, paris, parabrisas, paracaidas, parachoques, paraguas, pararrayos, pisapapeles, piscis, portaaviones, portamaletas, portamantas, quinientas, quinientos, quitamanchas, recogepelotas, rictus, rompeolas, sacacorchos, sacapuntas, saltamontes, salvavidas, seis, seiscientas, seiscientos, setecientas, setecientos, sintesis, tenis, tifus, trabalenguas, vacaciones, venus, versus, viacrucis, virus, viveres, volandas.

**App-specific additions (evidence: §7.1 analysis; not covered by S6; each violates §7.1 rules otherwise):** dios, tres, vals, frances, ingles, interes, compas, atras, demas, ademas, despues, jamas, estres, marques, cortes, autobus, miercoles, viernes, biceps.

### 7.3 Single-token vs multi-token recommendation

**Recommendation: apply the fold to every token, unconditionally — single-token AND multi-token keywords alike.**

Evidence and rationale:
1. Single-token keywords are the common case in this app (tests: "cafe", "transporte", "sube", "super", "entrenuts", "sueldo"; dialog auto-create is single-token by design — R4). Restricting the fold to multi-token keywords would leave the most frequent case unfixed.
2. Multi-token phrases gain no extra safety from a keyword-length condition: the fold is per-token, and the boundary regex already requires ALL tokens to match, so a phrase match is only possible when every token collides — a much stricter bar. The token-level conservative rules (§5.2) are what make single-token folding safe.
3. Production precedent: Lucene's plural stemmer (S6) and Elasticsearch tokenization (S5) both apply per-token with no keyword-length condition; their safety comes from the guard + exclusions, not from phrase length.
4. The fold MUST be applied per token on BOTH sides (keyword at regex-build time; note at match time). A naive whole-string suffix strip would corrupt multi-token phrases (only the last token would fold, breaking "gastos fijos"). Implementation note for the design phase: split the normalized note on `[^a-z0-9]`, fold each token, rejoin with a space, then apply the (word-boundary) regex.

## 8. Q4 — Reserved-concept plural variants and typo tolerance

### 8.1 Variant table (folded comparison basis)

| Reserved concept | Folded canonical | Variants that MUST be caught (folded) | Fold rule | Notes |
|---|---|---|---|---|
| previsto | previsto | previsto; previstos→previsto | rule 13 | Phantom from F2; collides with the PENDING concept. Feminine prevista/previstas: optional to reserve (no -s fold on prevista) |
| gastos fijos | gasto fijo | gasto fijo; gastos fijos→gasto fijo; mixed "gastos fijo" / "gasto fijos"→gasto fijo (per-token fold) | rules 13 per token | Collides with the planned-query phrasing the brain prompt teaches (bot-brain.ts) |
| ahorro | ahorro | ahorro; ahorros→ahorro | rule 13 | Existing guard only catches exact "ahorro" (R3) — F3's "ahorros" bypasses it |
| compartido | compartido | compartido; compartidos→compartido; compartida (explicit — no -s ending); compartidas→compartida | rule 13 + explicit gender member | Collides with the compartido: prefix concept; gender variants need explicit set members |
| otro | otro | otro; otros→otro | rule 13 | Fallback category; delete-guard exists for exact "otro" (R3) |

The reserved set, stored as folded forms: `{previsto, gasto fijo, ahorro, compartido, compartida, otro}` plus the
typo alias below. Comparison = fold the incoming category name token-wise (same `foldSpanishPluralToken`) and test
membership. This catches F3 ("ahorros"→"ahorro") and F1/F2 creation targets with one mechanism (exploration option B3).

### 8.2 Typo tolerance ("provisto" vs "previsto")

- **Evidence**: the F2 sentence used "provisto" — Damerau-Levenshtein distance 1 from "previsto" (single substitution, o↔e). A plural fold cannot catch it (C17); the two words are unrelated forms.
- **Recommendation**: add an explicit alias map in the reserved guard only — `{provisto: previsto}` (and optionally `{prebisto: previsto}`). Rationale: the reserved set is tiny (6 members), so an alias map costs nothing and has ZERO false positives; a generic Damerau-Levenshtein ≤ 1 on the reserved set would also catch "previsto"↔"privisto" (fine) but ALSO "otro"↔"otra" (overreach — "otra" may be a legitimate personal category) and "otro"↔"otra"↔"otros" (rule 13 already handles otros). If product wants broader typo tolerance, DL ≤ 1 scoped to reserved names of length ≥ 4 is the fallback — but the alias map is the conservative default.
- **Scope boundary**: typo tolerance MUST NOT be applied to general keyword matching (DL-1 on arbitrary text merges distinct words: "gasto"↔"pasto", "otro"↔"roto"); that is a separate product decision and is out of scope for this lane.

## 9. Q5 — Savings scope recommendation for the shared matcher

### 9.1 Evidence

- The matcher is literally shared: `savings.service.ts` imports `normalizeForMatch` and `boundaryRegex` from `categories/matcher` (R2); the exploration (D4/D8) deliberately keeps one matching semantics for both.
- Savings keywords are user-defined, stored normalized, matched oldest-wins, and drive money splits (percent of income). A fold that widens matching changes which income messages split — a silent money behavior change (R2, R4).
- Canonical savings keywords in tests: "entrenuts" (brand name ending in -s), "sueldo", "cafe" (R4).
- Brand-name analysis: "entrenuts" is consonant+... final -s; rule 3 folds it to "entrenut". Because the fold is applied identically to both sides, "entrenuts" still matches "entrenuts" (self-consistent), and only a nonexistent "entrenut" note would additionally match. S1 §2.8d confirms brands are invariant in spirit, but mechanical self-consistent folding does not change matching outcomes for the brand itself.
- Industry precedent: production systems apply the same stemmer to index and query (S5/S7) and recover precision with exclusion lists — the risk pattern is well understood.

### 9.2 Recommendation: apply the fold to BOTH category matching and savings matching, through one new tolerant path

Concretely: add `foldSpanishPluralToken`/`foldAllTokens` and a tolerant matching path (e.g. `matchCategoryTolerant` + tolerant boundary builder) in `matcher.ts`; use it in `matchCategory` AND `SavingsRuleService.matchNote`. Keep the literal `normalizeForMatch` and `boundaryRegex` exported unchanged — they are load-bearing for commands, dedupe, correction scoring, and D3 index slicing (C14), and `defineRule` keeps storing the literal-normalized keyword (no DB migration, no visible keyword change).

Rationale:
1. **One matcher concept**: the exploration deliberately shares matcher semantics across categories and savings; divergent semantics (categories fold, savings don't) would surprise a user who types "sueldos" against a "sueldo" savings rule. Consistency is a feature.
2. **Bounded money risk**: the fold is a pure function applied to both sides; the only NEW matches are true singular/plural pairs plus the documented exclusion-adjacent residue (which the §7 lists eliminate). The savings split logic itself (`resolveSplit`, `computeSplit`) is untouched.
3. **Zero data change**: matching-only fold; stored keywords and unique `[ownerId, keyword]` semantics are preserved.
4. **Testable**: savings tests must add fold fixtures (sueldo/sueldos, cafe/cafes, entrenuts self-consistency) so the money behavior change is pinned.

Counter-option (documented, not recommended): fold categories only, leave savings literal. Zero money risk; but inconsistent UX, two matcher code paths to maintain, and the same conservative rule is still required. The counter-option is the fallback if the product owner prefers zero savings behavior change; it does not change any other finding in this research.

## 10. Proposal-level implications

- **matcher.ts**: add `foldSpanishPluralToken` (per §5.2 table), `foldAllTokens` (token-wise on `[^a-z0-9]`), and a tolerant matching path. Do NOT alter `normalizeForMatch`/`boundaryRegex` semantics (C14). Existing `matcher.test.ts` pins (word boundaries, diacritics, oldest-wins, cafe2go/cafeteria) remain satisfied — the fold never merges tokens.
- **categories.service.ts**: replace the exact "ahorro"/"otro" equality checks with folded-comparison reserved-set membership (§8.1) in `createCategory` and `renameCategory` (rename-to today only guards "ahorro" — R3). Include the `provisto` alias (§8.2). Decide guard placement for `deleteCategory`: phantoms from before the change must remain deletable, so do NOT add the new reserved names to the delete guard.
- **savings.service.ts**: switch `matchNote` to the tolerant path (§9.2); `defineRule` unchanged.
- **No brain/golden churn**: the fold is deterministic and touches no prompt or envelope — the 8 pinned goldens are NOT affected (this lane avoids the exploration's golden risk).
- **Tests**: matcher fold fixtures (gasto fijo↔gastos fijos, mes/meses, cafe/cafes, jerseis/jersey, luces/luz, pies/pie, excluded words unchanged, entrenuts); savings fold fixtures; reserved-guard fixtures (ahorros, gastos fijos, provisto, previstos, compartidos, otros).
- **Specs to update**: `movement-categories` (matching semantics, reserved names), `savings` (shared matcher tolerance), `telegram-bot` (creation guards).
- **Product decisions to confirm at proposal** (non-authoritative here): (1) B1 hard block vs B2 soft redirect for reserved names; (2) whether folded "ahorros" upserts SAVINGS (D9 pattern) or is rejected; (3) savings fold scope (research recommends shared — §9.2); (4) provisto alias inclusion (recommended: yes).

## 11. Contradictions, uncertainty, freshness

- **Contradictions**: S3 (minimal stemmer) folds "cafes"→"caf"; S6 (plural stemmer) folds "cafes"→"cafe". S6 is the current, non-deprecated implementation and matches RAE §1.1 (cafés, avoid ⊗cafeses) — S6 behavior is adopted. No other contradictions between sources.
- **Uncertainty**: (a) the residual exclusion-list misses beyond §7.2 (e.g. "lejos" folds to "lejo" harmlessly; unknown future keywords ending in -s singular are a residual risk — the design should keep the exclusion list appendable); (b) RAE allows both -s and -es plurals for stressed -í/-ú and some -y loans (rioplatense also champúes/menúes — S1 §1.3); the fold accepts both spellings (rules 3/13 and 8), which covers the variation without needing a decision; (c) product choices in §10 are explicitly non-authoritative.
- **Freshness**: RAE DPD 2nd edition (current online edition; page cites consult 22/09/2026); Lucene sources fetched from apache/lucene `main` on 2026-09-28 (SpanishPluralStemmer is the current non-deprecated class); Snowball page reflects Snowball 3.0.0+; wikilengua article featured 2023-10-09; elastic/hunspell es_ES.dic at `master`. All stable, non-ephemeral references.
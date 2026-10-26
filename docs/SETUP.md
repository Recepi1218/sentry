# Sentry – från simulering till drift

Det här är steg för steg vad som måste göras i Airtable och n8n för att Sentry ska fungera på riktigt. Ordningen är viktig: **ingenting får röra pengar förrän budgetspärren (steg 4) är byggd och testad.** Fram till dess är systemet låst och kopplat till testlägen.

Bakgrunden till varför det ser ut så här står i [ARCHITECTURE.md](ARCHITECTURE.md), och fälten i [DATA-MODEL.md](DATA-MODEL.md).

| Steg | Vad | Klart när |
| --- | --- | --- |
| 0 | Fyra beslut | Du vet plan, butik, vilka agenter och var budgetboken ligger |
| 1 | Konton och tak hos leverantörerna | Det finns hårda tak utanför Sentry |
| 2 | Airtable-basen | Alla tabeller finns och startdata är inlagd |
| 3 | Grunden i n8n | Credentials, tidszon och felflöde finns |
| 4 | Budgetspärren (WF-10, WF-11) | Alla spärrtester i steg 10 passerar |
| 5 | Huvudbrytaren och nödstoppet (WF-01, WF-12, WF-91, WF-20) | Lås och aktivera fungerar via curl |
| 6 | API:t för dashboarden (WF-00, WF-02) och kopplingen | Dashboarden visar riktig data utan varningar |
| 7 | Pengar in: Stripe och butiken (WF-30) | En testorder syns med rätt marginal |
| 8 | Sentinel (WF-90) och veckogränsen (WF-14) | Larmen i steg 10 utlöses och ett budgetförslag dyker upp efter en vinstvecka |
| 9 | Agenterna, en i taget | Varje agent har gjort en riktig körning i testläge |
| 10 | Acceptanstest | Hela listan är grön, först därefter riktiga pengar |

---

## 0. Fyra beslut innan du börjar

**1. Planer, styrda av kvoterna.** Varje anrop från dashboarden och varje schemalagd körning räknas.

| Tjänst | Kvot (enligt respektive prislista, okt 2026) | Rekommendation |
| --- | --- | --- |
| n8n Cloud | Starter: 2 500 körningar per månad och 5 samtidiga. Pro: 10 000 per månad och 20 samtidiga. Körningar av sub-workflows, felflöden, manuella körningar och avvisade webhook-anrop räknas inte. | **Pro.** Starter räcker bara om panelen sällan är öppen. |
| Airtable | Free: 1 000 API-anrop per månad. Team: 100 000 per månad och workspace. Business: inget månadstak. Alla planer: 5 anrop per sekund och bas, därefter 30 sekunders spärr. | **Team** till en början, **Business** om volymen växer. Free räcker inte. |

Räkneexemplet finns i [Kvoter i drift](#kvoter-i-drift).

**2. Var kunderna köper.** Sentry behöver en butik. Det enklaste är **Stripe Payment Links**: när du godkänner en produkt skapar n8n en produkt, ett pris och en betallänk i Stripe. En egen butikssida kan komma senare. Utan butik har COURIER, HAVEN och LEDGER inget att arbeta med.

**3. Vilka agenter som startar först.** Bara de agenter som har riktiga indata från dag ett ska vara på (se [steg 9](#9-agenterna)). Övriga lämnas avstängda i Airtable (`enabled` = av) och visas som pausade i panelen.

**4. Var budgetboken ligger.** Rekommendationen är att börja i Airtable, som det är beskrivet här. Det fungerar så länge veckans budgetbok håller sig till några hundra rader, vilket den gör med en reservation per agentkörning. Växer volymen kraftigt är nästa steg att flytta budgetboken och brytarens läge till en riktig databas med transaktioner, till exempel Postgres hos Supabase, och låta Airtable vara hjärnan för resten.

---

## 1. Konton och tak (lager 3)

Taken här är det enda som håller även om allt i Sentry går fel.

1. **Anthropic Console:** skapa en egen workspace som heter *Sentry* och skapa API-nyckeln där. Sätt en **månatlig utgiftsgräns** på workspacen, ungefär veckans AI-budget × 4,5. Ladda bara in så mycket kredit som du är beredd att förbruka, och slå av automatisk påfyllning om ditt konto har det.
2. **Meta Business:** skapa annonskontot och sätt **kontots utgiftsgräns** i betalinställningarna. Sentry skapar bara kampanjer med livstidsbudget.
3. **Stripe:** skapa kontot i företagets namn och arbeta i **testläge** fram till steg 10.
4. **n8n Cloud** och **Airtable** enligt beslut 1.

---

## 2. Airtable

1. Skapa en tom bas som heter **Sentry**.
2. Skapa tabellerna och fälten exakt enligt [DATA-MODEL.md](DATA-MODEL.md). Det behövs inga formel-, rollup- eller autonummerfält: n8n räknar själv fram läge och summor, och postens record-id används som id. Det betyder att hela basen kan skapas med ett skript via Airtables Meta API.
3. Lägg in startdata:
   - **SystemControl**, en rad: `lockedAt` = nu, `armedAt` tom, `revision` = 0, `weeklyLimitOre` = din veckogräns i öre (till exempel `150000` för 1 500 kr), `warnAtBp` = `8000`, `fxSekPerUsd` = en kurs klart över dagens, till exempel `11.00`. Börja med en låg gräns, till exempel `2000` (20 kr), fram till steg 10.
   - **Agents**, 20 rader enligt tabellen i ARCHITECTURE.md, alla med `enabled` = av.
   - **ModelPricing**, tre rader enligt [`pricing.ts`](../src/app/core/domain/pricing.ts).
   - **ToolCosts**, dina faktiska planer.
4. Skapa en **Personal Access Token** för n8n:
   - Scopes: `data.records:read`, `data.records:write`, `schema.bases:read`.
   - Access: bara basen *Sentry*.
   - Ett skript som skapar tabellerna behöver dessutom `schema.bases:write` tillfälligt. Ta bort den efteråt.

---

## 3. Grunden i n8n

1. **Tidszon:** Europe/Stockholm, både i instansens inställningar och i varje workflows inställningar. Veckan börjar måndag 00:00 svensk tid.
2. **Credentials**, med de här namnen så att flödena kan delas:

| Namn | Typ | Innehåll |
| --- | --- | --- |
| `Airtable Sentry` | Airtable Personal Access Token API | Token från steg 2.4 |
| `Anthropic` | Header Auth | Namn `x-api-key`, värde = API-nyckeln |
| `Sentry dashboard` | Header Auth (för webhooks) | Namn `Authorization`, värde `Bearer ` + en slumpad sträng på minst 32 tecken |
| `n8n API` | n8n API | API-nyckel från Settings → n8n API. Används för att slå av och på dispatchern. |
| `Stripe test` | Stripe API | Testnyckel |

3. **Felflöde WF-99:** en *Error Trigger* som skriver en `CRITICAL`-rad i AuditLog och ett larm i Alerts. Ange det som *Error workflow* i inställningarna för varje annat flöde. Felflödets körningar räknas inte mot kvoten.
4. **Regler som gäller alla flöden:**
   - Anropa Claude med **HTTP Request**-noden, inte AI Agent-noden, så att du styr `max_tokens` och kan läsa av `usage`. Skicka alltid headern `anthropic-version: 2026-10-21` och skicka **aldrig** `temperature`, `top_p` eller `top_k`, eftersom den API-versionen svarar 400 på dem. Många färdiga n8n-mallar skickar `temperature`.
   - Gör inga parallella Airtable-anrop. Håll dig under 5 anrop per sekund och bas.
   - Alla belopp i heltal öre.
   - Vid tvivel blir svaret nej. Ett Airtable-fel i spärren betyder att kostnaden nekas, inte att den görs ändå.

---

## 4. Budgetspärren först

Logiken finns i [`budget-gate.ts`](../src/app/core/domain/budget-gate.ts) och ska överföras till Code-noder. Veckan räknas fram med `$now.setZone('Europe/Stockholm').toFormat("kkkk-'W'WW")`.

### WF-10 Budgetspärr (sub-workflow)

| # | Nod | Gör |
| --- | --- | --- |
| 1 | When Executed by Another Workflow | Indata: `requestId`, `agentId`, `category` (`AI_TOKENS`/`API_CALLS`/`ADS`), `maxCostOre`, `purpose` |
| 2 | Code: Validera | `maxCostOre` måste vara ett heltal > 0 och kategorin giltig. Annars nej direkt. Räknar fram `weekId`. |
| 3 | Airtable: Search SpendLedger | `{requestId} = '…'`. Finns raden redan (ett omförsök) returneras samma beslut som förra gången. |
| 4 | Airtable: Search SystemControl | Läget. ARMED endast om `armedAt` är senare än `lockedAt`. |
| 5 | Airtable: Search SpendLedger | `AND({weekId} = '…', {status} != 'RELEASED')`, Return All |
| 6 | Code: Förkontroll | `evaluateSpend()`. Nej → steg 12. |
| 7 | Airtable: Create SpendLedger | `status` = ACTIVE, `reservedOre` = `maxCostOre`, `actualOre` = 0, `requestId`, `weekId`, `agentId` |
| 8 | Airtable: Search SystemControl | Läget igen. |
| 9 | Airtable: Search SpendLedger | Samma filter som steg 5. |
| 10 | Code: Verifiera | `verifyReservation()` mot summan, **och** kontroll att den egna raden finns med i listan. Saknas den har Airtable inte visat en bekräftad skrivning, och då blir svaret nej. |
| 11 | If ok | Ja → returnera `{ allowed: true, reservationId, remainingAfterOre }` |
| 12 | Airtable: Update + AuditLog | Nej → egen rad sätts till `RELEASED` (om den skapats), en `SPEND_DENIED`-händelse loggas, och `{ allowed: false, reason, remainingOre }` returneras. |

### WF-11 Avräkning (sub-workflow)

| # | Nod | Gör |
| --- | --- | --- |
| 1 | When Executed by Another Workflow | Indata: `reservationId`, `actualOre`, `inputTokens`, `outputTokens`, `model` |
| 2 | Airtable: Get SpendLedger | Raden måste ha status ACTIVE, annars fel. |
| 3 | Airtable: Update | `status` = SETTLED, `actualOre`, tokens, `settledAt` |
| 4 | If `actualOre > reservedOre` | Ja → Execute Sub-workflow **WF-12 Lås** med anledningen "Kostnad över reservation" och ett kritiskt larm. |

**Viktigt för att taket ska hålla:**

- **En reservation per agentkörning**, inte per delsteg. Det håller budgetboken liten, och varje kontroll blir billig i Airtable-anrop.
- **Värsta fallet beräknas före anropet:** exakt antal prompt-tokens från `POST /v1/messages/count_tokens` + `max_tokens`, med priser från ModelPricing och växelkursen från SystemControl, avrundat uppåt. Formeln finns i [`pricing.ts`](../src/app/core/domain/pricing.ts).
- **Webbsökning** gör värsta fallet osäkrare, eftersom sökresultaten blir input-tokens. Sätt `max_uses` lågt (2–3), räkna med $0,01 per sökning (listpris $10 per 1 000 sökningar, omräknat med kursen) och ett generöst tokentillägg per sökning. Blir det ändå för lite slår avräkningen larm och låser.
- **Slå inte på serverside-fallbacks** (`fallbacks`) i agentanropen. Ett fallback-svar debiteras enligt en annan modells pris, ovanpå det första, vilket gör värsta fallet svårt att räkna ut. Hantera `stop_reason: "refusal"` som en misslyckad uppgift.

---

## 5. Huvudbrytaren och nödstoppet

### WF-12 Lås (sub-workflow, används av alla som låser)

Sätter `lockedAt` = nu, ökar `revision` och sätter `changedBy` och `reason`. Loggar `MASTER_SWITCH_LOCKED` och kör WF-91. En enda implementation, oavsett om låsningen kommer från dig, från Sentinel eller från ett överdrag.

### WF-01 Huvudbrytare (webhook)

- **Webhook:** `POST`, sökväg `sentry/v1/control`, Authentication = Header Auth med credentialen `Sentry dashboard`, *Allowed Origins (CORS)* = dashboardens adress, Respond = *Using 'Respond to Webhook' Node*.
- **Code:** validera kroppen `{ action, expectedRevision?, reason }`, där `reason` är 1–200 tecken.
- **LOCK** → WF-12 → svara 200 med `{ control }`. Inga villkor.
- **ARM:**
  1. Läs SystemControl. Avviker `revision` från `expectedRevision` → svara **409**.
  2. Läs veckans budgetbok. Är inget kvar → svara **422** "Veckobudgeten är slut".
  3. Läs Alerts. Finns ett aktivt `CRITICAL`-larm → svara **422**.
  4. Sätt `armedAt` = nu, öka `revision`, logga `MASTER_SWITCH_ARMED`.
  5. Aktivera WF-20 Dispatcher med n8n-noden, *Activate workflow*.
  6. Svara 200 med `{ control }`.

Svaret ska ha exakt formen `ControlState` i [`model.ts`](../src/app/core/domain/model.ts). Fel svaras med `{ "error": { "code", "message" } }`, där `message` är på svenska.

### WF-91 Nödstopp (sub-workflow)

1. Inaktivera WF-20 Dispatcher med n8n-noden, så att inga agenter startar.
2. För varje kampanj i `Campaigns` med status RUNNING: pausa den via Meta API, hämta förbrukningen och avräkna dess reservation med WF-11 till det faktiskt förbrukade.
3. Logga vad som pausades.

### WF-20 Dispatcher (schema – det enda som startar agenter)

Agenterna har **inga egna scheman**. Tjugo flöden som var och ett körs var 15:e minut skulle bli nästan 58 000 körningar i månaden. I stället finns en dispatcher:

| # | Nod | Gör |
| --- | --- | --- |
| 1 | Schedule Trigger | Var 30:e minut. Flödet är bara aktivt när systemet är aktiverat (WF-01 slår på, WF-91 slår av). |
| 2 | Airtable: Search SystemControl | Om läget inte är ARMED: inaktivera dig själv och stoppa. |
| 3 | Execute Sub-workflow: WF-90 Sentinel | Reglerna körs före varje omgång. |
| 4 | Airtable: Search Agents + Tasks | Agenter med `enabled` och `nextRunAt` ≤ nu, och `Tasks` med status QUEUED. Högst 6 körningar per omgång. |
| 5 | Loop Over Items (batchstorlek 1) | En agent i taget, för att hålla Airtable under 5 anrop per sekund. |
| 6 | Execute Sub-workflow | Workflow-id från `Agents.workflowId`. Vänta på resultatet. |
| 7 | Airtable: Update Agents | `nextRunAt` = nu + `cadenceMinutes` |

En hel omgång räknas som **en** körning, eftersom agenterna körs som sub-workflows. Innan en uppgift körs markeras den med `claimedBy` = körnings-id, så att två överlappande omgångar inte gör samma jobb.

---

## 6. API:t för dashboarden och kopplingen

### WF-00 Snapshot (webhook)

- **Webhook:** `GET`, sökväg `sentry/v1/snapshot`, samma autentisering och CORS som WF-01.
- **Airtable-läsningar:** SystemControl, veckans SpendLedger, Agents, Tasks från de senaste 48 timmarna, Approvals med status PENDING, Orders från de senaste 14 dagarna, AuditLog (de 80 senaste), aktiva Alerts och ToolCosts. Det blir ungefär 10–14 anrop per snapshot.
- **Code: Bygg snapshot** – exakt formen `DashboardSnapshot` i [`model.ts`](../src/app/core/domain/model.ts). Simuleringen ([`simulation.ts`](../src/app/core/mock/simulation.ts)) bygger samma form och kan användas som facit.
- **Respond to Webhook:** JSON, status 200.

### WF-02 Beslut (webhook)

`POST sentry/v1/approvals/decision`, med kroppen `{ approvalId, decision, note? }`.

- **Avvisa:** sätt status REJECTED och logga.
- **Godkänn budgetförslag (`BUDGET_LIMIT`):** läs `proposedLimitOre` från Approvals-raden, inte från anropet. Kontrollera att den är högst `limitCeilingOre` och högre än nuvarande `weeklyLimitOre`, skriv den till SystemControl och logga `WEEKLY_LIMIT_RAISED`. Kräver inte ARMED, eftersom en högre gräns inte kostar något i sig.
- **Godkänn produkt:** sätt Products till LIVE, skapa produkt, pris och betallänk i Stripe, och logga.
- **Godkänn kampanj:**
  1. Kräver ARMED.
  2. Reservera kampanjens livstidsbudget med WF-10 (kategori `ADS`). Nekas den → svara **422** med anledningen.
  3. Skapa kampanjen i Meta, först pausad och sedan aktiv. Lägg in en rad i Campaigns kopplad till reservationen.
  4. Logga.

### Koppla dashboarden

1. **Testa CORS innan du bygger vidare.** Dashboardens `Authorization`-header gör att webbläsaren först skickar en preflight (OPTIONS). Kontrollera att n8n svarar rätt:

   ```bash
   curl -i -X OPTIONS "https://DIN-INSTANS.app.n8n.cloud/webhook/sentry/v1/snapshot" \
     -H "Origin: https://DIN-DASHBOARD.pages.dev" \
     -H "Access-Control-Request-Method: GET" \
     -H "Access-Control-Request-Headers: authorization"
   ```

   Svaret ska innehålla `Access-Control-Allow-Origin` med din dashboardadress och `Access-Control-Allow-Headers` med `authorization`. Saknas de: lägg en liten proxy i Cloudflare Pages Functions (`/api/*` vidare till n8n). Då hamnar dashboard och API på samma domän, CORS behövs inte alls, och token ligger aldrig i webbläsaren.
2. **`src/environments/environment.ts`:**
   - `mode: 'n8n'`
   - `n8nBaseUrl: 'https://DIN-INSTANS.app.n8n.cloud/webhook/sentry/v1'`
   - `pollIntervalMs: 120_000`
3. **`public/_headers`:** `connect-src` måste innehålla din n8n-adress. `https://*.app.n8n.cloud` täcker n8n Cloud.
4. **Publicera** dashboarden på Cloudflare Pages bakom **Cloudflare Access**, även för förhandsadresserna.
5. Öppna panelen och ange token, värdet efter `Bearer `. Toppfältet ska visa "Synkad" utan varningen "poster kunde inte läsas".

---

## 7. Pengar in: Stripe och butiken

### WF-30 Stripe-webhook

- **Stripe Trigger** för händelserna `checkout.session.completed` och `charge.refunded`. Noden registrerar webhooken och kontrollerar signaturen.
- **Ny order:**
  1. Hämta avgiften från chargens balance transaction.
  2. Skapa en rad i Orders med belopp, moms, avgift, inköp och frakt från produkten.
  3. Gäller det en fysisk vara: skapa en `Tasks`-rad (QUEUED) till COURIER.
- **Återbetalning:** uppdatera `refundedOre` och status, och logga.

Inkommande betalningar registreras **även i låst läge**, eftersom de inte kostar något och bokföringen måste stämma. Leverantörsbeställningar (COURIER) körs däremot bara när systemet är aktiverat.

---

## 8. Sentinel och veckogränsen

### WF-90 Sentinel (sub-workflow från dispatchern, plus ett eget schema en gång per dygn)

| Regel | Åtgärd |
| --- | --- |
| Förbrukat + reserverat ≥ `warnAtBp` | Larm WARNING, en gång per vecka |
| Kvarvarande budget räcker inte till minsta körning | Larm WARNING |
| ACTIVE-reservation äldre än 30 minuter | Larm WARNING, visas för granskning |
| Systemet är låst men en kampanj körs | Kör WF-91 |
| Kostnad över reservation | WF-12 Lås och larm CRITICAL (utlöses från WF-11) |

Sentinel får låsa men aldrig aktivera. Det dagliga schemat behövs för att se kampanjer som körs i låst läge, när dispatchern är avstängd.

### WF-14 Veckogräns (schema måndagar 00:05, Europe/Stockholm)

Gränsen växer med vinsten, men bara när du säger ja. Flödet kör även i låst läge, eftersom det bara räknar och inte anropar någon AI.

1. **Välj vecka:** den senaste ISO-vecka som slutade minst `settleDays` (14) dagar sedan. En måndag i vecka 45 blir det vecka 42, så alla dess ordrar har passerat ångerrätten.
2. **Räkna realiserad vinst** för den veckan med samma formel som resultaträkningen: nettoförsäljning minus inköp, frakt, Stripe-avgifter, annonser, AI, API och verktygens veckoandel. Återbetalningar som kommit in sedan dess räknas med.
3. **Ta bort** ett gammalt budgetförslag som fortfarande väntar (status `EXPIRED`).
4. **Vinst:** ny gräns = nuvarande + `profitShareBp` av vinsten, avrundat nedåt till hela kronor, högst `limitCeilingOre`. Skapa en Approvals-rad med `kind` = `BUDGET_LIMIT`, `requestedBy` = `T2-10`, `costOre` = 0 och `proposedLimitOre`. Gränsen ändras inte förrän du godkänner i WF-02.
5. **Förlust:** sänk gränsen direkt med hela förlusten, aldrig under `baseLimitOre` och aldrig under det som redan är förbrukat och reserverat den här veckan. Logga `WEEKLY_LIMIT_LOWERED` som WARNING.
6. **Noll eller redan vid taket:** gör ingenting.

Samma regler finns som testad kod i [`budget-growth.ts`](../src/app/core/domain/budget-growth.ts).

---

## 9. Agenterna

### Mall för ett agentflöde

Varje agent är ett eget sub-workflow (WF-21–34) som bara startas av dispatchern eller av en överlämning:

1. **When Executed by Another Workflow** – indata `agentId`, `taskId`.
2. **Airtable:** läs agentens rad (modell, `systemPrompt`, `maxOutputTokens`, `effort`, `config`) och uppgiften. Markera uppgiften RUNNING.
3. **Code:** bygg anropet: system-prompt, uppgiftens indata och `output_config.format` med ett JSON-schema för det agenten ska leverera.
4. **HTTP Request** `POST https://api.anthropic.com/v1/messages/count_tokens` – exakt antal prompt-tokens.
5. **Code:** räkna ut värsta fallet i öre.
6. **Execute Sub-workflow WF-10.** Nekas den: markera uppgiften DENIED och agenten BLOCKED_BUDGET, och sluta.
7. **HTTP Request** `POST https://api.anthropic.com/v1/messages`:
   - headers: `anthropic-version: 2026-10-21` och credentialen `Anthropic`
   - kropp: `model`, `max_tokens`, `system`, `messages` och `output_config: { effort, format: { type: "json_schema", schema } }`
   - ingen `temperature`
   - slå på *Never Error*, så att svaret alltid kan avräknas
8. **Code:** läs `usage` och räkna fram den faktiska kostnaden. Kontrollera `stop_reason`:
   - `end_turn` = klart
   - `max_tokens` = utdata avkortad, uppgiften misslyckas
   - `refusal` = uppgiften misslyckas
   - API-fel utan svar räknas som 0. Ett tidsavbrott avräknas som hela reservationen och ger ett larm.
9. **Execute Sub-workflow WF-11** med den faktiska kostnaden.
10. **Airtable:** skriv resultatet och logga en rad i AuditLog. Skriv flera rader i samma anrop där det går (Airtable tar 10 per anrop).
    - uppgiften DONE med `output`
    - nya `Tasks` till nästa agent, alltså överlämningen
    - eventuella `Approvals`

**Siffror räknas i kod, inte av modellen.** VOID låter modellen motivera ett pris, men marginalen räknas av samma formel som [`order-economics.ts`](../src/app/core/domain/order-economics.ts).

### Agenternas uppdrag och vad de kräver

| Agent | Startas av | Skriver | Kräver utöver Claude | Slå på |
| --- | --- | --- | --- | --- |
| SENTINEL | Varje dispatcheromgång, dagligen | Alerts, låsning | – | Först av alla |
| SCOUT | Dagligen | Tasks till VOID med produktkandidater | Webbsökning, gärna ett leverantörs-API | v1 |
| PULSE | Dagligen | Tasks till SCOUT och PRISM | Webbsökning | v1 |
| RECON | Dagligen | Konkurrentpriser på LIVE-produkter, Tasks till VOID | Webbsökning | v1 |
| HARBOR | Överlämning | Leverantör, leveranstid och inköpspris på kandidaten | Leverantörskonto, annars manuella uppgifter | v1 |
| ATLAS | Överlämning, veckovis | Marknadsbedömning på kandidaten | Webbsökning | v1 |
| VOID | Överlämning | Approvals PRODUCT_LAUNCH med beräknad marginal | – | v1 |
| STAR | Måndagar | Veckans strategi, Tasks till PULSE och FOUNDRY | – | v1 |
| LEDGER | Dagligen | Avstämning mot Stripe, avvikelser till SENTINEL | Stripe | v1 |
| QUILL | Ny LIVE-produkt | Produkttext som utkast | – | v1 (utkast) |
| COURIER | Ny betald order | Leverantörsbeställning och spårning | Leverantörs-API, annars en uppgift till dig | När butiken är live |
| HAVEN | Inkommande kundmejl | Svarsutkast som du skickar | Mejlkoppling i n8n | När butiken är live |
| MUSE | Överlämning | Annonstexter till VECTOR | – | När annonser ska köras |
| VECTOR | Överlämning | Approvals CAMPAIGN_LAUNCH | Meta-app, systemanvändare, annonskonto, pixel | När annonser ska köras |
| PRISM | Veckovis | Målgruppsprofil från sammanställd orderdata (inga personuppgifter) | Tillräckligt många ordrar | Senare |
| CATALYST | Veckovis | Förslag på förbättringar av produktsidor | Analysverktyg | Senare |
| BEACON | Överlämning från QUILL | SEO-metadata | En butik att publicera i | Senare |
| FOUNDRY | Överlämning från STAR | Utkast till digital produkt och ett Approval | Leverans av filer efter köp | Senare |
| MAGNET | – | Kvalificerade leads | En källa till leads, till exempel ett nyhetsbrev | Senare |
| CONDUIT | – | B2B-pipeline | B2B-förfrågningar | Senare |

Slå på en agent i taget. Börja med SENTINEL och SCOUT, kör en omgång och läs vad som hamnade i Airtable innan nästa agent slås på.

---

## 10. Acceptanstest innan riktiga pengar

Kör med Stripe i testläge, en veckogräns på 20 kr och en liten kredit hos Anthropic.

- [ ] **Låst = nej:** WF-10 nekar en förfrågan på 1 öre med `SYSTEM_LOCKED`.
- [ ] **Gränsen håller:** en förfrågan som är 1 öre större än det som återstår nekas med `BUDGET_EXCEEDED`. En som är exakt lika stor godkänns.
- [ ] **Samtidighet:** fem anrop till spärren samtidigt, som tillsammans överstiger gränsen. Använd ett testflöde med webhook och `curl … &` fem gånger. Summan av de godkända ryms i gränsen, och nekade reservationer är RELEASED.
- [ ] **Omförsök:** samma `requestId` två gånger ger en enda reservation.
- [ ] **Överdrag:** WF-11 med `actualOre` över reservationen låser systemet och ger ett kritiskt larm.
- [ ] **Aktivering:** fel `expectedRevision` ger 409. En slut budget ger 422.
- [ ] **Lås från panelen:** dispatchern blir inaktiv och en testkampanj pausas.
- [ ] **Lås i Airtable:** sätt `lockedAt` till nu för hand. Nästa dispatcheromgång stoppar och inaktiverar sig själv.
- [ ] **CORS:** preflight-testet i steg 6 passerar och panelen synkar.
- [ ] **Kontraktet:** panelen visar inga "poster kunde inte läsas".
- [ ] **Stripe:** en testorder syns med rätt moms, avgift och marginal. En återbetalning ger förlust på ordern.
- [ ] **Vecka:** en rad med förra veckans `weekId` räknas inte in i veckans förbrukning.
- [ ] **Budgetförslag:** kör WF-14 för hand med en vinstvecka som ligger minst 14 dagar bak. Ett förslag dyker upp under Produktförslag, och `weeklyLimitOre` är oförändrad tills du godkänner.
- [ ] **Budgetförslag, taket:** sätt `proposedLimitOre` över `limitCeilingOre` för hand och godkänn. WF-02 nekar, och gränsen ändras inte.

Först när allt är grönt: höj veckogränsen i Airtable, byt Stripe till live och slå på agenterna en i taget.

---

## Kvoter i drift

**n8n-körningar per månad** ≈ panelens polls + dispatcherns omgångar + Stripe-händelser + kommandon.

| Post | Exempel | Per månad |
| --- | --- | --- |
| Panelen | Öppen 4 timmar om dagen, en hämtning varannan minut | ≈ 3 600 |
| Dispatchern | Var 30:e minut, bara när systemet är aktiverat (här 12 timmar om dagen) | ≈ 720 |
| Stripe | 15 ordrar om dagen plus några återbetalningar | ≈ 500 |
| Kommandon | Lås, aktivera, beslut | ≈ 300 |
| **Summa** | | **≈ 5 100**, ryms i Pro |

**Airtable-anrop per månad** ≈ snapshots × 12 + agentkörningar × cirka 20.

- Med exemplet ovan: 3 600 × 12 ≈ 43 000.
- Med 60 agentkörningar om dagen tillkommer cirka 36 000.
- Summan, ungefär 79 000, ryms i Team men med liten marginal.

Ligger du nära taket: öppna panelen mer sällan, höj intervallet, kör agenterna mer sällan eller gå över till Business.

---

## Innan riktiga kunder

Utanför Airtable och n8n, men lika nödvändigt:

- registrerat företag med F-skatt och momsregistrering
- ett Stripe-konto i företagets namn
- villkor med ångerrätt (14 dagar), tydlig leveranstid och totalpris
- integritetspolicy, och samtycke till annonspixlar
- produktsäkerhet: den som importerar elektronik till EU ansvarar för CE-märkningen

Ta hjälp av en rådgivare för detaljerna.

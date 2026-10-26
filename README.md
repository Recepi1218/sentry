# Sentry

Kontrollpanelen för Sentry, ett virtuellt e-handelsbolag där 20 AI-agenter i två divisioner hittar produkter, räknar på marginaler och driver kampanjer, medan du behåller kontrollen över varje krona.

- **Huvudbrytare.** Systemet startar låst. Att aktivera kräver två avsiktliga steg och en godkänd förkontroll. Att låsa kräver ett klick, var du än är.
- **Hård veckogräns.** Varje kostnad reserveras med sitt värsta fall innan den får uppstå. Spärren tål samtidiga agenter och felar alltid åt nej.
- **Ekonomi i realtid.** Täckningsbidrag och marginal per order räknas fram ur råa Stripe-siffror, med moms, avgifter, inköp, frakt och annonskostnad.
- **Agenter och logg.** Vad varje agent gör just nu, dess historik, hur agenterna lämnar över arbete via n8n och Airtable, och en audit-logg över alla beslut.

Allt körs i molnet: dashboarden är statiska filer, logiken körs i n8n Cloud och datan ligger i Airtable. Hur delarna hänger ihop står i [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), och tabellerna beskrivs i [docs/DATA-MODEL.md](docs/DATA-MODEL.md).

## Kom igång

Kräver Node 22 eller senare och pnpm.

```bash
pnpm install
pnpm start
```

Öppna http://localhost:4200. Dashboarden kör mot en simulering i webbläsaren (simulerad Stripe, n8n och Airtable) som använder samma budgetspärr som produktionen ska använda. Prova att lyfta skyddet, aktivera, godkänna en kampanj och låsa igen.

Simuleringen kör agenterna i snabbare takt än i verklig drift, så att det händer något att titta på. Verktygskostnaderna är exempelbelopp.

## Kommandon

| Kommando | Gör |
| --- | --- |
| `pnpm start` | Utvecklingsserver med simulering |
| `pnpm test` | Enhetstester (Vitest), bland annat budgetspärren under samtidighet |
| `pnpm build` | Produktionsbygge till `dist/sentry/browser`, statiska filer |

## Till drift

1. Bygg Airtable-basen och n8n-flödena enligt dokumentationen. Börja med budgetspärren (WF-10/11).
2. Sätt tak hos leverantörerna: förbetalda krediter utan automatisk påfyllning och utgiftsgränser på annonskonton.
3. Lägg `dist/sentry/browser` på Cloudflare Pages bakom Cloudflare Access och justera `connect-src` i `public/_headers`.
4. Sätt `mode: 'n8n'`, `n8nBaseUrl` och `pollIntervalMs` i `src/environments/environment.ts`.

Dashboarden innehåller inga hemligheter. Åtkomsttoken till n8n skrivs in när du ansluter och sparas bara i den aktuella fliken.

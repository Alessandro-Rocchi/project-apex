# Design Doc: Virtual Safety Car (VSC) & Cheap Pit Stop Window

**Data:** 12 Novembre 2026  
**Stato:** Approvato in brainstorming, pronto per implementazione  
**Branch target:** `test_branch_ideas`

---

## 1. Intent & Motivazione ("The Why")
In Project Apex (v1.0.0), le neutralizzazioni di gara prevedono attualmente solo la Bandiera Gialla locale e la Full Safety Car fisica (che compatta l'intero gruppo a 48 m/s dietro alla vettura di sicurezza).
L'aggiunta della **Virtual Safety Car (VSC)** introduce un elemento fondamentale della moderna tattica motorsport:
- Riduce la velocità di tutte le auto di circa il 38% congelando i distacchi temporali (nessun compattamento a trenino).
- Crea la classica **finestra di sosta opportunistica ("cheap pit stop")**: mentre le auto in pista viaggiano a velocità ridotta (~140 km/h invece di 280-320 km/h), la corsia box mantiene il consueto limite a 80 km/h. Il delta perso in un pit stop crolla quindi da circa **21s** a circa **11s**, trasformando la VSC in un dilemma strategico ad alta tensione sia per il giocatore che per l'IA avversaria.

---

## 2. Obiettivi, Non-Obiettivi e Anti-Obiettivi

### Obiettivi (Goals)
1. **Stato Gara**: Estendere `RaceControlStatus` in `src/types/telemetry.ts` con `'VIRTUAL_SAFETY_CAR'` e tracciare `vscLapsRemaining: number` nello snapshot di simulazione.
2. **Dinamica di Pista**:
   - Velocità uniforme limitata al 62% rispetto alla velocità di riferimento (`rawSpeedMs = Math.min(rawSpeedMs * 0.62, segment.referenceSpeedMs * 0.62)`).
   - Congelamento dei distacchi temporali: vietato il sorpasso, nessun raggruppamento artificiale (le auto mantengono i gap reali).
   - DRS disabilitato e aria sporca neutralizzata.
   - Usura gomme ridotta al 35% e consumo carburante al 40% (coerente con la SC).
3. **Trigger Incidenti Differenziati**:
   - Guasti lievi/ritiri a bordo pista o contatti leggeri: attivano la **VSC** per 1 o 2 giri.
   - Incidenti gravi (guasti a centro pista): mantengono la **Full Safety Car**.
4. **IA Strategica (`aiStrategist.ts`)**:
   - I team rivali valutano al volo se la finestra VSC è conveniente: se `raceControl === 'VIRTUAL_SAFETY_CAR'`, con gomme con usura `< 0.60` o ala danneggiata `frontWingDamage >= 20`, viene chiamata la sosta immediata.
5. **Pit Wall UI & Audio**:
   - Badge telemetrico giallo/ambra pulsante `[VSC] VIRTUAL SAFETY CAR` nell'header della gara.
   - Messaggi radio dedicati: `[VSC ATTIVATA]: Virtual Safety Car in pista. Mantenere le posizioni.` e `[VSC TERMINATA]: Bandiera Verde! Riprende la corsa.`.
   - Audio beep radio all'attivazione/disattivazione.
6. **Test Suite (`test.ts`)**:
   - Verifica automatica in Node.js su:
     - Riduzione della velocità al ~62% durante VSC.
     - Preservazione dei distacchi temporali (nessun compattamento).
     - Riduzione dell'usura e del consumo di carburante.
     - Chiamata ai box dell'IA sotto VSC.
     - Transizione VSC -> GREEN dopo il completamento dei giri previsti.

### Non-Obiettivi (Non-Goals)
- Gestione manuale del delta time con acceleratore o rischio di penalità FIA (+5s) per il giocatore: abbiamo scelto la modalità strategica pura (Opzione A).
- Durata a tempo continuo (secondi arbitrari) con interruzione a metà settore: si mantiene la risoluzione pulita sui giri del leader.

### Anti-Obiettivi (Anti-Goals)
- Nessun artefatto o scatto visivo ("jitter" o effetto fisarmonica) sul radar 2D a spline Catmull-Rom di `TrackCanvas`.
- Evitare che le auto rallentino a 48 m/s compattandosi a 0.45s l'una dall'altra (comportamento riservato esclusivamente alla Full Safety Car).

---

## 3. Approcci Considerati e Scelta

1. **Approccio 1: Velocità Scalata Uniforme & Durata su Giri Leader (SELEZIONATO)**
   - Riduzione percentuale istantanea del passo per tutte le vetture, distacchi preservati, gestione sui passaggi del leader.
   - *Motivo della scelta*: Massima pulizia, zero jitter sul Canvas 2D, perfetto allineamento con l'architettura a passi `dt = 0.1s` di `raceEngine.ts`.
2. **Approccio 2: Timer Continuo con Fase Transitoria "VSC ENDING" (Scartato)**
   - *Motivo dello scarto*: Aggiungeva stati intermedi superflui e rischio di brusche accelerazioni in frenata.
3. **Approccio 3: Target Delta FIA Settore per Settore (Scartato)**
   - *Motivo dello scarto*: Over-engineering non necessario per un muretto box strategico 2D; rischio oscillazioni numeriche sulle posizioni.

---

## 4. Dettagli Architetturali e File Coinvolti

| File | Modifiche Previste |
|---|---|
| `src/types/telemetry.ts` | Aggiungere `'VIRTUAL_SAFETY_CAR'` a `RaceControlStatus`. Aggiungere `vscLapsRemaining: number` a `RaceSimulationSnapshot`. |
| `src/engine/raceEngine.ts` | Differenziare la generazione guasti/incidenti (VSC vs SC). Nel calcolo velocità, se `raceControl === 'VIRTUAL_SAFETY_CAR'`, applicare il moltiplicatore 0.62. Disabilitare DRS e sorpassi. Gestire decremento `vscLapsRemaining` al passaggio del leader. |
| `src/engine/aiStrategist.ts` | Aggiungere la logica della sosta opportunistica sotto VSC (gomme < 60% usura o ala danneggiata). |
| `src/App.tsx` | Visualizzazione badge VSC nello status bar del muretto box, stile ambra dedicato, radio alert. |
| `test.ts` | Suite di test per validare la fisica, la conservazione distacchi, il consumo e la logica IA sotto VSC. |

---

## 5. Criteri di Accettazione e Verifica
- `npm test` passa senza errori, inclusi i nuovi test di fisica e logica della VSC.
- `npm run lint` passa senza errori o warning ESLint.
- `npm run build` genera il bundle di produzione pulito senza errori TypeScript.
- In gara, alla comparsa della VSC, tutte le auto rallentano mantenendo i distacchi, l'avviso radio viene stampato, il badge compare nella telemetria e la finestra pit stop risulta vantaggiosa per chi effettua il cambio gomme.

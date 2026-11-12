# Design Doc: Sistema di Creazione Scuderia Personalizzata (Custom Team Creator)

**Data:** 12 Novembre 2026  
**Stato:** Pronto per l'Approvazione Finale  
**Branch target:** `test_branch_ideas`

---

## 1. Intent & Motivazione ("The Why")
Project Apex include un universo coerente con 10 scuderie e 30 piloti. Attualmente, per correre con una scuderia personalizzata il giocatore deve modificare manualmente un file JSON esterno e importarlo.

Il **Custom Team Creator** colma questa lacuna offrendo un'esperienza integrata "in-game":
- Permette al giocatore di fondare la propria scuderia definendo identità societaria (Nome, Nazionalità), livrea (colori primario e secondario esadecimali con stemma vettoriale dinamico) e posizionamento strategico (da Top Team a Underdog).
- Sostituisce uno dei 10 team esistenti sulla griglia per preservare la collaudata formula a 10 team e 20 monoposto (Q1-Q2-Q3 a eliminazione, punteggi FIA top 10, radar di gara e budget cap).
- Integra la scuderia direttamente nel database attivo di gioco (`career.db`), rendendola immediatamente utilizzabile sia nella modalità Carriera che nelle gare singole del Weekend Veloce, con piena esportabilità in formato JSON.

---

## 2. Obiettivi, Non-Obiettivi e Anti-Obiettivi

### Obiettivi (Goals)
1. **Punto di Ingresso nel Menu Principale:**
   - Aggiungere il pulsante `🛠️ FONDA LA TUA SCUDERIA` nella schermata principale (`MAIN_MENU`), in testa all'elenco delle scuderie.
   - Aggiungere contestualmente il pulsante `🔄 RIPRISTINA DATABASE PREDEFINITO` con dialogo di conferma per ripristinare in sicurezza i 10 team originali (`DEFAULT_DB`).
   - Aggiungere un pulsante rapido `💾 ESPORTA DATABASE (.JSON)` accanto al caricamento custom DB.
2. **Componente Wizard (`src/components/teamCreatorModal.tsx`):**
   - **Step 1: Identità & Livrea:**
     - Campi input: Nome Scuderia (validato non vuoto), Nazionalità.
     - Color picker per `colorHex` (primario) e `accentHex` (secondario/accento).
     - Anteprima in tempo reale dello scudetto vettoriale esagonale identico a quello mostrato nella griglia di selezione (`<svg>` polygon con riempimento primario e bordo secondario).
   - **Step 2: Scelta Team da Sostituire & Livello di Competitività (Tier 1–5):**
     - Dropdown per indicare quale delle 10 scuderie attuali viene rimpiazzata.
     - Selettore del Tier di competitività da 1 a 5:
       - **Tier 1 (Top Team):** Budget 48 M€, Strutture HQ (Fabbrica 3, Galleria 3, Simulatore 3), Componenti media ~92-95.
       - **Tier 2 (Midfield Alto):** Budget 40 M€, Strutture (Fabbrica 2, Galleria 3, Simulatore 2), Componenti ~88-91.
       - **Tier 3 (Midfield):** Budget 33 M€, Strutture (Fabbrica 2, Galleria 2, Simulatore 2), Componenti ~84-87.
       - **Tier 4 (Midfield Basso):** Budget 26 M€, Strutture (Fabbrica 1, Galleria 2, Simulatore 1), Componenti ~80-83.
       - **Tier 5 (Underdog):** Budget 20 M€, Strutture (Fabbrica 1, Galleria 1, Simulatore 1), Componenti ~75-79.
     - Calcolo immediato e idratazione fisica via `hydrateTeamPhysics()` con visualizzazione delle metriche calcolate: PWR, AERO, Grip Meccanico e Affidabilità.
   - **Step 3: Line-up Piloti & Seat-Swap Intelligente:**
     - Due slot per i piloti titolari (`PRIMARY` e `SECONDARY`).
     - **Mercato aperto su tutti i 30 piloti:** il giocatore può selezionare qualsiasi pilota del database (oppure premere `🎲 Assegna Casuali` per estrarre due piloti coerenti con il Tier scelto).
     - **Meccanismo di Seat-Swap (Garanzia Griglia 20 Vetture):**
       - Se viene ingaggiato un pilota titolare da un team rivale, il pilota della scuderia sostituita va automaticamente a coprire il sedile rimasto vacante nel team rivale.
       - Eventuali piloti della scuderia sostituita non impiegati né scambiati passano al pool `FREE_AGENT` (`teamId: null`).
       - Il pilota di riserva (`RESERVE`) della scuderia sostituita viene ereditato dalla nuova scuderia come collaudatore, assicurando la presenza del 3º pilota per le FP1 in `setupGarage.tsx` e `hqView.tsx`.
3. **Persistenza & Inizializzazione Carriera:**
   - Alla conferma della fondazione, viene generata una nuova carriera pulita (Stagione 1, Giorno 1, Round 0) con `createInitialCareerState(updatedDb, newTeamId, distancePreset)`.
   - Il salvataggio viene memorizzato in `localStorage` (`SAVE_STORAGE_KEY`) e la nuova scuderia è immediatamente selezionata come `playerTeamId`.
4. **Validazione & Robustezza:**
   - Il database risultante deve soddisfare al 100% `validateCustomDatabase(db)`.
   - Test automatici dedicati in `test.ts` a garanzia della non-regressione.

### Non-Obiettivi (Non-Goals)
- Editor 3D della livrea (si utilizzano i due colori esadecimali del design system Pit Wall OS).
- Creazione manuale di nuovi piloti fittizi da zero (la line-up è formata dai 30 piloti dell'ecosistema di gioco).
- Griglia a 11 scuderie (rimane calibrata sulla formula a 10 team e 20 vetture).

### Anti-Obiettivi (Anti-Goals)
- Nessun errore di runtime per ID mancanti o squadre con meno di 2 piloti in `raceEngine`, `qualifyingEngine`, o `hqSimulator`.
- Nessun crash all'avvio della Carriera o del Weekend Veloce con la scuderia personalizzata selezionata.

---

## 3. Approcci Considerati e Scelta

### 1. Approccio A: Modal / Wizard Guidato nel Menu Principale (SELEZIONATO)
- Componente `src/components/teamCreatorModal.tsx` richiamato dal Menu Principale.
- *Motivo della scelta:* Mantiene il giocatore nel contesto del menu principale, mostra anteprima live SVG e statistiche, e colloca subito la nuova squadra nella griglia di partenza.

### 2. Approccio B: Schermata Dedicata a Tutto Schermo (`CREATE_TEAM` in `AppView`) (Scartato)
- *Motivo dello scarto:* Aggiunge overhead di navigazione tra viste per un'operazione eseguita una tantum.

---

## 4. Dettagli Architetturali e File Coinvolti

| File | Modifiche Previste |
|---|---|
| `src/components/teamCreatorModal.tsx` | **Nuovo componente**: form wizard suddiviso in sezioni (Identità con color picker e anteprima SVG stemma esagonale, Selezione Team sostituito e Tier con preset bilanciati, Assegnazione Piloti manuale o random con validazione). |
| `src/App.tsx` | Integrazione modale (`isTeamCreatorOpen`), pulsanti `🛠️ FONDA LA TUA SCUDERIA`, `🔄 RIPRISTINA DATABASE PREDEFINITO` e `💾 ESPORTA DATABASE (.JSON)`. Callback di creazione team con logica di seat-swap e aggiornamento carriera. |
| `src/engine/carPhysicsMapper.ts` | Esportazione/riutilizzo di helper per la generazione e calcolo componenti. |
| `test.ts` | Test suite automatica che verifica: creazione scuderia custom, idratazione fisica, seat-swap dei piloti tra team rivali, validità del database (`validateCustomDatabase`), avvio qualifica e gara. |

---

## 5. Decisioni Tecniche Consolidate (Builder Calls)
1. **Seat-Swap Piloti (Decisione Utente):** Mercato aperto su tutti i 30 piloti. L'ingaggio di un pilota da una scuderia rivale comporta lo scambio automatico del pilota ceduto nel team rivale.
2. **Lifecycle Carriera:** La fondazione avvia una nuova carriera pulita (Stagione 1, Giorno 1) alla guida della scuderia creata.
3. **Collaudatore / Riserva:** Eredità automatica del collaudatore della scuderia sostituita per preservare la piena compatibilità con FP1 in `setupGarage` e la gestione HQ.
4. **Ripristino Database:** Il pulsante "Ripristina Database Predefinito" mostra una conferma visiva prima di resettare `localStorage` a `DEFAULT_DB`.
5. **Esportazione JSON:** Aggiunta di un pulsante rapido per esportare direttamente il database `GameDatabase` in formato `.json`, rendendo la scuderia creata condivisibile con altri giocatori.

---

## 6. Criteri di Accettazione e Verifica
1. `npm test` esegue e supera tutti i test esistenti più i nuovi test per la creazione scuderia personalizzata e il seat-swap.
2. `npm run lint` passa con 0 errori e 0 warning.
3. `npm run build` compila senza errori TypeScript in `dist/`.
4. Nel browser:
   - Cliccando "Fonda la tua Scuderia", il wizard consente di personalizzare nome, nazione, colori con anteprima SVG reattiva, scegliere quale team sostituire, impostare il Tier e scegliere o randomizzare i piloti.
   - Alla conferma, la scuderia compare nella griglia del Menu Principale, può correre un Weekend Veloce o guidare una Carriera multi-stagionale senza alcun errore di telemetria o simulazione.

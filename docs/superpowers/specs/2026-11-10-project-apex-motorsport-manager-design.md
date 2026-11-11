# Project Apex — Motorsport Manager: Design Document

**Data:** 2026-11-10  
**Stato:** Pronto per approvazione (Revisione architetturale superata)  
**Dimensione del Lavoro:** Progetto completo (Architettura Dati, Motore di Gara Evoluto, Weekend a 3 Sessioni, Quartier Generale Multi-Stagionale, UI "Pit Wall OS" e Audio Procedurale)

---

## 1. Intento e Motivazione (The Why)

Trasformare il prototipo attuale di **Project Apex** in un simulatore gestionale di motorsport a ruote scoperte completo, giocabile sia in modalità **Carriera Multi-Stagionale** sia in modalità **Weekend Veloce**, progettato secondo l'estetica telemetrica *Pit Wall OS* (ispirata a McLaren ATLAS, F1 TV Data Channel e Bloomberg Terminal) e totalmente **IP-Safe / Moddabile via JSON** a budget infrastrutturale $0\text{ €}$.

Il giocatore assume il ruolo di **Team Principal** di una delle 10 scuderie fittizie (dal Tier 1 da titolo mondiale al Tier 5 da ricostruire):
* **Tra le gare (Macro-Gestione HQ):** Governa il calendario giornaliero, lo sviluppo R&D dei 6 componenti della monoposto sotto il *Budget Cap*, il potenziamento delle 3 strutture (*Fabbrica*, *Galleria del Vento*, *Simulatore*), i contratti di piloti e collaudatore e gli obiettivi degli sponsor.
* **Nel weekend di gara (Micro-Gestione Muretto Box):** Gestisce le Prove Libere (setup a 5 parametri, Parco Chiuso e impiego del collaudatore), le Qualifiche (Q1/Q2/Q3) e la Gara in tempo reale continuo (Passo 1–5, Carburante, ERS, Pit Stop d'asciutto/bagnato, riparazione danni ala anteriore e Ordini di Scuderia).

---

## 2. Goals, Non-Goals e Anti-Goals

### Goals (Obiettivi)
1. **Motore Continuo Evoluto (`raceEngine.ts`):** Mantenere il motore cinematico a segmenti (`dt = 0.1s`) della demo con ERS, termodinamica gomme, DRS e Parco Chiuso, espandendolo a 20 vetture con 3 settori cronometrici FIA (viola/verdi/gialli), meteo dinamico (`DRY`, `LIGHT_RAIN`, `HEAVY_RAIN` + gomme `INTER` e `WET`), guasti meccanici/errori pilota, danni all'ala anteriore, Bandiera Gialla e Safety Car.
2. **Universo 100% Originale e Moddabile (`default_db.json`):** 10 scuderie fittizie con identità cromatica e loghi SVG parametrici, 20 piloti titolari + 10 collaudatori/Free Agent, e **12 circuiti completamente originali** (privi di qualsiasi riferimento a piste, città o curve reali).
3. **Selettore Distanza Gara (25% / 50% / 100%):** Adattamento automatico dei giri ($\sim 15$, $\sim 30$, $\sim 60$) e scalatura inversa di usura gomme e consumo carburante per garantire sempre $1\text{--}2$ soste tattiche.
4. **Quartier Generale e Carriera Multi-Stagionale:** Calendario giornaliero continuo, R&D su 6 componenti con rendimenti decrescenti, 3 strutture HQ potenziabili, mercato piloti con contratti/buyout, sponsor a obiettivi e transizione di fine stagione con premi Costruttori ed evoluzione IA.
5. **Estetica "Pit Wall OS" & Web Audio API:** Tipografia *Inter* + *JetBrains Mono* (`tabular-nums`), Track Canvas 2D con spline Catmull-Rom chiusa a 6 layer, grafici telemetrici post-gara e sintetizzatore audio nativo Web Audio API.
6. **Bilanciamento Verificato (Monte Carlo):** Script eseguibile da terminale (`simBenchmark.ts` / `test.ts`) che simula 100 gare headless per validare media pit-stop ($1.4\text{--}2.3$), distacchi e distribuzione vittorie.

### Non-Goals (Fuori Perimetro)
* Rendering 3D delle vetture o dei pit-stop.
* Telemetria fisica a $1000\text{ Hz}$ (sospensioni 3D o angoli di slip).
* Multiplayer online o backend server a pagamento.
* Simulazione completa di campionati giovanili (F2/F3).

### Anti-Goals (Cosa renderebbe il progetto un fallimento anche se funzionante)
* **Riferimenti a IP Reali nel DB base:** Nessun nome di circuito, curva (es. *Biassono*, *Parabolica*, *Ascari* presenti nel vecchio `mockData.ts`), team o pilota reale deve comparire nel database di default.
* **Tabelle Numeriche che "Tremano":** Nessun cronometro, distacco o percentuale deve cambiare larghezza durante lo scorrimento dei decimi (obbligo di font monospace e `font-variant-numeric: tabular-nums`).
* **Effetto "Sfilata" o "Palla di Neve" Economica:** Le gare non devono essere processioni senza sorpassi né lotterie casuali, e l'R&D in carriera non deve permettere di arrivare a $100/100$ in una sola stagione grazie alla legge dei rendimenti decrescenti e al *Budget Cap*.

---

## 3. Vincoli Tecnici (Constraints)

* **Stack Esistente:** React 19 (`^19.3.1`), TypeScript (`~6.0.0`), Vite (`^8.0.0`), Tailwind CSS (`^3.4.19`).
* **Zero Dipendenze NPM Esterne Aggiuntive:** Lo stato reattivo globale usa `useSyncExternalStore` nativo di React 19; i grafici post-gara e i loghi team usano `<canvas>` e `<svg>` nativi; l'audio usa `window.AudioContext`.
* **Compatibilità Ambiente Locale & Tauri:** Poiché `rustc`/`cargo` non sono installati sulla macchina locale, l'applicazione gira e viene testata come Web App / PWA completa con persistenza su `LocalStorage` ed Export/Import `.json` nativo, includendo i file di configurazione `src-tauri/` pronti per build desktop future.
* **Esecuzione Test in Node.js:** Il comando `npm test` (`node test.ts`) deve continuare a girare in puro Node senza dipendere da `window` o dal DOM.

---

## 4. Approcci Architetturali Valutati

1. **Approccio 1 (Scelto): Motore Puro TypeScript + Store Reattivo Nativo React 19 (`useSyncExternalStore`)**
   * *Descrizione:* I motori matematici (`raceEngine.ts`, `qualifyingEngine.ts`, `hqSimulator.ts`, `aiStrategist.ts`) sono moduli TypeScript puri e deterministici importabili sia da React sia da `node test.ts`. Uno store leggero basato su `useSyncExternalStore` gestisce lo stato della Carriera, del Weekend e il salvataggio automatico su `LocalStorage` + file `.json`.
   * *Trade-off:* Zero dipendenze esterne, nessuna latenza o complessità di serializzazione `postMessage`, testabilità immediata via CLI; il calcolo per 20 auto impiega $\sim 15\text{ }\mu\text{s}/\text{tick}$, lasciando oltre il $99\%$ del budget di frame a $60\text{ FPS}$ libero.
2. **Approccio 2 (Scartato): Web Worker Separato + Zustand**
   * *Descrizione:* Isolamento del loop gara in un Worker con sincronizzazione tramite messaggi asincroni e installazione di `zustand`.
   * *Trade-off:* Introduce overhead di clonazione ad ogni tick, richiede dipendenze npm esterne e complica l'esecuzione diretta di `node test.ts`.
3. **Approccio 3 (Scartato): Stato Monolitico in `App.tsx` (`useReducer`)**
   * *Descrizione:* Gestione di Carriera, HQ e Gara dentro lo stato locale del componente radice.
   * *Trade-off:* Rende `App.tsx` troppo vasto e accoppia la logica di business all'albero dei componenti UI.

---

## 5. Specifiche di Design e Decisioni Concordate

### 5.1 Struttura dei File del Progetto
```text
project-apex/
├── public/
│   └── data/
│       └── default_db.json          # Copia JSON esportabile/moddabile del database iniziale
├── src-tauri/                       # Configurazione Tauri v2 pronta per build desktop (.exe)
│   └── tauri.conf.json
├── src/
│   ├── types/
│   │   ├── telemetry.ts             # Tipi pista, auto in gara, meteo, settori, qualifiche
│   │   └── career.ts                # Tipi HQ, R&D (6 componenti), strutture, contratti, sponsor, DB
│   ├── data/
│   │   └── defaultDb.ts             # Database iniziale tipizzato (10 Team, 30 Piloti, 12 Piste, Sponsor)
│   ├── engine/
│   │   ├── carPhysicsMapper.ts      # Conversione 6 componenti R&D -> 4 parametri fisici + affidabilità
│   │   ├── raceEngine.ts            # Motore continuo a segmenti (20 auto, meteo, SC, danni, settori)
│   │   ├── qualifyingEngine.ts      # Motore sessioni Q1 / Q2 / Q3
│   │   ├── aiStrategist.ts          # Albero decisionale IA in gara e qualifica
│   │   ├── hqSimulator.ts           # Avanzamento giornaliero, R&D, strutture, mercato, fine stagione
│   │   └── simBenchmark.ts          # Simulatore Monte Carlo headless per QA e bilanciamento
│   ├── store/
│   │   └── gameStore.ts             # Store reattivo (useSyncExternalStore) + Save/Load + Custom DB
│   ├── utils/
│   │   ├── soundEffects.ts          # Sintetizzatore Web Audio API (Radio F1, click tattici, allarmi)
│   │   └── spline2D.ts              # Interpolazione Catmull-Rom chiusa e normali per TrackCanvas
│   ├── components/
│   │   ├── common/
│   │   │   ├── TeamBadge.tsx        # Logo SVG parametrico per le 10 scuderie
│   │   │   └── TopNavigationBar.tsx # Barra superiore contestuale (HQ / Weekend / Controlli Audio)
│   │   ├── menu/
│   │   │   └── MainMenuHub.tsx      # Scelta Scuderia (Tier 1-5), Nuova Carriera, Gara Veloce, Mod DB
│   │   ├── hq/
│   │   │   ├── HqDashboard.tsx      # Contenitore HQ con Calendario Giornaliero + Inbox Mail
│   │   │   ├── EngineeringRdView.tsx# Sviluppo Prestazione/Affidabilità dei 6 componenti
│   │   │   ├── FacilitiesView.tsx   # Upgrade Fabbrica, Galleria del Vento e Simulatore (Liv. 1-5)
│   │   │   ├── DriversMarketView.tsx# Contratti 2 Titolari + 1 Collaudatore + Scouting Free Agent
│   │   │   ├── FinanceSponsorsView.tsx # Budget Cap, Sponsor Principale e Obiettivi Secondari
│   │   │   └── StandingsCalendarView.tsx # Classifiche Piloti/Costruttori e i 12 GP
│   │   └── weekend/
│   │       ├── SetupGarage.tsx      # Prove Libere (5 slider, Collaudatore FP1, Parco Chiuso)
│   │       ├── QualifyingView.tsx   # Eliminatoria Q1 / Q2 / Q3 interattiva o simulata
│   │       ├── RacePitWallView.tsx  # Dashboard Gara 1080p (Radar 2D, Live Timing FIA, Muretto Box)
│   │       ├── TrackCanvas.tsx      # Radar vettoriale a 6 layer con spline Catmull-Rom e Pit Lane
│   │       └── PostRaceTelemetry.tsx# Risultati, punti, premi sponsor e grafici passo/posizioni
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
└── test.ts                          # Suite di test automatici + test Monte Carlo
```

### 5.2 Modello Dati: 10 Scuderie, 6 Componenti R&D e 6 Statistiche Pilota

#### Le 10 Scuderie Fittizie (`defaultDb.ts` & `default_db.json`)
| ID | Nome Scuderia | Nazione | Primario | Accento | Tier | Budget Iniziale |
| :--- | :--- | :--- | :--- | :--- | :---: | :---: |
| `corsa-rossa` | **Scuderia Corsa Rossa** | Italia | `#DC2626` | `#FACC15` | Tier 1 | $48\text{ M€}$ |
| `apex-tauron` | **Apex Tauron Racing** | Austria | `#1E3A8A` | `#EF4444` | Tier 1 | $48\text{ M€}$ |
| `silberpfeil` | **Silberpfeil Motorsport** | Germania | `#0D9488` | `#E2E8F0` | Tier 1 | $46\text{ M€}$ |
| `woking-papaya` | **Woking Papaya GP** | UK | `#F97316` | `#38BDF8` | Tier 2 | $40\text{ M€}$ |
| `emerald-sovereign` | **Emerald Sovereign** | UK | `#065F46` | `#D97706` | Tier 2 | $38\text{ M€}$ |
| `lumiere-equipe` | **Lumière Équipe** | Francia | `#2563EB` | `#EC4899` | Tier 3 | $32\text{ M€}$ |
| `sakura-horizon` | **Sakura Horizon** | Giappone | `#F8FAFC` | `#E11D48` | Tier 3 | $32\text{ M€}$ |
| `stars-stripes` | **Stars & Stripes Racing** | USA | `#374151` | `#EF4444` | Tier 4 | $26\text{ M€}$ |
| `nordic-volt` | **Nordic Volt GP** | Svezia | `#0284C7` | `#FDE047` | Tier 5 | $22\text{ M€}$ |
| `iberia-hispania` | **Iberia Hispania F1** | Spagna | `#7C3AED` | `#F59E0B` | Tier 5 | $20\text{ M€}$ |

#### I 6 Componenti R&D e Mappatura Fisica (`carPhysicsMapper.ts`)
Ogni scuderia possiede 6 componenti (`powerUnit`, `frontWing`, `rearWing`, `floor`, `suspension`, `brakes`), ciascuno con:
* `performance`: $0\text{--}100$
* `reliability`: $0\text{--}100$

La conversione verso i 4 parametri usati dal motore di pista nei segmenti (`STRAIGHT`, `CORNER_SLOW`, `CORNER_FAST`) è:
* $\text{Power} = P_{\text{powerUnit}}$
* $\text{AeroEfficiency} = \text{round}(0.40 \cdot P_{\text{frontWing}} + 0.60 \cdot P_{\text{rearWing}})$
* $\text{Downforce} = \text{round}(0.50 \cdot P_{\text{floor}} + 0.30 \cdot P_{\text{rearWing}} + 0.20 \cdot P_{\text{frontWing}})$
* $\text{MechanicalGrip} = \text{round}(0.60 \cdot P_{\text{suspension}} + 0.40 \cdot P_{\text{brakes}})$
* $\text{OverallReliability} = \text{media ponderata delle 6 affidabilità (con peso maggiore su } \text{powerUnit}\text{ } 30\% \text{)}$.

*(Se in gara la vettura subisce un danno all'ala anteriore `frontWingDamage` $\in [0, 100]$, i valori effettivi di `Downforce` e `AeroEfficiency` di quella singola auto calano fino al $-18\%$ finché non viene riparata ai box).*

#### I Piloti (6 Attributi + Contratto)
Ogni pilota ha:
* `pace` ($1\text{--}100$): velocità pura sul giro e nei segmenti.
* `consistency` ($1\text{--}100$): riduce le oscillazioni stocastiche di velocità e la probabilità di errore pilota (bloccaggio, danno ala o ritiro).
* `smoothness` ($1\text{--}100$): riduce il consumo gomme per secondo.
* `overtaking` ($1\text{--}100$): efficacia negli attacchi ruota a ruota.
* `defense` ($1\text{--}100$): resistenza ai tentativi di sorpasso altrui.
* `wetSkill` ($1\text{--}100$): riduce la perdita di grip quando c'è acqua in pista.
* Dati carriera: `role` (`PRIMARY` | `SECONDARY` | `RESERVE` | `FREE_AGENT`), `age`, `salaryPerRace`, `contractYearsLeft`, `buyoutCost`.

### 5.3 I 12 Circuiti 100% Originali ("IP-Safe")
I 12 Gran Premi stagionali utilizzano nomi, regioni e curve totalmente inventati che rappresentano archetipi tecnici diversi:
1. **GP di Valdorata — Autodromo Nazionale del Sole** (Veloce a basso carico, lunghi rettilinei e staccate violente, rischio pioggia $10\%$).
2. **GP di Costa Azzurra — Circuito Cittadino di Porto Cristallo** (Tortuoso cittadino sul mare, muretti stretti, altissima difficoltà sorpasso, massimo carico aerodinamico, rischio pioggia $20\%$).
3. **GP delle Alpi — Tauri Ring** (Saliscendi alpino veloce con 3 zone DRS e staccate in pendenza, rischio pioggia $35\%$).
4. **GP del Regno — Complesso Aerodromo di Albion** (Sequenze di curvoni ad alta velocità, elevata abrasività laterale delle gomme, rischio pioggia $40\%$).
5. **GP delle Ardenne — Foresta di Ardenia** (Tracciato lunghissimo, misto veloce e microclima altamente variabile, rischio pioggia $50\%$).
6. **GP delle Dune — Circuito Notturno di Sahrani** (Deserto abrasivo, forte trazione in uscita dalle curve lente, rischio pioggia $5\%$).
7. **GP del Levante — Autodromo Tecnico di Oriens** (Circuito a "otto" con cambi di direzione rapidi, esalta telaio e carico aerodinamico, rischio pioggia $35\%$).
8. **GP Nordico — Anello Glaciale di Valkyria** (Asfalto liscio a bassa temperatura, difficile mandare in temperatura le gomme Hard, rischio pioggia $30\%$).
9. **GP Atlantico — Baia di Nova Esperança** (Giro corto e ritmato, rettilineo in salita, frequenti acquazzoni estivi, rischio pioggia $45\%$).
10. **GP degli Altipiani — Autodromo Sierra Alta** (Aria rarefatta ad alta quota: minor resistenza aerodinamica ma minor raffreddamento, rischio pioggia $15\%$).
11. **GP dell'Iberia — Circuito Solare di Alcázar** (Pista da test aerodinamico puro con misto tecnico nel terzo settore, rischio pioggia $15\%$).
12. **GP Finale dell'Orizzonte — Marina di Yasmina** (Gran finale al tramonto con 2 lunghi rettilinei DRS e settore finale guidato, rischio pioggia $5\%$).

### 5.4 Selettore Distanza Gara (25% / 50% / 100%)
Prima di iniziare il weekend (o nelle impostazioni carriera), il giocatore sceglie la lunghezza gara:
* **`SPRINT_25` (25%):** $\sim 14\text{--}18\text{ giri}$. Moltiplicatore usura gomme e consumo carburante $= 3.6\times$ rispetto al passo 100%, in modo che le gomme e i $28\text{ kg}$ di carburante riproducano l'esatta dinamica di 1–2 soste in $4\text{--}6\text{ minuti}$.
* **`STANDARD_50` (50%):** $\sim 28\text{--}35\text{ giri}$. Moltiplicatore usura/carburante $= 1.85\times$, carico benzina standard $\sim 55\text{ kg}$.
* **`FULL_100` (100%):** $\sim 55\text{--}70\text{ giri}$. Moltiplicatore usura/carburante $= 1.0\times$, carico benzina standard $\sim 105\text{ kg}$.

### 5.5 Il Weekend di Gara in 3 Sessioni

1. **Sessione 1: Prove Libere & Setup (`SetupGarage.tsx`):**
   * 5 slider meccanici/aerodinamici (*Ala Anteriore*, *Ala Posteriore*, *Rigidezza Sospensioni*, *Altezza da Terra*, *Brake Bias*).
   * Fino a 4 stint simulabili per restringere la finestra verde stimata. Il livello del **Simulatore HQ** riduce il raggio d'incertezza iniziale.
   * **Opzione "Schiera Collaudatore in FP1":** Sostituisce per il primo stint uno dei titolari con il 3° pilota, conferendo $+2$ punti esperienza alle statistiche del collaudatore e un bonus di $-2$ punti al raggio della finestra verde.
   * Blocco in **Parco Chiuso** prima delle Qualifiche (sbloccarlo dopo comporta partenza dalla Pit-Lane).

2. **Sessione 2: Qualifiche Q1 / Q2 / Q3 (`QualifyingView.tsx` & `qualifyingEngine.ts`):**
   * **Q1:** 20 vetture in pista; dalla $16^\text{a}$ alla $20^\text{a}$ vengono eliminate e assegnate alla griglia.
   * **Q2:** 15 vetture; dalla $11^\text{a}$ alla $15^\text{a}$ eliminate.
   * **Q3:** Top 10 si giocano la Pole Position.
   * In ogni taglio il giocatore sceglie per i suoi piloti qualificati: **Mescola** (`SOFT`/`MEDIUM`/`INTER`/`WET`), **Finestra di Uscita** (*Uscita Anticipata: Pista Libera ma Grip Base*, *Metà Sessione: Bilanciata*, *Ultimo Minuto: Massimo Grip Asfalto ma Rischio Traffico/Bandiera Gialla*) e **Spinta Giro Secco** (*Standard* vs *Quali Push*). Presente pulsante *"Simula Istantaneamente"* per risolvere il turno o l'intera qualifica in un clic.

3. **Sessione 3: La Gara al Muretto Box (`RacePitWallView.tsx` & `raceEngine.ts`):**
   * **Velocità di simulazione:** Pausa, $1\times$, $2\times$, $4\times$, $10\times$.
   * **Settori Cronometrici FIA (S1, S2, S3):** Ogni giro memorizza i 3 parziali. Nella tabella Live Timing i parziali sono colorati in **Viola** (`#A855F7`, record assoluto della gara), **Verde** (`#22C55E`, miglior parziale personale) o **Giallo/Grigio** (`#EAB308`/`#94A3B8`, parziale più lento).
   * **Comandi per ciascuno dei 2 piloti:**
     * **Passo Gomma (1–5):** `1` (Salva Gomma Estremo), `2` (Gestione), `3` (Bilanciato), `4` (Spinta), `5` (Attacco al Limite).
     * **Mappa Carburante:** `LIFT_COAST`, `STANDARD`, `RICH`.
     * **Modalità ERS:** `HARVEST`, `NEUTRAL`, `DEPLOY`, `OVERTAKE`.
     * **Pit Stop:** Scelta mescola (`SOFT`, `MEDIUM`, `HARD`, `INTER`, `WET`), toggle **"Ripara Danni Ala"** ($+4.5\text{ s}$ se `frontWingDamage > 0`) e pulsante **Chiama Box**.
     * **Ordini di Scuderia:** `NONE` (Libero), `HOLD_POSITION` (Congela posizioni tra compagni), `SWAP_POSITIONS` (Scambia posizione con il compagno).
   * **Meteo Dinamico e Pista Bagnata:**
     * `trackWaterLevel` $\in [0.00, 1.00]$ evolve in modo fluido in base al meteo corrente e alle previsioni visibili sul radar meteo del muretto.
     * Sotto `0.20` le gomme Slick (`S`/`M`/`H`) sono ottimali; tra `0.20` e `0.60` la gomma `INTER` è la più veloce; sopra `0.60` domina la `WET`. Se si usano gomme `INTER` o `WET` in gara, decade l'obbligo di usare 2 mescole d'asciutto.
   * **Guasti, Errori e Safety Car:**
     * Quando si verifica un ritiro (DNF per guasto meccanico o incidente), la Direzione Gara attiva **Bandiera Gialla** ($1\text{ giro}$) o **Safety Car** ($2\text{--}3\text{ giri}$). Sotto Safety Car i distacchi si riducono e fermarsi ai box fa risparmiare $\sim 9\text{ secondi}$ sul tempo netto perso, innescando scelte strategiche immediate per il giocatore e per l'IA (`aiStrategist.ts`).

### 5.6 Il Quartier Generale (Macro-Gestione tra i GP)
1. **Avanzamento Giornaliero & Inbox:**
   * Il calendario scorre di giorno in giorno; tra un GP e l'altro intercorrono $14\text{ giorni}$.
   * Ogni giorno avanzano i progetti R&D attivi e gli upgrade delle strutture. Al completamento arriva un messaggio nella **Inbox** del Team Principal.
2. **Ingegneria & R&D (6 Componenti + Budget Cap):**
   * Il giocatore può avviare progetti di miglioramento **Prestazione** o **Affidabilità** per ciascuno dei 6 componenti, fino al numero massimo di slot simultanei consentiti dalla *Fabbrica* (Liv. 1 $= 2\text{ slot} \to$ Liv. 5 $= 4\text{ slot}$).
   * **Legge dei Rendimenti Decrescenti:** Il costo in $\text{M€}$ e i giorni richiesti crescono esponenzialmente all'avvicinarsi a $95\text{--}100$, mentre il guadagno per progetto ($+2\text{--}5\text{ punti}$) è amplificato dal livello della *Galleria del Vento & CFD* per i pezzi aerodinamici (`frontWing`, `rearWing`, `floor`).
   * Tutte le spese R&D rientrano nel **Budget Cap Stagionale ($135.0\text{ M€}$)**.
3. **Strutture HQ (3 Reparti, Livelli 1–5):**
   * *Fabbrica:* Slot R&D paralleli ($2\text{--}4$) e riduzione tempi di sviluppo ($-5\%\text{ per livello}$).
   * *Galleria del Vento & CFD:* $+12\%\text{ per livello}$ al guadagno prestazionale dei progetti Aero/Fondo.
   * *Simulatore:* Riduce il raggio iniziale della finestra verde del setup nelle Prove Libere e aumenta la crescita dei piloti.
4. **Mercato Piloti & Contratti:**
   * Gestione contratti dei 2 titolari e del collaudatore: rinnovo, promozione del collaudatore a titolare o ingaggio di piloti dal mercato Free Agent / altri team (pagando l'eventuale buyout).
5. **Finanze & Sponsor:**
   * **Sponsor Principale:** Assegnato a inizio stagione in base al Tier del team, eroga un fisso a ogni GP.
   * **Sponsor Secondari (2 slot attivi):** Il giocatore sceglie gli sponsor prima del weekend (es. *"Almeno 1 auto in Q3"*, *"Piazzamento in Top 6"*, *"Entrambe le auto al traguardo"*, *"Sosta completata senza errori"*). Se l'obiettivo è centrato a fine gara, il bonus viene accreditato.
6. **Fine Stagione e Multi-Stagione:**
   * Al termine del $12^\circ$ GP: assegnazione del montepremi Costruttori in base alla classifica finale, scatto di un anno dei contratti, evoluzione statistiche piloti, simulazione R&D off-season delle 9 scuderie IA, reset del Budget Cap e avvio della nuova stagione.

### 5.7 Cosa Resta allo Sviluppatore (Left to the Builder)
* Coefficienti numerici di micro-bilanciamento in `raceEngine.ts` e `hqSimulator.ts` (da tarare tramite `simBenchmark.ts` per centrare i target Monte Carlo).
* Geometrie puntuali $(X, Y)$ dei 12 circuiti originali e nomi specifici dei 30 piloti fittizi.
* Frequenze ed inviluppi ADSR esatti dei suoni sintetizzati in `soundEffects.ts`.

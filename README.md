# PROJECT APEX // Pit Wall OS & Motorsport Manager

Simulatore gestionale di motorsport a ruote scoperte giocabile nel browser, progettato con estetica telemetrica **Pit Wall OS** e universo **100% originale e moddabile via JSON**.

🔗 **Live Demo (GitHub Pages):** [https://alessandro-rocchi.github.io/project-apex/](https://alessandro-rocchi.github.io/project-apex/)

## Caratteristiche Principali

- **Carriera Multi-Stagionale & Quartier Generale (HQ):**
  - Gestione di 10 scuderie fittizie (Tier 1 → Tier 5), 30 piloti (Titolari, Collaudatori, Free Agent) e calendario da 12 Gran Premi originali.
  - Sviluppo R&D su 6 componenti (*Power Unit*, *Ala Anteriore*, *Ala Posteriore*, *Fondo*, *Sospensioni*, *Freni*) sotto il **Budget Cap FIA (135 M€)** con legge dei rendimenti decrescenti.
  - Potenziamento delle 3 strutture HQ (*Fabbrica Compositi*, *Galleria del Vento & CFD*, *Simulatore Driver-in-Loop*), mercato piloti con clausole di buyout e sponsor a obiettivi.
- **Weekend di Gara Completo (Prove Libere, Qualifiche, Gara):**
  - **Prove Libere (FP1–FP3):** ricerca della finestra di assetto ottimale su 5 parametri, impiego del collaudatore in FP1 e regole di **Parco Chiuso FIA**.
  - **Qualifiche Ufficiali (Q1 / Q2 / Q3):** eliminazione progressiva con scelta mescola e timing d'uscita in pista.
  - **Muretto Box Live (Pit Wall OS):** simulazione continua (`dt = 0.1s`) con radar GPS 2D su spline Catmull-Rom chiusa, 3 settori cronometrici FIA, meteo dinamico (`DRY`, `LIGHT_RAIN`, `HEAVY_RAIN`), termodinamica e cliff gomme, gestione Passo (1–5), Carburante, ibrido ERS, DRS, danni all'ala anteriore, Safety Car e Ordini di Scuderia.
- **Salvataggi & Modding JSON:**
  - Salvataggio automatico su `localStorage` ed esportazione/importazione di salvataggi e database custom `.json`.

## Sviluppo Locale

```bash
# Installa le dipendenze
npm install

# Avvia il server di sviluppo (Vite)
npm run dev

# Esegui la suite di test (Node assert/strict) e il linter
npm test
npm run lint

# Crea il bundle di produzione in dist/
npm run build
```

## Licenza

Distribuito sotto licenza [MIT](./LICENSE).

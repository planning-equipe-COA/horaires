# Mes Horaires

Appli web statique (installable sur l'écran d'accueil) : un agent dépose le tableau de service
Excel de l'équipe ; le planning est gardé sur le téléphone et affiché dans le **calendrier de
l'appli** (écran principal). L'export `.ics` vers l'agenda du téléphone reste en option.
L'utilisateur échange en français. En ligne : https://planning-equipe-coa.github.io/horaires/
(GitHub Pages, branche `main`, racine) — un `git push` sur `main` met en ligne en ~1 min.

## Fichiers
- `core.js` — logique pure, module UMD : lecture de la grille (`parseMatrix`, `sheetToMatrix`),
  codes par défaut (`DEFAULT_CODES`), événements (`buildEvents`), export (`buildICS`).
- `app.js` — interface (IIFE), réglages dans localStorage (`mh_codes`, `mh_codes_v`, `mh_name`,
  `mh_plan`). `mh_name` = dernier agent consulté (l'appli rouvre dessus).
- `index.html`, `style.css` — UI mobile d'abord, mode sombre.
- `manifest.json`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — ajout à l'écran d'accueil.
- `sw.js` — hors connexion, **réseau d'abord** (`cache: 'no-cache'`, délai 4 s) : en ligne on sert
  toujours la dernière version, la copie n'est utilisée que sans réseau. Tout nouveau fichier de l'appli
  (ou changement du `?v=` des icônes) doit être ajouté à `FILES` ; changer `CACHE` purge l'ancienne copie.
- `xlsx.full.min.js` — SheetJS 0.20.3 embarqué (pas de CDN).
- `core.test.js` — tests : `node --test core.test.js` (à lancer avant chaque push).
- `exemple-planning.xls` — planning fictif pour essayer.

## Règles
- **Confidentialité** : le fichier Excel est lu dans le navigateur, rien n'est envoyé nulle part.
  Ne jamais ajouter d'envoi réseau, d'analytics ni de vrai planning dans le dépôt (il est public).
- Format réel : deux blocs d'agents, en-têtes « lu ma … di » puis numéros de jour (05 … 31, 01),
  mois dans un titre « OCTOBRE 2026 » ou le nom de la feuille, colonnes code/remarque à droite.
  Les homonymes dans deux blocs aux mêmes dates deviennent « NOM (2) ».
- Codes : M Matin 6h-14h, S Soir 14h-22h, N Nuit 22h-6h (finit le lendemain), J Journée 7h30-16h30,
  JS Journée de solidarité (libellé « JS », toujours sans horaires),
  R Repos, Tn Tombée de nuit, RF, RC, RCN, ATT Repos, RECUP Récupération, CA/C Congé, EM Enfant malade,
  X « Absence » (sens exact à préciser par l'utilisateur).
- **Tous les codes** vont dans l'agenda, en **journée entière sans horaires** (tout le monde
  connaît les horaires). L'option « Ajouter les horaires » a été retirée à la demande de
  l'utilisateur : l'interface n'expose plus ni horaires ni réglage début/fin. Les horaires restent
  dans `DEFAULT_CODES` (core.js, option `withHours` de `buildEvents`) mais l'appli ne s'en sert pas.
- Couleurs (`color` de chaque code, `COLORS` dans core.js) : marron Matin, jaune Soir, bleu Nuit,
  blanc pour tous les repos, vert pour les congés (CA, C). Apple et Google ignorent la couleur d'un
  événement importé : elle est donc rendue par une pastille emoji en tête du titre (« 🟤 Matin »),
  plus la propriété COLOR. Réglable par code dans « Codes ».
- Si un changement des valeurs par défaut doit toucher les réglages déjà enregistrés sur les
  téléphones, incrémenter `CODES_VERSION` dans app.js et ajouter la migration dans `loadCodes`.
- Case « Seulement à partir d'aujourd'hui » (cochée par défaut, `mh_from_today`) : n'exporte pas les jours passés.
- Calendrier : `mh_plan` = { agents: { NOM: { AAAAMMJJ: CODE } }, at, file, changes, changesSeen }.
  Toute l'équipe est gardée (pour « Aussi Matin : … » au toucher d'un jour), 400 jours max.
  `mergePlan` : un nouveau tableau remplace toute sa période, le reste est conservé.
  Recalculé depuis `state.planBefore` à chaque réglage du fichier (feuille, mois, codes).
  Tous les codes s'affichent dans le calendrier, même décochés (la case ne vaut que pour l'export).
  À l'ouverture : mois en cours s'il a des jours, sinon le prochain mois rempli.
  Deux vues (`mh_view`) : « Mois » (grille) et « Liste » (jours de haut en bas, toucher un jour
  déplie les collègues du même service). Glisser à gauche/droite change de mois dans les deux.
- Jours modifiés : à chaque import, `diffSnapshot` compare chaque agent à son planning précédent ;
  bandeau « 🔔 » + point orange sur les cases jusqu'à « J'ai vu » (`changesSeen`), repris dans
  l'export. L'ancien suivi par export (`mh_snap`) n'est plus écrit ; il sert une fois de point de
  départ à `mh_plan`.
- Idées validées mais en option, pas encore faites : rappel la veille (VALARM), comparer deux agents
  côte à côte (échanges de poste).
- UID `.ics` stable par jour et par agent : réimporter met à jour au lieu de dupliquer.

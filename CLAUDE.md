# Planning COA (ex « Mes Horaires »)

Nom affiché : « Planning COA » (titre, écran d'accueil, manifest). Le préfixe interne `mh_` et le
PRODID `.ics` « Mes Horaires » restent inchangés (réglages et agendas existants).

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
- `sw.js` — hors connexion (`team.js` est dans `FILES`), **réseau d'abord** (`cache: 'no-cache'`, délai 4 s) : en ligne on sert
  toujours la dernière version, la copie n'est utilisée que sans réseau. Tout nouveau fichier de l'appli
  (ou changement du `?v=` des icônes) doit être ajouté à `FILES` ; changer `CACHE` purge l'ancienne copie.
- `xlsx.full.min.js` — SheetJS 0.20.3 embarqué (pas de CDN).
- `team.js` — planning d'équipe partagé (module UMD `TeamSync`) : chiffrement WebCrypto
  (PBKDF2-SHA256 600 000 itérations → AES-GCM) avec le code d'équipe, lecture/écriture GitHub.
- `core.test.js`, `team.test.js` — tests : `node --test core.test.js team.test.js` (avant chaque push).
- `exemple-planning.xls` — planning fictif pour essayer.

## Règles
- **Confidentialité** : le fichier Excel est lu dans le navigateur et n'est jamais envoyé.
  Ne jamais ajouter d'analytics ni de vrai planning dans ce dépôt (il est public).
  Seule exception, voulue par l'utilisateur : le **planning d'équipe** (noms + codes par jour, rien
  d'autre), chiffré sur le téléphone, publié dans le dépôt public séparé `planning-equipe-COA/donnees`
  (`planning.enc`). Le code d'équipe n'est jamais stocké en ligne (il est donné de vive voix).
- Planning d'équipe : la clé GitHub (fine-grained, **seulement** le dépôt `donnees`, Contents en
  lecture/écriture) est chiffrée avec le code d'équipe dans `donnees/cle.enc` → tout agent qui a le
  code peut publier, la clé ne peut pas toucher à l'appli. Lecture publique via raw.githubusercontent
  (cache ~5 min) ; écriture via l'API contents avec `sha` (conflit → on relit, on refusionne, une fois).
  **Après chaque import** d'un agent de l'équipe, l'appli compare d'elle-même au planning publié et
  affiche un aperçu (« N cases changent ») : rien ne part sans « Envoyer à l'équipe » (garde-fou
  demandé par l'utilisateur). Envoi = `mergePlan(planning publié, tableau importé)`. Pas de
  proposition si aucune case ne change ; rappel si le mois a été deviné ; « Annuler l'envoi »
  pendant 2 min (republie le planning d'avant). « Versions précédentes » (carte équipe) : historique
  des commits de `planning.enc` (API publique), aperçu des cases différentes du planning d'équipe
  actuel, puis « Restaurer » (republie cette version entière). Messages de commit **sans nom**
  (« Planning publié / restauré ») : l'auteur reste dans le fichier chiffré.
  Synchro à l'ouverture et au retour sur l'appli (60 s min.) si `mh_team_code` ; jamais pendant un
  import. `plan.teamAt` = date de la publication reçue (seule info en clair de l'enveloppe), `teamBy`.
  Si le code ne déchiffre plus (code changé) : il est oublié et l'agent doit saisir le nouveau.
- Format réel : deux blocs d'agents, en-têtes « lu ma … di » puis numéros de jour (05 … 31, 01),
  mois dans un titre « OCTOBRE 2026 » ou le nom de la feuille, colonnes code/remarque à droite.
  Les homonymes dans deux blocs aux mêmes dates deviennent « NOM (2) ».
- Codes : M Matin 6h-14h, S Soir 14h-22h, N Nuit 22h-6h (finit le lendemain), J Journée 7h30-16h30,
  JS Journée de solidarité (libellé « JS », toujours sans horaires), FORM Formation (pastille
  « Form » violette, jour travaillé ; absent du vrai planning, présent dans l'exemple),
  R Repos, Tn Tombée de nuit, RF, RC, RCN, ATT Repos, RECUP Récupération,
  RECU « Recup » (pastille « Recup » via `abbr`, blanc ; « RECU » se lisait « reçu »), CA/C Congé, EM Enfant malade,
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
  Import de **plusieurs fichiers d'un coup** (`readFiles`, `<input multiple>`, glisser-déposer) :
  meilleure feuille de chaque fichier, triés par date, combinés par `combineResults` (même nom =
  même agent, le plus récent l'emporte sur un jour commun). Pas de choix de feuille ni de mois en
  multi : avertissement `#multiWarn` si un mois a été deviné (importer ce fichier seul pour régler).
  Tous les codes s'affichent dans le calendrier, même décochés (la case ne vaut que pour l'export).
  À l'ouverture : mois en cours s'il a des jours, sinon le prochain mois rempli.
  Sans planning sur le téléphone, le calendrier s'affiche quand même, vide (`EMPTY_PLAN` via
  `planView()`) : grille, liste, notes et résumé à zéro ; menu des agents masqué.
  Résumé du mois sous le calendrier (`monthSummary`, `dayKind`) : jours travaillés = codes à
  horaires (M, S, N, J) + JS + FORM ; repos = pastille blanche (R, Tn, RF, RC, RCN, RECUP, RECU, ATT) ;
  congés = pastille verte (CA, C) ; autres = le reste (EM, X, codes inconnus comme FORM).
  Résumé « Ce mois / Année » (`mh_sum`) + ligne « Travaillés en majoration » : dimanches, fériés
  (`frenchHolidays`, Pâques calculée) et nuits travaillés, comptés le jour où le service commence.
  En haut : « Aujourd'hui / Demain » pour `mh_name` (toucher = aller au jour). Rappel à partir du 20
  si le mois suivant manque. Détail d'un jour (grille ou liste dépliée) : férié, équipe du jour
  groupée par code (`teamOfDay`), collègues en repos « pour un échange » si l'agent travaille, et
  note perso (`mh_notes` = { AAAAMMJJ: texte }, jamais envoyée, même avec le planning d'équipe).
  Trois vues (`mh_view`) : « Mois » (grille), « Liste » (jours de haut en bas, toucher un jour déplie
  le détail) et « Équipe » (`renderTeamTable` : agents en lignes, jours en colonnes, noms figés,
  « moi » en premier). Glisser à gauche/droite change de mois (Mois, Liste).
  « Comparer avec un collègue » (Mois, Liste ; non mémorisé) : 2e pastille sous la mienne, cadre vert
  pointillé = l'un travaille pendant que l'autre est en repos (échange possible).
  Heures théoriques (`codeMinutes`, `monthHours`) : durée des horaires du code (sans pause, nuit à
  cheval), `hours` pour JS et Formation (7 h) ; total du mois + semaines ISO, total de l'année.
  Commentaires de cases Excel (`cell.c` → `matrix.notes` → `entry.note`) gardés dans
  `plan.remarks` { NOM: { AAAAMMJJ: texte } } (fusionnés comme les codes, publiés avec le planning
  d'équipe), signalés partout : message après import (« 💬 N commentaires lus »), 💬 sur la case
  (Mois, Équipe), texte sous la ligne (Liste) et dans « Aujourd'hui / Demain », détail du jour.
  Accueil au premier lancement (`mh_welcome`, `mh_name_ok`) : récupérer le planning (champ code
  d'équipe + « 📋 Coller » + « Rejoindre », ou import), puis choisir son nom ; jamais montré à qui
  avait déjà planning + nom.
  iPhone : l'icône d'écran d'accueil a un stockage séparé de Safari (code, planning, notes perdus à
  l'ajout — impossible à contourner). Dans Safari (`isIOS && !isStandalone`), la carte équipe propose
  « 📋 Copier le code pour l'écran d'accueil » ; l'accueil de l'icône le recolle en un geste.
- Jours modifiés : à chaque import, `diffSnapshot` compare chaque agent à son planning précédent ;
  bandeau « 🔔 » + point orange sur les cases jusqu'à « J'ai vu » (`changesSeen`), repris dans
  l'export. L'ancien suivi par export (`mh_snap`) n'est plus écrit ; il sert une fois de point de
  départ à `mh_plan`.
- Export : case « Rappel la veille à 20 h » (`mh_alarm`, cochée par défaut) → VALARM sur les jours
  travaillés. Apple le garde à l'import ; Google Agenda ignore les alarmes importées.
  Pas de notifications web (iPhone : impossible sans serveur).
- Cartes 1 à 3 dépliantes (`<details class="fold">` : `importDetails`, `agentDetails`,
  `exportDetails`), comme « Planning d'équipe », « Partager », « Codes ». Import ouvert tant qu'il n'y
  a aucun planning et dès qu'un fichier est lu (aperçu + « Envoyer à l'équipe » y sont) ; replié à
  l'ouverture sinon. « Qui es-tu ? » ouvert, export (facultatif) replié. Le rappel de fin de mois
  ouvre l'import.
- Écarté par l'utilisateur : « Partager → Planning COA » sur Android.
- UID `.ics` stable par jour et par agent : réimporter met à jour au lieu de dupliquer.

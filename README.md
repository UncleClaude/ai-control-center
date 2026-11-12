# AI Control Center

Une application de bureau qui rassemble **Muse (Meta)**, **Claude** et **ChatGPT** dans une seule fenêtre en verre, avec leurs sites officiels et tes abonnements existants : pas d'API, pas de clé.

- Une vue par IA, chacune avec **sa session isolée et persistante** : tu te connectes une fois (y compris avec Google), tu restes connecté après redémarrage.
- **Bascule instantanée** : les vues restent vivantes en arrière-plan, une réponse en cours n'est jamais interrompue.
- **Notifications natives** quand une IA a fini ou **a besoin de toi** (question, approbation), avec badge et clic qui ramène sur la bonne conversation.
- Interface **Liquid Glass** : vibrancy native sur macOS, flou du compositeur sur Linux, repli soigné sinon. Les sites sont habillés aux couleurs de leur IA (Claude orangé, Muse bleu, ChatGPT noir).
- Icône dans la **barre système** (StatusNotifierItem sous Linux, icône template sur macOS).
- Liste des IA dans un **fichier de config** : on en ajoute une sans toucher au code.

Plateformes : **Arch Linux / CachyOS** (Wayland et X11 ; KDE, Hyprland, GNOME) et **macOS** (Apple Silicon en priorité).

---

## Sommaire

1. [Installer les dépendances](#1-installer-les-dépendances)
2. [Lancer en développement](#2-lancer-en-développement)
3. [Construire les paquets](#3-construire-les-paquets) (AppImage, PKGBUILD, dmg)
4. [Effet verre : configurer le flou](#4-effet-verre--configurer-le-flou) (KDE, Hyprland)
5. [Icône de la barre système](#5-icône-de-la-barre-système)
6. [Utilisation](#6-utilisation) (raccourcis, réglages)
7. [Ajouter une IA](#7-ajouter-une-ia)
8. [Notifications : comment ça marche, comment réparer](#8-notifications--comment-ça-marche-comment-réparer)
9. [Habillage des sites](#9-habillage-des-sites)
10. [Dépannage](#10-dépannage)
11. [Structure du projet](#11-structure-du-projet)

---

## 1. Installer les dépendances

### Arch Linux / CachyOS (pacman)

Pour développer et construire :

```bash
sudo pacman -S --needed nodejs npm git base-devel librsvg
```

Pour exécuter :

| Paquet | Pourquoi |
|---|---|
| `electron44` | moteur de l'app installée par le PKGBUILD (tiré automatiquement) |
| `libnotify` | notifications natives |
| `fuse2` | lancer l'AppImage (sinon : `--appimage-extract-and-run`) |

```bash
sudo pacman -S --needed electron44 libnotify fuse2
```

Optionnel :

- KDE, vrai flou derrière la fenêtre : `kwin-effects-better-blur-dx-git` (AUR), voir [§4](#kde-plasma-kwin).
- GNOME, icône du tray : `gnome-shell-extension-appindicator`.
- Hyprland, icône du tray : `waybar` avec le module `tray`.

### macOS (Homebrew)

```bash
brew install node git
```

Xcode Command Line Tools (`xcode-select --install`) est nécessaire pour construire le `.dmg`.

---

## 2. Lancer en développement

```bash
npm install
npm run dev
```

Le processus principal et les preloads sont recompilés à chaque lancement. L'interface de l'app (le rail, les réglages) se recharge à chaud. Après une modification de `src/main`, `src/preload`, `src/adapters` ou `src/skins`, **quitte l'app** (Ctrl+Q, ou tray → Quitter) et relance.

> Fermer la fenêtre la **masque dans le tray** : l'app tourne toujours. Pour vraiment quitter : Ctrl+Q (Cmd+Q sur macOS) ou tray → Quitter.

Variables utiles :

| Variable | Effet |
|---|---|
| `AICC_PROFILE=test` | profil séparé (sessions, verrou d'instance unique) : pour tester sans toucher à tes connexions |
| `AICC_DEBUG=1` | trace chaque décision de notification dans le terminal |
| `AICC_GLASS=glass\|solid\|auto` | force le mode de verre (prioritaire sur le réglage) |
| `AICC_SKINS=0` | désactive l'habillage des sites |

```bash
npm run dev:inspect     # comme dev, avec le port de débogage Chromium 9333 (inspection des sites)
npm run typecheck       # vérification TypeScript
```

Où sont les données :

| | Linux | macOS |
|---|---|---|
| Profil (sessions, cookies) | `~/.config/ai-control-center/` | `~/Library/Application Support/ai-control-center/` |
| Liste des IA | `…/ais.json` | idem |
| État et réglages | `…/state.json` | idem |
| Habillages perso | `…/skins/<id>.css` | idem |

---

## 3. Construire les paquets

### AppImage (Linux)

```bash
npm run dist:linux
# → dist/AI-Control-Center-0.1.0-x86_64.AppImage
chmod +x dist/AI-Control-Center-*.AppImage
./dist/AI-Control-Center-*.AppImage
```

L'AppImage embarque son propre Electron (environ 120 Mo).

### Paquet Arch (PKGBUILD)

Le PKGBUILD construit le paquet à partir du **dernier commit** du dépôt et utilise l'Electron du système (`electron44`) : le paquet fait environ 1 Mo et profite des mises à jour de sécurité de Chromium par pacman.

```bash
cd packaging/arch
makepkg -si
```

Ce qui est installé :

- `/usr/bin/ai-control-center` : lanceur (`electron44 --class=ai-control-center …/app.asar`) ;
- `/usr/lib/ai-control-center/` : `app.asar` et ressources ;
- l'entrée de menu `.desktop` et les icônes hicolor.

Pour ajouter des options Chromium, une par ligne, crée `~/.config/ai-control-center-flags.conf`. Par exemple, pour forcer X11 :

```
--ozone-platform=x11
```

> Pense à committer tes changements avant `makepkg` : il ne prend que `HEAD`.

### .dmg (macOS)

À lancer **sur un Mac** : le dmg ne se construit pas depuis Linux.

```bash
npm install
npm run dist:mac
# → dist/AI-Control-Center-0.1.0-arm64.dmg et -x64.dmg
```

Le paquet n'est **pas signé** par défaut. Au premier lancement, clic droit sur l'app → Ouvrir, ou :

```bash
xattr -dr com.apple.quarantine "/Applications/AI Control Center.app"
```

Pour signer et notariser, définis `CSC_LINK` / `CSC_KEY_PASSWORD` (ou `CSC_NAME`) et retire `identity: null` dans `electron-builder.yml`.

---

## 4. Effet verre : configurer le flou

L'interface de l'app (rail, barre d'outils, réglages) est en verre. **Le contenu des sites reste toujours opaque et lisible.** Au démarrage, le terminal affiche le mode choisi, par exemple `[glass] mode blur (Hyprland)`.

| Mode | Quand | Rendu |
|---|---|---|
| `vibrancy` | macOS | vrai flou du bureau (NSVisualEffectView) |
| `blur` | Hyprland ; KDE avec un plugin de flou forcé | fenêtre transparente, le compositeur floute |
| `tint` | Wayland sans flou (KDE sans plugin…) | repli : dégradé semi-opaque teinté |
| `solid` | pas de compositeur, ou réglage « Opaque » | fond opaque, même dégradé |

Le mode se change dans **Réglages → Effet de verre** (Auto / Verre / Opaque). Il s'applique au prochain lancement.

### KDE Plasma (KWin)

KWin ne floute que les fenêtres qui le demandent via un protocole Wayland qu'Electron ne parle pas. Il faut donc un effet capable de **forcer le flou** par classe de fenêtre :

1. Installer l'effet depuis l'AUR :
   ```bash
   paru -S kwin-effects-better-blur-dx-git   # ou yay -S …
   ```
   Sous X11, utiliser `kwin-effects-better-blur-dx-x11`.
2. **Paramètres système → Gestionnaire de fenêtres → Effets de bureau** :
   - désactiver l'effet **Flou** d'origine ;
   - activer **Better Blur** et ouvrir sa configuration.
3. Dans **Force blur**, ajouter la classe de fenêtre :
   ```
   ai-control-center
   ```
4. Relancer l'app : le terminal doit afficher `[glass] mode blur (KWin + plugin de flou forcé)`.

Sans plugin, l'app reste en mode `tint` : propre, mais sans flou du bureau.

### Hyprland

Hyprland floute les fenêtres transparentes dès que le flou est activé. Dans `~/.config/hypr/hyprland.conf` :

```ini
decoration {
    blur {
        enabled = true
        size = 8
        passes = 3
        new_optimizations = true
        xray = false
    }
}

# Garder l'app pleinement opaque côté compositeur : la transparence vient de l'app elle-même,
# une opacité globale (active/inactive_opacity) ne doit pas s'y ajouter.
windowrulev2 = opacity 1.0 override 1.0 override, class:^(ai-control-center)$
```

> Selon ta version de Hyprland, la syntaxe des règles peut être `windowrule` au lieu de `windowrulev2`. La classe à cibler est toujours `ai-control-center`. Si tu as une règle `noblur` globale, exclus cette classe.

---

## 5. Icône de la barre système

| Environnement | Ce qu'il faut |
|---|---|
| KDE Plasma (Wayland / X11) | rien, StatusNotifierItem natif |
| Hyprland | `waybar` avec le module `tray` (voir ci-dessous) |
| GNOME | extension **AppIndicator** : `sudo pacman -S gnome-shell-extension-appindicator` puis l'activer dans Extensions |
| macOS | rien, icône monochrome dans la barre des menus |

Sous Linux, Electron publie l'icône via **StatusNotifierItem** (D-Bus) : aucune bibliothèque `libappindicator` n'est nécessaire.

Waybar (`~/.config/waybar/config.jsonc`) :

```jsonc
"modules-right": ["tray", "clock"],
"tray": { "icon-size": 18, "spacing": 8 }
```

Comportement :

- **Clic** sur l'icône : affiche ou masque la fenêtre. Sur macOS, le clic ouvre le menu.
- **Menu** : ouvrir directement une IA, l'option « Garder dans la barre système à la fermeture », Quitter.
- Une **pastille** apparaît sur l'icône tant qu'une réponse n'a pas été consultée, et le menu affiche le compte par IA.

---

## 6. Utilisation

### Raccourcis

Sur Linux, *Mod* = Ctrl ; sur macOS, *Mod* = Cmd. Les raccourcis utilisent les touches physiques, donc Mod+1 marche aussi en **AZERTY**.

| Raccourci | Action |
|---|---|
| Mod+1, Mod+2, Mod+3… | changer d'IA |
| Mod+R | recharger la vue active (Mod+Shift+R : sans cache) |
| Mod+[ / Mod+] | précédent / suivant dans l'historique de la vue |
| Alt+← / Alt+→ (Linux) | précédent / suivant (pratique en AZERTY, où [ et ] demandent AltGr) |
| Mod+= / Mod+- / Mod+0 | zoom avant / arrière / taille réelle de l'IA affichée (mémorisé par IA) |
| Mod+, | réglages |
| Ctrl+Q (Linux), Cmd+Q (macOS) | quitter |
| F12 / Mod+Shift+I | outils de développement de la vue active |
| Échap | fermer les réglages |

### Réglages (engrenage en bas du rail)

- **Par IA** :
  - afficher ou masquer l'IA (une IA masquée n'est pas chargée) et changer l'ordre du rail avec les flèches ; l'ordre détermine aussi Mod+1, Mod+2… ;
  - notifications, son, habillage aux couleurs de l'app ;
  - couleur personnelle : elle remplace celle de `ais.json` dans le rail, la teinte de la fenêtre et l'habillage du site ; ↺ revient à l'originale ;
  - zoom de la page, de 50 à 200 % ;
  - **Tester** : affiche une notification d'exemple ;
  - **Vider le cache** : recharge la page sans cache, la connexion est conservée ;
  - **Se déconnecter** : efface cookies et données du site. Il faut cliquer deux fois pour confirmer.
- **Apparence** :
  - thème Système / Clair / Sombre, appliqué à l'app et aux sites qui suivent le thème du système ;
  - teinte des surfaces (0–30 %, aperçu en direct) ;
  - effet de verre (Auto / Verre / Opaque, au prochain lancement) ;
  - réduire les animations : les icônes non lues brillent sans respirer.
- **Notifications** : *Ne pas déranger* coupe popups et sons, mais les icônes signalent toujours les réponses non lues. L'option est aussi dans le menu de la barre système.
- **Démarrage et fenêtre** :
  - **lancer à l'ouverture de session**, éventuellement masqué dans la barre système. Sur Linux, une entrée `~/.config/autostart/ai-control-center.desktop` est créée. Cette option demande l'AppImage ou le paquet Arch, pas les sources ;
  - IA ouverte au démarrage (la dernière, ou une IA fixe) ;
  - garder l'app dans la barre système à la fermeture ;
  - **raccourci global** pour afficher ou masquer la fenêtre depuis n'importe où (`CommandOrControl+Shift+Space` par défaut, modifiable). Sous Wayland, il passe par le portail XDG GlobalShortcuts : KDE et Hyprland (avec `xdg-desktop-portal-hyprland`) demandent une confirmation la première fois.
- **Fichiers** : accès direct à `ais.json`, au dossier d'habillages et au dossier de données.
- **Raccourcis et version** : aide-mémoire des raccourcis, versions de l'app, d'Electron et de Chromium.

Le chevron en bas du rail affiche les noms des IA. L'app mémorise la taille de la fenêtre, son état maximisé et la dernière IA ouverte. Sous Wayland, c'est le compositeur qui place la fenêtre, donc sa position n'est pas restaurée.

---

## 7. Ajouter une IA

Édite `~/.config/ai-control-center/ais.json` (Réglages → Fichiers), puis relance :

```json
{
  "ais": [
    { "id": "muse", "name": "Muse", "url": "https://muse.ai", "icon": "muse.svg", "accent": "#0064E0", "adapter": "muse",
      "allowedDomains": ["muse.ai", "meta.ai", "meta.com", "facebook.com", "instagram.com"] },
    { "id": "mistral", "name": "Le Chat", "url": "https://chat.mistral.ai", "icon": "lechat.png", "accent": "#FA500F",
      "allowedDomains": ["mistral.ai"] }
  ]
}
```

| Champ | |
|---|---|
| `id` | identifiant unique, minuscules, chiffres et tirets ; il sert aussi à nommer la session (`persist:ai-<id>`) |
| `name`, `url` | nom affiché, page d'accueil |
| `icon` | fichier SVG/PNG, cherché à côté de `ais.json` puis dans les icônes intégrées ; absent = monogramme. Mets un `.png` du même nom à côté d'un `.svg` pour l'icône des notifications |
| `accent` | couleur de l'IA : lueur de l'interface et teinte de l'habillage |
| `allowedDomains` | domaines (et sous-domaines) qui restent dans l'app ; le reste s'ouvre dans ton navigateur. Les pages de connexion Google, Apple, Microsoft, OpenAI, Meta et Cloudflare sont toujours autorisées |
| `adapter` | `claude`, `chatgpt`, `muse` ou rien (adaptateur générique) |
| `userAgent` | facultatif, pour forcer un user agent |
| `enabled` | `false` pour masquer l'IA sans la supprimer |

Une IA sans adaptateur dédié bénéficie quand même de ses propres notifications web, de sa session persistante et de l'interface.

---

## 8. Notifications : comment ça marche, comment réparer

Tu reçois une notification quand une IA **a fini** (« Réponse terminée ») ou **attend une action** (« A besoin de toi » : question en fin de réponse, demande d'approbation ou de confirmation, choix proposés par Muse). Ça ne se produit que si l'app n'a pas le focus ou si cette IA n'est pas la vue active. Un clic ouvre l'app sur la bonne IA et la bonne conversation.

Deux sources, fusionnées en **une seule notification par réponse** :

1. **Les notifications des sites eux-mêmes.** La permission leur est accordée, et leur API `Notification` (ainsi que `showNotification` des service workers) est relayée vers les notifications natives. Le clic est rejoué dans le site, qui ouvre lui-même la bonne conversation.
2. **Les adaptateurs DOM** (`src/adapters/<ia>.ts`). Un script observe la page (MutationObserver) :
   - **génération en cours** : bouton « stop » ou drapeau de streaming présent. Si aucun sélecteur ne correspond, l'adaptateur se rabat sur un indice universel : le dernier message grossit ;
   - **fin** : ces signaux disparaissent pendant 1,5 s (les agents marquent des pauses entre leurs outils) ;
   - **besoin de toi** : boutons d'approbation, choix de réponse dans le message, ou dernière phrase qui se termine par « ? ».

Le hub (`src/main/notifications.ts`) regroupe les événements arrivés à moins de 1,5 s d'intervalle. « A besoin de toi » l'emporte sur « Réponse terminée », et il ignore les doublons tant qu'une nouvelle génération n'a pas commencé.

### Quand un site change son interface

Chaque adaptateur est un simple fichier de **sélecteurs CSS**, classés du principal aux replis. Quand ils ne correspondent plus, l'app l'écrit dans le terminal :

```
[adapter:claude] generating : sélecteur principal introuvable, repli n°2 utilisé (claude)
[adapter:chatgpt] zone de saisie non reconnue — sélecteurs essayés : … mettez à jour src/adapters/chatgpt.ts
[adapter:muse] génération détectée par la croissance du texte (aucun sélecteur "generating" ne correspond) — muse
```

Pour réparer :

1. Lancer `AICC_DEBUG=1 npm run dev` : chaque décision du hub s'affiche, comme `adapter generating`, `notify done…` ou `skip (being viewed)`.
2. Ouvrir les outils de développement de la vue (F12), repérer le nouveau bouton stop ou le conteneur de message, et mettre son sélecteur **en tête** de la liste correspondante dans `src/adapters/<ia>.ts`.
3. Redémarrer l'app. Le bouton **Tester** des réglages vérifie que la notification elle-même s'affiche bien.

> Les sélecteurs de « génération en cours » de Muse n'ont pas pu être observés pendant une vraie réponse. En attendant, le repli par croissance du texte prend le relais ; si le journal le signale, ajoute le sélecteur du bouton stop de Muse en tête de `generating` dans `src/adapters/muse.ts`.

---

## 9. Habillage des sites

Chaque site reçoit une feuille de style injectée (`src/skins/<ia>.css`). Elle réutilise les **variables de couleur du site** : fonds, surfaces, barre latérale, zone de saisie. Toutes les teintes sont mélangées depuis l'`accent` de l'IA, ce qui donne Claude orangé, Muse bleu et ChatGPT presque noir. S'y ajoutent une **lueur de verre** très légère, une **zone de saisie en verre dépoli** et des bulles de message teintées. Le texte n'est jamais touché. Si un site renomme ses variables, l'habillage ne s'applique simplement plus, et rien ne casse.

Pour tes propres retouches, crée `~/.config/ai-control-center/skins/<id>.css`. Il est ajouté après l'habillage intégré et **rechargé dès l'enregistrement** :

```css
:root { --aicc-tint: 18%; }                         /* intensité de la teinte (11 % par défaut) */
html { --aicc-glow-opacity: 0.35 !important; }      /* intensité de la lueur (0.22 par défaut) */
```

L'habillage se désactive par IA dans les réglages, ou globalement avec `AICC_SKINS=0`.

---

## 10. Dépannage

**Google affiche « Ce navigateur n'est peut-être pas sécurisé ».** Google refuse les navigateurs intégrés. Sur ses pages de connexion uniquement, l'app se présente comme Firefox (en-têtes et `navigator`), et reste Chrome partout ailleurs. Si le blocage revient après une mise à jour de Google, vérifie que `accounts.google.com` figure toujours dans `GOOGLE_AUTH_HOSTS` (`src/shared/protocol.ts`).

**Je relance mais rien ne change.** L'ancienne instance tourne encore dans le tray : quitte-la (tray → Quitter).

**L'AppImage ne démarre pas (FUSE).** Installe `fuse2`, ou lance-la avec `--appimage-extract-and-run`.

**`'--ozone-platform=wayland' is not compatible with Vulkan`** au démarrage : message de Chromium sans conséquence, le rendu passe par OpenGL.

**Forcer X11 sous Wayland :** en dev, `npx electron-vite build && npx electron . --ozone-platform=x11` ; pour le paquet Arch, la ligne `--ozone-platform=x11` dans `~/.config/ai-control-center-flags.conf` ; pour l'AppImage, `./AI-Control-Center-*.AppImage --ozone-platform=x11`.

**Une notification n'arrive pas.** Clique sur **Tester** dans les réglages. Si la notification de test arrive, c'est la détection qui est en cause : voir [§8](#quand-un-site-change-son-interface). Sinon, vérifie le service de notifications du bureau (`libnotify`) et, sur macOS, l'autorisation dans Réglages Système → Notifications.

**Micro (mode vocal) refusé sur macOS :** Réglages Système → Confidentialité et sécurité → Microphone → autoriser AI Control Center.

---

## 11. Structure du projet

```
config/ais.default.json      IA par défaut (copiées dans ais.json au premier lancement)
resources/                   icônes des IA, de l'app et du tray (template macOS + variantes badge)
build/                       icône 1024 px et entitlements macOS (electron-builder)
packaging/arch/              PKGBUILD, lanceur, entrée .desktop
src/
  main/                      processus principal
    index.ts                 démarrage, fenêtre, IPC, cycle de vie
    window.ts  glass.ts      fenêtre native, détection du mode de verre
    views.ts                 une WebContentsView par IA, bascule, historique
    sessions.ts              partitions persistantes, user agent, permissions, identité Firefox pour Google
    navigation.ts            domaines autorisés, popups OAuth, liens externes
    notifications.ts         hub : dédoublonnage, badges, clic → bonne IA
    skins.ts                 injection de l'habillage CSS
    tray.ts  menu.ts  shortcuts.ts  store.ts  config.ts  paths.ts
  preload/
    shell.ts                 pont étroit pour l'interface de l'app
    site.ts                  dans chaque IA : relais des notifications web + adaptateur
  adapters/                  un fichier de sélecteurs par IA + moteur de détection (runtime.ts)
  skins/                     habillage CSS : palette commune + un fichier par IA
  renderer/                  interface de l'app (rail, barre d'outils, réglages), TypeScript sans framework
  shared/protocol.ts         types et canaux IPC partagés
```

Stack : **Electron 44** (Chromium : connexions OAuth et Cloudflare fiables, un seul moteur sur Linux et macOS, vibrancy native), electron-vite, TypeScript, zod.

### Crédits

L'ergonomie de la fenêtre (barre de titre intégrée, rail persistant, vibrancy sur macOS, fermeture vers le tray) s'inspire de [muse-desktop](https://github.com/robzilla1738/muse-desktop) (licence MIT). Aucun code n'en a été repris : ce projet est une architecture différente, faite de vues web plutôt que d'un client de CLI.

Muse, Claude et ChatGPT sont des marques de leurs propriétaires respectifs. Ce projet est indépendant et n'est affilié à aucun d'eux.

## Licence

MIT, voir [LICENSE](LICENSE).

# Swarm vs Hero

**You are not the hero. You are what the hero came here to kill.**

A lone champion has walked into your rift-lands. You are the swarm mind. Open
rifts, spend Aether, and break it before it breaks you.

The catch: **every unit it kills makes it stronger.** Feeding it a constant
trickle of chaff doesn't wear it down — it arms it. The champion levels through
six tiers, from Scout to Ascendant, and if it reaches Ascension you lose.
Throwing bodies at the problem *is* the problem.

Play it at **[sige25.dev/swarmvshero](https://sige25.dev/swarmvshero/)**.

---

## The roster

Five fixed units, then two slots that open as a choice between two strains.
What you pass on is gone for the rest of the run.

| Slot | Unit | Role |
|------|------|------|
| 1 | **Mite** | Cheap chaff. Numbers over quality. |
| 2 | **Flinger** | Ranged acid. Outranges the champion at every tier. |
| 3 | **Mauler** | Armoured tank. Soaks the area damage that deletes your swarm. |
| 4 | **Burrower** | Untouchable underground, surfaces for a 2.5× ambush strike. |
| 5 | **Shrieker** | Slows the champion and marks it for extra damage. |
| 6 | **Matriarch** *or* **Mender** | Replace your losses, or keep what you already have alive. |
| 7 | **Titan** *or* **Bombardier** | A 520 HP brawler, or artillery that never enters the fight. |

The slot-6 pick is about *how* you sustain: the **Matriarch** hatches free Mites
forever, so a long grind costs less Aether; the **Mender** heals every unit
around it, which turns a packed swarm into something that survives a Shockwave.

The slot-7 pick is about *reach*: the **Titan** walks in and holds the champion
in place; the **Bombardier** lobs shells over terrain from 410 away and splashes
on impact. One shell clears a pack of a Summoner's wisps, and it is the only
real answer to a champion that kites.

## How it plays

Capture Aether Wells to grow your income — the champion will come to purge them,
which is exactly when you want it away from the fight. Draft swarm mutations
between engagements. Trigger **Frenzy** for a burst of speed, damage and ability
resistance when the window opens.

**Corpses leave things behind.** About one death in seventeen drops a pickup
where the unit fell. Most are spinning relics — permanent, capped at nine a run
— and the rest are flasks, a loud, short boon for the champion. The champion has
to walk over one to take it, so a drop is a small piece of map you can play
around: fight somewhere else, or take the trade. They fade after 13 seconds.

**Five champion archetypes**, rerolled every run, each demanding a different
composition:

- **Templar** — heavy plate, brutal in melee
- **Duelist** — fast blade, relentless attack speed
- **Arcanist** — ranged bolts and wide, frequent abilities
- **Huntress** — kites at range, punishing to chase
- **Summoner** — calls wisps that fight beside it; they come to your swarm, burn
  out on their own, pay Aether when killed, and give no experience

## Controls

| | |
|---|---|
| **Left-click** | open a rift and summon your selected unit |
| **Right-click** | set a rally beacon |
| **1 – 7** | select a unit (also summons at the cursor); during a strain pick, 1 and 2 choose |
| **Q** | clear the rally beacon |
| **Space** | Frenzy |
| **WASD** or **arrows** | look around; 3 seconds after you let go it returns to the champion and follows it again |
| **Minimap** | click or drag to look there · right-click to set the rally beacon there |
| **C** | recentre the camera on the champion now |
| **Mouse wheel** | zoom |
| **H** or **?** | field guide |
| **Esc** | pause · **M** mute |

Best played fullscreen — a wider view means you see the champion coming sooner.
The run pauses itself if the window loses focus, and the mute switch and a
small win record are remembered between visits. Screen shake and full-screen
flashes follow the operating system's reduced-motion setting: shake goes, and
flashes drop to a soft tint.

Sound is panned to where things happen on screen, and fades for fights the
camera is not on. A quiet ambient bed rises as the champion climbs its tiers,
and a heartbeat counts down the Ascension.

Every run has a seed, shown on the end screen. Opening the game as
`?seed=1234` pins every run on that page to the same map and champion, so a run
can be replayed or shared.

## Balance

Tuned against a scripted reference player to roughly a **50% win rate**
(52.9% over 480 simulated runs at the time of writing). You are meant to lose
some.

Run-to-run variance is genuinely high: individual samples of 80 runs on an
*identical* configuration ranged from 38% to 64%. That is inherent to the
format, and it is why `dev/balance-harness.js` pools several hundred runs before
any number gets moved.

## Running it

No build step. It is plain ES modules and a canvas — upload `index.html`,
`styles.css` and `src/` to any static host and it works.

To test locally, serve the folder over HTTP:

```bash
python3 -m http.server 8765
```

Then open `http://localhost:8765`.

It has to be served over HTTP rather than opened as a file. ES modules are
blocked over `file://` (origin `null` fails the CORS check), so double-clicking
`index.html` shows a blank page. Any static server fixes it.

If you edit the source and Safari does not pick up the change, use
`Cmd+Option+R` (Reload From Origin) — a plain `Cmd+R` serves the ES module
imports from Safari's memory cache. Or serve with caching off:

```bash
python3 -c "import http.server as s; H=type('H',(s.SimpleHTTPRequestHandler,),{'end_headers':lambda self:(self.send_header('Cache-Control','no-store'), s.SimpleHTTPRequestHandler.end_headers(self))}); s.test(HandlerClass=H,port=8765)"
```

### Layout

| File | What it holds |
|------|---------------|
| `src/config.js` | Every tuning number. Gameplay code reads these; nothing here reads gameplay. |
| `src/game.js` | Simulation and render orchestration. |
| `src/hud.js` | All screen-space UI, plus the field guide text. |
| `src/art.js` | Every procedural drawing routine. |
| `src/world.js` | Arena generation, terrain, spatial queries. |
| `src/fx.js` · `src/audio.js` · `src/math.js` | Particles, synthesised sound, helpers — including the seeded RNG every gameplay roll goes through. |
| `src/prefs.js` | The remembered mute switch and win record. Guarded, so blocked storage only forgets them. |
| `dev/balance-harness.js` | Development tool. Never loaded by the game — paste it into the console. |
| `dev/compat-check.html` | Development tool. Open it in a browser to verify that browser. |
| `dev/browser-tests/` | Development tool. Playwright + safaridriver cross-browser suite. |

### Balance harness

Open the game, paste `dev/balance-harness.js` into the console, then:

```js
window.__suite(window.__DUMB, 80)                    // constant pressure
window.__suite(window.__DUMB, 40, { cls: 'summoner' })  // one archetype
window.__suite(window.__STAGE, 40)                   // stages near the fight
window.__suite(window.__SMART, 40)                   // parks the army (bad play)
window.__suite(window.__DUMB, 200, { seed: 1 })      // seeds 1..200, reproducible
window.__play(window.__DUMB, { seed: 57 })           // replay one run exactly
```

It reports a win rate, run lengths, per-archetype and per-strain results, and
any invariant violations — NaN state, runaway multipliers, entities outside the
world, wells reordered, caps exceeded.

With a seed, every roll — map, champion, combat and the bot's own choices — is
fixed, so the same call on the same build returns the same result. To judge a
change, run the same seeded batch before and after it: both builds face the
same maps and champions, and `results` lists each run's seed so the runs that
flipped can be replayed one by one.

### Browser check

`dev/compat-check.html` boots the real game in whatever browser you open it in,
feature-detects everything the game uses, simulates 60 seconds of play, and
renders the HUD at eleven desktop viewport sizes from 800x600 to 3440x1440. It
prints one verdict line at the top.

Serve the folder and open `http://localhost:8765/dev/compat-check.html` in
Chrome, Edge, Firefox and Safari. Nothing in it ships with the game.

For the automated version, `dev/browser-tests/` drives Chromium, real Chrome,
Firefox and WebKit through Playwright, the real Safari through `safaridriver`,
and compares a 576-point pixel grid of one deterministic scene across all four
engines. See its README. Last run:

| Engine | Result |
|---|---|
| Chromium 153 | 23/23 checks, layout clean at 10 viewports |
| Google Chrome 154 | 23/23 checks, layout clean at 10 viewports |
| Firefox 155 | 23/23 checks, layout clean at 10 viewports |
| WebKit 26.6 | 23/23 checks, layout clean at 10 viewports |
| Safari 26.6.2 (real) | 17/17 checks, layout clean at 10 viewports |

Microsoft Edge runs as a fifth target whenever it is installed; it is Blink, so
Chrome's result covers it otherwise.

Rendering is pixel-identical between engines: against Chromium, Chrome differs
by at most 14/255 on a channel, Firefox by 7, and WebKit by more than 24 on
0.3% of sampled channels — antialiased prop edges.

## Credits

A hobby experiment to find out what agentic LLMs can actually build. The code,
the art and this page were generated by Claude and ChatGPT, directed by me.
There are no external assets — every creature, rock and rune is drawn
procedurally in canvas 2D.

MIT licensed. See [LICENSE](LICENSE).

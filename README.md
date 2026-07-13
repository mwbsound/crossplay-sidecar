# Crossplay Sidecar — phone-friendly solver

A single web page that finds the best NYT Crossplay moves. Runs entirely in
your browser; nothing is uploaded anywhere.

## Put it on your phone (about 3 minutes, free)

1. Create a GitHub account if needed, then a new public repository.
2. Upload these three files to it: `index.html`, `solver.js`, `enable1.txt`
   (drag and drop on the repo page works).
3. In the repo: Settings → Pages → Source: "Deploy from a branch" →
   Branch: main, folder: / (root) → Save. After a minute your app is live at
   `https://YOURNAME.github.io/REPONAME/`.
4. Open that link in Safari → Share → "Add to Home Screen". It now opens
   like an app.

Any static host works the same way (Netlify Drop, Cloudflare Pages, a
Raspberry Pi). The only requirement is that `enable1.txt` and `solver.js`
sit next to `index.html`.

## Using it

- Paste a screenshot straight onto the page (⌘V or the Paste button), drag one
  in, or use Import screenshot. The reader takes a full-screen, light-mode screenshot of the game and
  fills in the whole board and rack, including blank tiles (detected from
  their 0 value). Photos of a screen won't work; use real screenshots. Give
  the result a quick glance before solving.
- Tap a board square, type letters on the keypad. The Blank key marks blank
  tiles (they show gold and score 0). Move →/↓ sets which way the cursor
  advances so you can type whole words.
- Enter your rack (`?` = blank) and hit Find best moves. Tap a result to
  ghost it onto the board; Apply commits it after you play it in the real app.
- "Paste or copy the board as text" round-trips the same 15-line format the
  Python solver uses: `.` empty, `A-Z` tiles, lowercase = blank.
- Board, rack, and dictionary patches persist in your browser between visits.

## Dictionary

Base list is ENABLE (public domain) plus built-in NWL2023 additions
(QI, ZA, ZEN, HIJAB, EMOJI…). Crossplay uses NASPA NWL2023, which is licensed
and can't be bundled. When the app accepts a word this tool missed, add it
under Dictionary patches; when it rejects a suggestion, add it to the
rejected list. Both apply on the next solve.

## Known assumption

The center square is treated as having no multiplier (it shows no label in
the app). If a first-move score ever comes back exactly double the
prediction, flip `CENTER_DOUBLES_WORD` to `true` in `solver.js`.

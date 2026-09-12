# Twin Towers Structural Study

Interactive Three.js educational reconstruction of the World Trade Center towers, aircraft impact, fire exposure, steel behavior, and collapse initiation.

Open the live GitHub Pages build at: https://iluzionsx.github.io/tt-sim/

## What is modeled

- Approximate 110-story tower envelopes with perimeter frame, core, floor strips, mechanical-floor bands, surrounding massing, and an approximate Boeing 767-200 envelope.
- Tower-specific impact floors and speed estimates, directional damage envelope, fireball, flames, smoke, broken glazing, falling fragments, and a residual-core visual.
- A reduced post-initiation vertical descent model using gravity, equal-floor-mass accretion with vertical momentum conservation, and an assumed crushing resistance. Initiation, tilt, fragment release, and surviving-core timing are prescribed for education; the model does not reproduce the full NIST engineering analyses.
- Separate generic steel strength/stiffness curves and a lumped heating comparison for bare and insulated hypothetical steel members.

This is not a validated forensic simulation. Historical timing, material descriptions, and the proposed collapse sequence are source-informed; geometry, visual damage, fire, smoke, and collapse propagation remain approximate. More visual detail does not increase the certainty of the assumptions.

## Sources

- [NIST WTC Towers Investigation FAQs](https://www.nist.gov/world-trade-center-investigation/study-faqs/wtc-towers-investigation)
- [NIST NCSTAR 1 Final Report](https://nvlpubs.nist.gov/nistpubs/Legacy/NCSTAR/ncstar1.pdf)
- [NIST aircraft impact analysis](https://www.nist.gov/system/files/documents/2017/05/09/3Fahim1.pdf)
- [NIST structural steel analysis](https://www.nist.gov/system/files/documents/2017/04/28/2Gayle.pdf)
- [NIST temperature-dependent steel modeling](https://nvlpubs.nist.gov/nistpubs/TechnicalNotes/NIST.TN.1907.pdf)

## Local use

Serve this directory with any static HTTP server. `scene.js` imports Three.js `0.180.0` from jsDelivr, while the rest of the app is local.

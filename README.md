# Sudoku

A Sudoku game and solver built as a Progressive Web App (PWA). It has no dependencies and no build step, and it runs on phones and laptops. Once it's installed, it works offline.

## Features
- 4 difficulty levels: Easy, Medium, Hard and Expert. Each puzzle has exactly one solution, and the difficulty is graded by which solving techniques the puzzle needs.
- 💡 Hints: 3 per game. Each hint first nudges you toward the right area. "Show me where" then explains the exact cell, and "Fill it in" places the number.
- Timer that pauses automatically when you leave the app. You can also pause it manually.
- Mistakes counter: 3 mistakes ends the game. Includes notes (pencil marks), undo, and highlighting for the selected cell's row, column, box and matching numbers.
- History of every game played, with difficulty, result, time and hints used, plus your best time for each level.
- A solver tab: type in any puzzle, then solve it completely or step through it one explained move at a time.
- Your progress is saved automatically, so closing the tab doesn't lose your game.

Keyboard shortcuts: `1`–`9` enter a number, arrow keys move, `Backspace` erases, `N` toggles notes, `H` asks for a hint, `P` or `Space` pauses, and `Cmd/Ctrl+Z` undoes.

## Run locally
```sh
python3 -m http.server 8765
# open http://localhost:8765
```

## Put it on your phone and laptop (GitHub Pages)
1. Create a new public repository on GitHub and push this folder to it.
2. In the repository, go to **Settings → Pages → Source: Deploy from a branch**, then choose `main` and `/ (root)`.
3. Your site will be at `https://<username>.github.io/<repo>/`.
4. Install it as an app:
   - **iPhone (Safari):** tap Share, then **Add to Home Screen**.
   - **Android (Chrome):** open the ⋮ menu, then **Install app**.
   - **Mac or PC (Chrome/Edge):** click the install icon in the address bar. Or just bookmark the page.

After you change files and push, bump `VERSION` in `sw.js` so installed copies pick up the update.

> History and saved games are stored separately on each device, using the browser's localStorage. Syncing them between devices would need a small backend.

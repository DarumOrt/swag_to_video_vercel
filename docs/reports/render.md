# Рендер-движок и визуализация — отчёт (вехи 1–4 + показ текста)

Код: `src/render/`, `src/visualizers/`. Стенд `dev/render.html` (порт 5177; `?preset=…&format=1080x1920&fps=30&fx=style|demo|none&frame=N&safe=1&seed=N&story=0|1&text=<режим>&anim=<анимация>&scale=1.5`; поля «Сид», 🎲, «сюжетные секции», «Текст», «Анимация», «Масштаб», строка текущей сцены). Бенчмарки `e2e/render/frame-cost.spec.ts`.

## Публичный API (`@/render`)

- `SceneRenderer` (`FrameRenderer`: `init`/`renderFrame(N)`/`resize`/`dispose`), HTMLCanvas и OffscreenCanvas. `Scene` = `{ version, seed, safeArea, layers, effects, director? }`; `normalizeScene()`, `buildPresetScene(id, values)`, `STYLE_PRESETS` (studio, neon, minimal, grunge, fullscreen), `LAYER_SCHEMAS`, `ParamSpec`, `FONT_FAMILY`.
- Слои: background, noise, 8 визуализаторов, text, lyrics, kinetic, fulltext. `RectSpec.space`: safe/center/bleed/frame. `motion` любого слоя: секции, удар на бите (× `shot.intensity`), depth.
- **Показ текста** (`layers/textReveal.ts`, экспорт `TextReveal`/`TEXT_REVEALS`, `TextAnim`/`TEXT_ANIMS`, `LineExit`, `clampTextScale`):
  - `lyrics.reveal`: `karaoke` (как было: подсветка, превью, прокрутка) | `word` (слова по таймингу, остаются до ухода строки) | `word-solo` (только текущее слово, по центру, отдельно вписано) | `line` (строка целиком на lead-in) | `typewriter` (буквы в пределах тайминга слова, ≥0.06 с/буква) | `pop` (отскок с перелётом масштаба). В не-караоке строки стоят на месте, превью нет.
  - `anim`: fade / slide-up / scale / blur / none + `animSec` — вход слов и выход строки. `exit`: `line-end` (после последнего слова + `holdSec`, но не позже показа следующей) | `next-line` (держится в паузах до следующей).
  - `scale` 0.5–2.5 (lyrics и kinetic) × `fontSize`. Автоподгонка lyrics: область = ширина rect ∩ safe-area и высота до краёв safe-area от якоря; сначала перенос (до `ceil(maxRows·scale)` строк), потом ужатие. Kinetic вписывается в свой rect (он внутри safe-area).
  - `kinetic.reveal`: word | line | typewriter | pop (+ `anim`, `scale`; «одно слово» = раскладка `focus`). Выход строки kinetic тоже через `anim`.
  - `fulltext` — режимы свои; в схему добавлен `futureOpacity`.
  - `f.words` во всех режимах — только видимые слова, с учётом анимации (сдвиг, масштаб) и `scale`.
- Параметры пресетов (группа «Текст»): `textMode`, `textAnim`, `textScale`, у studio/neon ещё `lineExit`. Значения по умолчанию: **studio — typewriter/fade, neon — word/blur, minimal — word/slide-up, grunge — pop/scale**, fullscreen — `textMode` word (будущие слова скрыты, было 0.15) | karaoke, `textScale` → `fill`/`maxHeight`. Караоке больше нигде не по умолчанию (слой `lyrics` без пресета — по-прежнему karaoke).
- **Режиссёр** (`director.ts`): `{ energy, chaos, randomness, transitionSec, transitions, camera3d, scenes: {роль → ShotSpec} }`, `ShotSpec` = `{ intensity, groups, layers, layout, camera, transition }` поверх `ROLE_SHOTS`; вид секции сидится по `repeatGroup`; переходы cut/fade/flash/zoom/whip/glitch. `FrameContext.shot: ShotState`; kinetic/fulltext берут `shot.layout`.
- Камера: `tiltX/tiltY?`; с `camera3d` — WebGL-проход `perspective.ts`, без 3D — 2D-аппроксимация. Точки расширения эффектов (`effectsHost.ts`) без изменений.

## Готово / проверено

Вехи 1–4 + показ текста. Тесты `layers/textReveal.test.ts`: что видно в момент t для каждого режима, exit line-end/next-line, slide-up/pop, однословные строки во всех режимах, детерминизм команд во всех режимах × анимациях (lyrics и kinetic), масштаб ×0.5, ×2.5 в 9:16/16:9/1:1 — боксы внутри safe-area, перенос в несколько строк. 189 тестов, eslint, tsc зелёные. Стенд: neon word/blur ×1.5 и studio typewriter ×2.5 — ок, детерминизм GPU/CPU на стенде — OK.

## Ловушки

- Детерминизм: кадр = f(timeline, scene, size, fps, N). Text-слои раскладывают все строки заранее (lyrics в word-solo — ещё и каждое слово). Kinetic в typewriter меряет текст в кадре (`measureText`, команд не шлёт).
- `blur` — `ctx.filter`; где фильтры не поддерживаются, остаётся только проявление.
- `symmetry.test.ts` проверяет lyrics в режиме `line` (в word-режимах строка рисуется частично намеренно).
- При показе следующей строки предыдущая уходит анимацией выхода поверх входа новой (на одном месте); при `anim: none` — мгновенная смена.
- Переходы: с эффектом `section-transitions` переходы рисуют эффекты. Перспектива: `WordBox` — кадр до наклона. `fillStyle: 'video'` копирует холст. HTMLCanvas и OffscreenCanvas дают разные хэши с `lighter` — сравнивать на одном типе.

## Что осталось

1. Фронту: показать `textMode`/`textAnim`/`textScale`/`lineExit` (уже в `params` пресетов и `LAYER_SCHEMAS`); после `splitLine` из лирики короткие строки работают во всех режимах.
2. Эффектам: `camera-orbit` → `camera.tiltY`; секционные эффекты могут читать `f.shot`; эффект-стиль «edit» для fullscreen.
3. Камера по слову (нужен проход раскладки до камеры); прямой импорт `@/effects`; Butterchurn — опционально.

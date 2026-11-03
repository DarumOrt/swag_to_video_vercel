# Рендер-движок и визуализация — отчёт (вехи 1–4)

Код: `src/render/`, `src/visualizers/`. Стенд `dev/render.html` (порт 5177; `?preset=fullscreen&format=1080x1920&fps=30&fx=style|demo|none&frame=N&safe=1&seed=N&story=0|1`; поле «Сид», 🎲 «Перемешать», «сюжетные секции», строка текущей сцены: роль/раскладка/интенсивность/переход). Бенчмарки `e2e/render/frame-cost.spec.ts`.

## Публичный API (`@/render`)

- `SceneRenderer` (`FrameRenderer`: `init`/`renderFrame(N)`/`resize`/`dispose`), HTMLCanvas и OffscreenCanvas. `Scene` = `{ version, seed, safeArea, layers, effects, director? }`; `normalizeScene()`, `buildPresetScene(id, values)`, `STYLE_PRESETS` (studio, neon, minimal, grunge, **fullscreen**), `LAYER_SCHEMAS`, `ParamSpec`, шрифты `FONT_FAMILY`.
- Слои: background, noise, 8 визуализаторов, text, lyrics, kinetic, **fulltext**. `RectSpec.space`: safe/center/bleed/frame. `motion` любого слоя: секции, удар на бите (теперь × `shot.intensity`), depth.
- **Режиссёр** (`director.ts`, `Scene.director: DirectorSpec | null`): `{ energy, chaos, randomness, transitionSec, transitions: 'auto'|kind, camera3d, scenes: {роль → ShotSpec} }`. `ShotSpec` = `{ intensity, groups {background|visual|text → прозрачность}, layers {id → прозрачность}, layout (строка или список — выбор по сиду), camera {zoom, push, drift, roll, tilt, orbit, punch}, transition }` поверх встроенных `ROLE_SHOTS`. Роль — `sectionRole()` из контракта. Вид секции сидится по `repeatGroup` (припевы похожи), переход — по индексу. Плавный кроссфейд параметров за `transitionSec`. Переходы: cut/fade/flash/zoom/whip/glitch.
- `FrameContext.shot: ShotState` — `{ role, index, start, end, progress, enter, variant, intensity, layout, energy, chaos }`; без режиссёра — `neutralShot` (роль есть, уровни нейтральны). Слои kinetic/fulltext берут `shot.layout`, если это их режим.
- Камера: `CameraTransform.tiltX/tiltY?` (рад., необязательные). С `director.camera3d` — настоящая перспектива: движковый WebGL-проход `perspective.ts` первым в цепочке (плоскость кадра в пинхол-камере, масштаб «покрытия», без пустых краёв), слоям камера отдаётся без наклона. Без 3D — 2D-аппроксимация (сжатие на cos в `applyCamera`/`projectWord`, `cameraScale()`).
- Пресеты получили мягкого режиссёра: studio (0.3/0.15), neon (0.6/0.35), minimal (+ раскладка по секциям, параметр `directed`), grunge (0.8/0.5, focus на дропах). **fullscreen**: слово/фраза/столбик на весь экран, ориентация чередуется (или по сиду), «видео внутри букв» (кадр под текстом копируется в маску букв, вокруг затемнение), эхо-контуры на битах, вход «удар» или «из-под маски», 3D-камера, у каждой роли своя раскладка; параметры: буквы, ориентация, шрифт, эхо, цвета, визуализатор, энергия, хаос, 3D.
- Точки расширения эффектов (`effectsHost.ts`) без изменений по форме; `f.words` заполняет и fulltext (с учётом поворота 90°).

## Готово / проверено

Вехи 1–3 (движок, визуализаторы, лирика, кинетика, 4 пресета, центровка) + веха 4: режиссёр, fulltext, перспектива, стенд. Тесты: `director.test.ts` (роли/раскладки/интенсивность по секциям, кроссфейд, детерминизм и различие по сиду, repeatGroup, переходы, проводка в `SceneRenderer`), `perspective.test.ts`, `layers/fulltext.test.ts`. 169 тестов, eslint и tsc по своим папкам зелёные. GPU-детерминизм fullscreen с 3D на стенде — OK. Бенчмарк (машина была нагружена, пустая сцена в экспорте 40 мс вместо ~25): превью 1080×1920 — fullscreen 44 к/с, neon 26–35 к/с (с режиссёром и без — одинаково), `renderFrame` ≈ 1 мс CPU.

## Ловушки

- Детерминизм: кадр = f(timeline, scene, size, fps, N); случайность только через сид. Text-слои раскладывают все строки во всех режимах заранее (режиссёр может сменить режим) — иначе первый кадр шлёт лишние команды.
- Переходы: если в сцене есть эффект `section-transitions`, переходы рисуют эффекты, режиссёр только меняет сцены.
- Перспектива — проход по всему кадру: оверлеи эффектов тоже наклоняются (визуально согласованно), но `WordBox` описывают кадр до наклона.
- `fillStyle: 'video'` копирует холст (`drawImage(g.canvas)`); без OffscreenCanvas (тесты в node) — обычная заливка.
- HTMLCanvas и OffscreenCanvas дают разные хэши на пресетах с `lighter` (neon, fullscreen) — так было и до вехи 4; внутри одного типа кадры совпадают. Хэши сравнивать на одном типе канваса.
- Прежние: прогревочный кадр в `init`; GPU/CPU-растеризация различаются; GL→2D через `copy`/`readPixels`; `init` ждёт шрифты слоёв и эффектов.

## Что осталось

1. Эффектам (хуки готовы): `camera-orbit` может писать `camera.tiltY` (3D при `director.camera3d`, иначе 2D-сжатие); секционные эффекты могут читать `f.shot` (роль, `enter`, `intensity`). Нужен эффект-стиль «edit» для fullscreen (сейчас `minimal`).
2. Фронту: «перемешать» = новый `scene.seed`; ручки режиссёра (энергия/хаос/случайность) пока только в fullscreen.
3. Камера по слову (zoom в слово) — по-прежнему нужен проход раскладки до камеры. Хвосты: прямой импорт `@/effects` вместо `effectsModule as {...}`, Butterchurn — опционально.

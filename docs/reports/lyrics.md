# Отчёт: Текст и тайминги (`src/lyrics/`)

## Публичный API (`@/lyrics`, всё — чистые функции, вход не мутируется)

- `parseLyricsText(text, {language?}) → Lyrics` · `lyricsToText(lyrics)` · `parseLrc(text) → {lyrics, metadata}` · `toLrc(lyrics, {enhanced, wordEndTags, includeSections, metadata})`
- `alignLyrics(lyrics, recognized: RecognizedWord[], {threshold=55, positionWeight, runBonus, pauseSec=1.5, durationSec, fixedSources}) → {lyrics, matches, anchoredCount, wordCount}` · `matchWords(lyricTexts, recognized)` · `matchUnits(text, lang)`
- `snapToOnsets(lyrics, vocalOnsets, {windowSec=0.08, sources})` · `lyricsFromRecognized(words, {lineGapSec, maxWordsPerLine})` · `isUncertain(word)`
- Тап-синк: `startTapSession(lyrics, 'line'|'word', fromIndex)`, `recordTap`, `recordRelease`, `undoTap`, `nextTapUnit`, `applyTaps(lyrics, session)`
- Редактор: `editWord(lyrics, wordId, {text?, start?, end?})`, `shiftLine(lyrics, lineId, delta)`, `retimeFrom(lyrics, wordId, mode) → {lyrics, session, resumeFromSec}`
- Сетка BPM (`grid.ts`): `snapToBeatGrid(lyrics, {beats}, {division:4|8|16=8, strength=0.8, mode:'lines'|'words'|'both'='lines', maxShiftSec=0.12, sources})`, `beatGridFit(lyrics, {beats}) → {score, suggestedDivision, byDivision}`, `GRID_AUTO_THRESHOLD=0.5`, `nearestGridTime`. Сетка строится между соседними битами (дрейф темпа). Двигает только `whisper/aligned/interpolated/snapped`, ставит `'snapped'`.
- Акценты (контракт v1.2, несколько на слово): `addAccent(accents, wordId, effect, overrides?{…, endWordId})` (id `user:<wordId>`, `#2`…; `nextAccentId` — предсказать id), `updateAccent(accents, id, patch)` (патч → `source:'user'`; смена effect сбрасывает тайминг; `endWordId:null` снимает диапазон), `removeAccent(accents, id)` (не найден id → снимает все акценты слова, для старых вызовов), `removeAccentsOfWord`, `setAccentRange(lyrics, accents, id, endWordId|null)` (невалидный конец → без изменений; проверка `isValidAccentRange`), `accentsForWord`, `accentsCoveringWord(lyrics, accents, wordId)`, `isRangeEffect`/`RANGE_EFFECTS`, `applyToAllOccurrences` (добавляет/обновляет акцент ЭТОГО эффекта, чужие не трогает, диапазон копируется по длине в словах), `regenerateAuto`, `suggestAccents(lyrics, rhythm, sections?, {style, maxPer10Sec, minGapSec, minScore, sectionModes=true, minSectionWords=3})`, `setAccent` — старая обёртка (заменяет ВСЕ акценты слова; фронт перейдёт на `addAccent`).
- Деление строк (`split.ts`): `splitLine(lyrics, lineId, atWordId)` — делит ПЕРЕД словом (первая часть сохраняет id, `section`, `stanzaStart`; вторая — та же секция, id `s:<id первого слова>`, при коллизии `-2`); `mergeLines(lyrics, lineId)` — склеивает со следующей (остаётся id/секция/stanzaStart первой); `splitLineEvery(lyrics, lineId, n)`; `autoSplitLong(lyrics, {maxWords=6, maxChars=36, pauseSec=0.25})` — делит длинные строки рекурсивно по самой длинной паузе/пунктуации в средней половине, иначе посередине. Id слов НЕ меняются → акценты и диапазоны целы. Неизвестный id/первое слово/последняя строка → вход как есть. Времён у строки нет (считаются из слов).
- Утилиты: `tokenizeLine`, `normalizeWord`, `wordSimilarity`, `transliterate`, `countSyllables`, `detectLanguage`, `spellNumber`, `flattenWords`, `withWords`, `sanitizeTimings`, `distribute`

## Что вызвать фронту (веха 4)

`alignLyrics → snapToOnsets(…, vocalOnsets) → [snapToBeatGrid(…, rhythm, {division: fit.suggestedDivision})]`. Тумблер «сетка BPM»:
`fit = beatGridFit(lyrics, rhythm)` после выравнивания; авто-включать при `fit.score >= GRID_AUTO_THRESHOLD` (0.5; ровный бит ~0.8+,
свободный ритм ~0.1), иначе показывать выключенным. Снап пересчитывать от выровненных слов, не накладывать повторно (идемпотентен, но тянет по `strength`).

## Готово

Модель/парсинг (секции, `stanzaStart`, стабильные id), LRC/Enhanced LRC (импорт → `'imported'`), NW-выравнивание
(транслит RU↔EN, числа 0–999, дефисы, монотонность, разведение повторов по времени/паузам), интерполяция по слогам,
магнит к onsets, тап-синк, режим без текста, правки для редактора, подсказки акцентов (3 стиля). 119 тестов. Диапазонные режимы: дефолты в `EFFECT_DEFAULTS` (6 новых id), `suggestAccents` кладёт ≤1 режим на секцию с ролью chorus/drop (`reason:'section'`, `endWordId`, id `auto:<wordId>:range`; style minimal — без режимов).

## Известные проблемы и ловушки

- Разделённые строки: после `lyricsToText` → `parseLyricsText` id строк/слов пересчитываются (хэш текста) — акценты отвяжутся; на живой модели хранить `Lyrics`, не гонять через текст.
- Id строки = хэш нормализованного текста + номер повтора (`-2`); правка текста строки меняет её id и id её слов → акценты отвязываются. `editWord` id не меняет, повторный `parseLyricsText` — меняет.
- `fixedSources` по умолчанию `manual/tap/imported`: после импорта LRC `alignLyrics` почти ничего не двигает. `keepUserTimings` — устаревший псевдоним, его ещё использует фронт (`src/app/lyricsActions.ts`).
- `snapToOnsets` двигает только `whisper/aligned/interpolated/snapped`; `'imported'` — только если добавить в `sources`.
- Без `durationSec` одиночный распознанный припев всегда уходит к последнему повтору — передавайте длину трека.
- Числа только в начальной форме («одна», «двух» не совпадут); >999 и годы не раскрываются.
- `sanitizeTimings` при перекрытиях сдвигает старты вперёд каскадом — перед вызовом тайминги должны быть почти упорядочены.
- `AccentSuggestion` несёт лишние `reason`/`score`; в timeline класть через `regenerateAuto` (он их срезает).
- Тексты из `test-media/*.txt` нельзя копировать в тесты — только собственные строки.

## Что осталось

- Проверка выравнивания на реальном выходе Whisper (`test-media/`), подбор `threshold`/`positionWeight`/`runBonus`.
- Формы числительных, годы; слоги в контракте (`LyricWord.syllables`) — отложено главной сессией.

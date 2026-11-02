# Отчёт: Текст и тайминги (`src/lyrics/`)

## Публичный API (`@/lyrics`, всё — чистые функции, вход не мутируется)

- `parseLyricsText(text, {language?}) → Lyrics` · `lyricsToText(lyrics)` · `parseLrc(text) → {lyrics, metadata}` · `toLrc(lyrics, {enhanced, wordEndTags, includeSections, metadata})`
- `alignLyrics(lyrics, recognized: RecognizedWord[], {threshold=55, positionWeight, runBonus, pauseSec=1.5, durationSec, fixedSources}) → {lyrics, matches, anchoredCount, wordCount}` · `matchWords(lyricTexts, recognized)` · `matchUnits(text, lang)`
- `snapToOnsets(lyrics, vocalOnsets, {windowSec=0.08, sources})` · `lyricsFromRecognized(words, {lineGapSec, maxWordsPerLine})` · `isUncertain(word)`
- Тап-синк: `startTapSession(lyrics, 'line'|'word', fromIndex)`, `recordTap`, `recordRelease`, `undoTap`, `nextTapUnit`, `applyTaps(lyrics, session)`
- Редактор: `editWord(lyrics, wordId, {text?, start?, end?})`, `shiftLine(lyrics, lineId, delta)`, `retimeFrom(lyrics, wordId, mode) → {lyrics, session, resumeFromSec}`
- Акценты: `suggestAccents(lyrics, rhythm, sections?, {style, maxPer10Sec=3, minGapSec=1, minScore=0.6}) → AccentSuggestion[]`, `setAccent(accents, wordId, effect, overrides?)`, `removeAccent`, `applyToAllOccurrences(lyrics, accents, wordId, effect)`, `regenerateAuto(accents, suggestions)`
- Утилиты: `tokenizeLine`, `normalizeWord`, `wordSimilarity`, `transliterate`, `countSyllables`, `detectLanguage`, `spellNumber`, `flattenWords`, `withWords`, `sanitizeTimings`, `distribute`

## Готово

Модель/парсинг (секции, `stanzaStart`, стабильные id), LRC/Enhanced LRC (импорт → `'imported'`), NW-выравнивание
(транслит RU↔EN, числа 0–999, дефисы, монотонность, разведение повторов по времени/паузам), интерполяция по слогам,
магнит к onsets, тап-синк, режим без текста, правки для редактора, подсказки акцентов (3 стиля). 86 тестов.

## Известные проблемы и ловушки

- Id строки = хэш нормализованного текста + номер повтора (`-2`); правка текста строки меняет её id и id её слов → акценты отвязываются. `editWord` id не меняет, повторный `parseLyricsText` — меняет.
- `fixedSources` по умолчанию `manual/tap/imported`: после импорта LRC `alignLyrics` почти ничего не двигает. `keepUserTimings` — устаревший псевдоним, его ещё использует фронт (`src/app/lyricsActions.ts`).
- `snapToOnsets` двигает только `whisper/aligned/interpolated/snapped`; `'imported'` — только если добавить в `sources`.
- Без `durationSec` одиночный распознанный припев всегда уходит к последнему повтору — передавайте длину трека.
- Числа только в начальной форме («одна», «двух» не совпадут); >999 и годы не раскрываются.
- Если в дефисном слове совпала только вторая часть, старт слова будет поздним.
- `sanitizeTimings` при перекрытиях сдвигает старты вперёд каскадом — перед вызовом тайминги должны быть почти упорядочены.
- `AccentSuggestion` несёт лишние `reason`/`score`; в timeline класть через `regenerateAuto` (он их срезает).
- Удалённый пользователем автоакцент вернётся при `regenerateAuto` — в контракте нет «отклонённых» слов.
- `AccentStyle` объявлен в `src/lyrics`, а не в `src/shared`.
- Тексты из `test-media/*.txt` нельзя копировать в тесты — только собственные строки.

## Что осталось

- Проверка выравнивания на реальном выходе Whisper (`test-media/`), подбор `threshold`/`positionWeight`/`runBonus`.
- Формы числительных, годы; слоги в контракте (`LyricWord.syllables`) — отложено главной сессией.
- Хранение отклонённых автоакцентов; общий тип стиля акцентов в `src/shared`.
- Подсказки акцентов на реальных `beatStrength`/`sections`.

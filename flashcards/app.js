import { CC_TLD_SOURCE, CC_TLDS } from './cc-tlds.js'

const APP_STATE_VERSION = 1
const DEFAULT_DAILY_GOAL_MS = 3 * 60 * 1000
const STORAGE_KEY = 'root-recall-state-v1'
const BACKUP_PREFIX = 'CCTLD1:'
const SWIPE_COMMIT_DISTANCE = 110
const SWIPE_COMMIT_RATIO = 0.24
const REVIEW_LADDER = [1, 3, 7, 14, 30, 45, 75, 120, 180]
const ROUTE_TITLES = {
  today: 'Today',
  study: 'Study',
  progress: 'Progress',
  browse: 'Browse',
  settings: 'Settings',
  backup: 'Backup',
}
const RANK_BANDS = [
  { ceiling: 4, title: 'Packet Scout' },
  { ceiling: 14, title: 'DNS Trainee' },
  { ceiling: 29, title: 'Name Resolver' },
  { ceiling: 44, title: 'Root Walker' },
  { ceiling: 59, title: 'Zone Mapper' },
  { ceiling: 74, title: 'TLD Navigator' },
  { ceiling: 89, title: 'Anycast Pilot' },
  { ceiling: 97, title: 'Root Server' },
  { ceiling: 100, title: 'IANA Whisperer' },
]

const root = document.getElementById('app')
const searchableCards = CC_TLDS.map((card) => ({
  ...card,
  searchText: [card.tld, card.code, card.nameDisplay, card.nameIsoShort, ...(card.aliases ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase(),
}))

const uiState = {
  route: getRouteFromHash(),
  notice: null,
  noticeTimeoutId: null,
  browse: {
    query: '',
    selectedCode: null,
  },
  study: {
    studyMode: null,
    currentUnit: null,
    hasSeenGestureHint: false,
    turn: 0,
    recentKeys: [],
    sessionQueue: [],
  },
}

let appState = loadAppState()
let studyClockStartedAt = null
const studySwipe = {
  pointerId: null,
  startX: 0,
  startY: 0,
  deltaX: 0,
  isDragging: false,
  isAnimating: false,
}

if (!root) {
  throw new Error('App root not found')
}

function isRecord(value) {
  return typeof value === 'object' && value !== null
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function getRouteFromHash() {
  const raw = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase()
  return ROUTE_TITLES[raw] ? raw : 'today'
}

function toDayKey(input = new Date()) {
  const value = input instanceof Date ? input : new Date(input)
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfLocalDay(input) {
  const value = input instanceof Date ? input : new Date(input)
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function daysBetween(left, right) {
  const a = startOfLocalDay(left).getTime()
  const b = startOfLocalDay(right).getTime()
  return Math.round((a - b) / (24 * 60 * 60 * 1000))
}

function clampStudyMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return 0
  }

  return Math.min(ms, 30_000)
}

function formatClockMinutes(ms) {
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  return `${minutes}:${`${seconds}`.padStart(2, '0')}`
}

function formatRelativeDue(dueAt, now = new Date()) {
  if (!dueAt) {
    return 'New'
  }

  const diffMs = new Date(dueAt).getTime() - now.getTime()
  if (diffMs <= 0) {
    return 'Due now'
  }

  const diffHours = diffMs / (60 * 60 * 1000)
  if (diffHours < 24) {
    return `Due in ${Math.max(1, Math.round(diffHours))}h`
  }

  return `Due in ${Math.max(1, Math.round(diffHours / 24))}d`
}

function getModeLabel(mode) {
  if (mode === 'code_to_country') {
    return 'Code to Country'
  }

  if (mode === 'country_to_code') {
    return 'Country to Code'
  }

  return 'Mixed'
}

function getRankTitle(percentMastered) {
  const rounded = Math.max(0, Math.min(100, Math.round(percentMastered)))
  return RANK_BANDS.find((band) => rounded <= band.ceiling)?.title ?? 'Packet Scout'
}

function encodeBase64Url(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function decodeBase64Url(text) {
  const normalized = text.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function createBackupString(state) {
  return `${BACKUP_PREFIX}${encodeBase64Url(JSON.stringify(state))}`
}

function parseBackupString(value) {
  const trimmed = value.trim()
  if (!trimmed.startsWith(BACKUP_PREFIX)) {
    throw new Error('Backup code must start with CCTLD1:.')
  }

  return normalizeAppState(JSON.parse(decodeBase64Url(trimmed.slice(BACKUP_PREFIX.length))))
}

function createEmptyAppState() {
  const now = new Date().toISOString()
  return {
    version: APP_STATE_VERSION,
    createdAt: now,
    updatedAt: now,
    units: {},
    dailyActivity: {},
    settings: {
      preferredMode: 'mixed',
      reduceMotion: false,
      dailyGoalMs: DEFAULT_DAILY_GOAL_MS,
    },
  }
}

function createUnitProgress(key, mode) {
  return {
    key,
    mode,
    seenCount: 0,
    successCount: 0,
    lapseCount: 0,
    successStreak: 0,
    intervalDays: 0,
    dueAt: null,
    lastReviewedAt: null,
    masteredAt: null,
  }
}

function getUnitKey(code, mode) {
  return `${code.toLowerCase()}|${mode}`
}

function modeFromKey(key) {
  if (key.endsWith('|code_to_country')) {
    return 'code_to_country'
  }

  if (key.endsWith('|country_to_code')) {
    return 'country_to_code'
  }

  return null
}

function ensureUnitProgress(state, code, mode) {
  const key = getUnitKey(code, mode)
  return state.units[key] ?? createUnitProgress(key, mode)
}

function isUnitSeen(progress) {
  return progress.seenCount > 0
}

function isUnitDue(progress, now = new Date()) {
  if (!progress.dueAt) {
    return false
  }

  return new Date(progress.dueAt).getTime() <= now.getTime()
}

function isUnitMastered(progress) {
  return progress.successStreak >= 4 && progress.intervalDays >= 30
}

function getNextIntervalDays(currentIntervalDays) {
  if (currentIntervalDays <= 0) {
    return REVIEW_LADDER[0]
  }

  const next = REVIEW_LADDER.find((value) => value > currentIntervalDays)
  return next ?? Math.min(240, Math.round(currentIntervalDays * 1.6))
}

function reviewUnit(progress, knew, now = new Date()) {
  if (knew) {
    const intervalDays = getNextIntervalDays(progress.intervalDays)
    const nextSuccessStreak = progress.successStreak + 1
    const nextProgress = {
      ...progress,
      seenCount: progress.seenCount + 1,
      successCount: progress.successCount + 1,
      successStreak: nextSuccessStreak,
      intervalDays,
      dueAt: new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000).toISOString(),
      lastReviewedAt: now.toISOString(),
      masteredAt: null,
    }
    nextProgress.masteredAt = isUnitMastered(nextProgress) ? progress.masteredAt ?? now.toISOString() : null
    return nextProgress
  }

  return {
    ...progress,
    seenCount: progress.seenCount + 1,
    lapseCount: progress.lapseCount + 1,
    successStreak: 0,
    intervalDays: 0,
    dueAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    lastReviewedAt: now.toISOString(),
    masteredAt: null,
  }
}

function shuffleArray(items) {
  const next = [...items]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[next[index], next[swapIndex]] = [next[swapIndex], next[index]]
  }

  return next
}

function toStudyUnit(card, mode) {
  if (mode === 'code_to_country') {
    return {
      ...card,
      key: getUnitKey(card.code, mode),
      mode,
      prompt: card.tld,
      answer: card.nameDisplay,
      cue: 'Recall the country or territory',
      directionLabel: getModeLabel(mode),
      secondary: card.nameIsoShort ?? '',
    }
  }

  return {
    ...card,
    key: getUnitKey(card.code, mode),
    mode,
    prompt: card.nameDisplay,
    answer: card.tld,
    cue: 'Recall the ccTLD',
    directionLabel: getModeLabel(mode),
    secondary: card.nameIsoShort && card.nameIsoShort !== card.nameDisplay ? card.nameIsoShort : '',
  }
}

function buildStudyUnits(cards, studyMode) {
  const modes = studyMode === 'mixed' ? ['code_to_country', 'country_to_code'] : [studyMode]
  return cards.flatMap((card) => modes.map((mode) => toStudyUnit(card, mode)))
}

function getRecentPenalty(key, recentKeys) {
  const index = recentKeys.indexOf(key)
  return index === -1 ? 0 : (recentKeys.length - index) * 14
}

function pickWeighted(entries) {
  const positiveEntries = entries.filter((entry) => entry.score > 0)
  if (positiveEntries.length === 0) {
    return entries[0]?.item ?? null
  }

  const total = positiveEntries.reduce((sum, entry) => sum + entry.score, 0)
  let target = Math.random() * total
  for (const entry of positiveEntries) {
    target -= entry.score
    if (target <= 0) {
      return entry.item
    }
  }

  return positiveEntries.at(-1)?.item ?? null
}

function scoreDueUnit(progress, recentKeys, now) {
  const dueAtMs = progress.dueAt ? new Date(progress.dueAt).getTime() : now.getTime()
  const overdueDays = Math.max(0, (now.getTime() - dueAtMs) / (24 * 60 * 60 * 1000))
  return (
    80 +
    overdueDays * 10 +
    progress.lapseCount * 8 +
    Math.max(0, 5 - progress.successStreak) * 6 +
    Math.max(0, 14 - progress.intervalDays) -
    getRecentPenalty(progress.key, recentKeys)
  )
}

function scoreNewUnit(unit, recentKeys) {
  return 26 - getRecentPenalty(unit.key, recentKeys)
}

function scoreQueuedUnit(entry, recentKeys, turn) {
  return 150 + (entry.priority ?? 0) * 40 + Math.max(0, turn - entry.availableAtTurn) * 8 - getRecentPenalty(entry.key, recentKeys)
}

function scoreLearningUnit(progress, recentKeys, now) {
  const hoursSinceReview = progress.lastReviewedAt
    ? Math.max(0, (now.getTime() - new Date(progress.lastReviewedAt).getTime()) / (60 * 60 * 1000))
    : 12

  return (
    44 +
    progress.lapseCount * 10 +
    Math.max(0, 4 - progress.successStreak) * 8 +
    Math.max(0, 8 - progress.intervalDays) +
    Math.min(18, hoursSinceReview) -
    getRecentPenalty(progress.key, recentKeys)
  )
}

function scoreRefresherUnit(progress, recentKeys, now) {
  const dueInDays = progress.dueAt
    ? Math.max(0, (new Date(progress.dueAt).getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    : 5

  return 12 + Math.min(8, progress.successStreak * 2) + Math.max(0, 10 - dueInDays) - getRecentPenalty(progress.key, recentKeys)
}

function queueSessionReview(queue, entry) {
  const existing = queue.find((item) => item.key === entry.key)
  if (!existing) {
    return [...queue, entry]
  }

  return queue.map((item) =>
    item.key === entry.key
      ? {
          ...item,
          availableAtTurn: Math.min(item.availableAtTurn, entry.availableAtTurn),
          priority: Math.max(item.priority ?? 0, entry.priority ?? 0),
        }
      : item,
  )
}

function scheduleSessionFollowUp(queue, unit, nextProgress, knew, nextTurn) {
  const withoutCurrent = queue.filter((entry) => entry.key !== unit.key)

  if (!knew) {
    return queueSessionReview(withoutCurrent, {
      key: unit.key,
      availableAtTurn: nextTurn + 2,
      priority: 3,
    })
  }

  if (nextProgress.successStreak <= 2) {
    return queueSessionReview(withoutCurrent, {
      key: unit.key,
      availableAtTurn: nextTurn + 3 + nextProgress.successStreak * 2,
      priority: 1,
    })
  }

  if (!isUnitMastered(nextProgress) && Math.random() < 0.35) {
    return queueSessionReview(withoutCurrent, {
      key: unit.key,
      availableAtTurn: nextTurn + 7 + nextProgress.successStreak,
      priority: 1,
    })
  }

  if (isUnitMastered(nextProgress) && Math.random() < 0.12) {
    return queueSessionReview(withoutCurrent, {
      key: unit.key,
      availableAtTurn: nextTurn + 10 + Math.floor(Math.random() * 6),
      priority: 0,
    })
  }

  return withoutCurrent
}

function pickNextStudyUnit({ cards, state, studyMode, sessionQueue, turn, recentKeys, now = new Date() }) {
  const units = shuffleArray(buildStudyUnits(cards, studyMode))
  const unitMap = new Map(units.map((unit) => [unit.key, unit]))
  const queuedOptions = sessionQueue
    .filter((entry) => entry.availableAtTurn <= turn)
    .map((entry) => {
      const unit = unitMap.get(entry.key)
      if (!unit) {
        return null
      }

      return {
        item: unit,
        score: scoreQueuedUnit(entry, recentKeys, turn),
        priority: entry.priority ?? 0,
      }
    })
    .filter(Boolean)

  const urgentQueuedOptions = queuedOptions.filter((entry) => entry.priority >= 2)
  if (urgentQueuedOptions.length > 0) {
    return pickWeighted(urgentQueuedOptions)
  }

  const unitProgress = units.map((unit) => ({
    unit,
    progress: ensureUnitProgress(state, unit.code, unit.mode),
  }))

  const dueOptions = unitProgress
    .filter(({ progress }) => isUnitSeen(progress) && isUnitDue(progress, now))
    .map(({ unit, progress }) => ({ item: unit, score: scoreDueUnit(progress, recentKeys, now) }))

  const duePick = pickWeighted(dueOptions)
  if (duePick) {
    return duePick
  }

  const learningOptions = unitProgress
    .filter(({ progress }) => isUnitSeen(progress) && !isUnitDue(progress, now) && !isUnitMastered(progress))
    .map(({ unit, progress }) => ({ item: unit, score: scoreLearningUnit(progress, recentKeys, now) }))

  const newOptions = unitProgress
    .filter(({ progress }) => !isUnitSeen(progress))
    .map(({ unit }) => ({ item: unit, score: scoreNewUnit(unit, recentKeys) }))

  const scheduledRefreshers = queuedOptions
    .filter((entry) => entry.priority < 2)
    .map(({ item, score }) => ({
      item,
      score: 20 + score * 0.12,
    }))

  const scheduledRefresherKeys = new Set(scheduledRefreshers.map((entry) => entry.item.key))
  const refresherOptions = [
    ...scheduledRefreshers,
    ...unitProgress
      .filter(
        ({ unit, progress }) =>
          isUnitSeen(progress) &&
          !isUnitDue(progress, now) &&
          progress.successStreak > 0 &&
          !scheduledRefresherKeys.has(unit.key),
      )
      .map(({ unit, progress }) => ({ item: unit, score: scoreRefresherUnit(progress, recentKeys, now) })),
  ]

  const category = pickWeighted([
    ...(learningOptions.length > 0 ? [{ item: 'learning', score: 12 }] : []),
    ...(newOptions.length > 0 ? [{ item: 'new', score: learningOptions.length > 0 ? 8 : 14 }] : []),
    ...(refresherOptions.length > 0 ? [{ item: 'refresh', score: 2 + Math.min(3, Math.floor(turn / 12)) }] : []),
  ])

  if (category === 'learning') {
    return pickWeighted(learningOptions)
  }

  if (category === 'refresh') {
    return pickWeighted(refresherOptions)
  }

  if (category === 'new') {
    return pickWeighted(newOptions)
  }

  return unitProgress.find(({ progress }) => !isUnitSeen(progress))?.unit ?? null
}

function getStreaks(activity, today = new Date()) {
  const keys = Object.keys(activity)
    .filter((key) => (activity[key]?.cards ?? 0) > 0)
    .sort()

  if (keys.length === 0) {
    return { current: 0, best: 0 }
  }

  let best = 0
  let run = 0
  for (let index = 0; index < keys.length; index += 1) {
    if (index === 0 || daysBetween(keys[index], keys[index - 1]) === 1) {
      run += 1
    } else {
      run = 1
    }
    best = Math.max(best, run)
  }

  const todayKey = toDayKey(today)
  const latestKey = keys.at(-1) ?? todayKey
  if (daysBetween(todayKey, latestKey) > 1) {
    return { current: 0, best }
  }

  let current = 0
  const cursor = new Date(today)
  while ((activity[toDayKey(cursor)]?.cards ?? 0) > 0) {
    current += 1
    cursor.setDate(cursor.getDate() - 1)
  }

  return { current, best }
}

function getProgressSnapshot(state, cards, now = new Date()) {
  const units = cards.flatMap((card) => [
    ensureUnitProgress(state, card.code, 'code_to_country'),
    ensureUnitProgress(state, card.code, 'country_to_code'),
  ])

  const seenUnits = units.filter(isUnitSeen).length
  const masteredUnits = units.filter(isUnitMastered).length
  const dueNow = units.filter((progress) => isUnitDue(progress, now)).length
  const seenCards = cards.filter((card) => {
    const forward = ensureUnitProgress(state, card.code, 'code_to_country')
    const reverse = ensureUnitProgress(state, card.code, 'country_to_code')
    return isUnitSeen(forward) || isUnitSeen(reverse)
  }).length
  const streaks = getStreaks(state.dailyActivity, now)
  const today = state.dailyActivity[toDayKey(now)] ?? { cards: 0, ms: 0 }

  return {
    totalCards: cards.length,
    totalUnits: units.length,
    seenCards,
    seenUnits,
    dueNow,
    masteredUnits,
    masteredPercent: units.length === 0 ? 0 : (masteredUnits / units.length) * 100,
    currentStreak: streaks.current,
    bestStreak: streaks.best,
    todayCards: today.cards,
    todayMs: today.ms,
  }
}

function getNextDueLabel(state, studyMode) {
  const nextDue = buildStudyUnits(CC_TLDS, studyMode)
    .map((unit) => ensureUnitProgress(state, unit.code, unit.mode))
    .filter((progress) => progress.dueAt)
    .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime())
    .at(0)

  return nextDue?.dueAt ? formatRelativeDue(nextDue.dueAt) : 'not scheduled yet'
}

function normalizeAppState(value) {
  if (!isRecord(value)) {
    return createEmptyAppState()
  }

  const empty = createEmptyAppState()
  const units = {}
  if (isRecord(value.units)) {
    for (const [key, unit] of Object.entries(value.units)) {
      if (!isRecord(unit)) {
        continue
      }

      const mode = modeFromKey(key)
      if (!mode) {
        continue
      }

      units[key] = {
        ...createUnitProgress(key, mode),
        seenCount: Number.isFinite(unit.seenCount) ? Math.max(0, unit.seenCount) : 0,
        successCount: Number.isFinite(unit.successCount) ? Math.max(0, unit.successCount) : 0,
        lapseCount: Number.isFinite(unit.lapseCount) ? Math.max(0, unit.lapseCount) : 0,
        successStreak: Number.isFinite(unit.successStreak) ? Math.max(0, unit.successStreak) : 0,
        intervalDays: Number.isFinite(unit.intervalDays) ? Math.max(0, unit.intervalDays) : 0,
        dueAt: typeof unit.dueAt === 'string' ? unit.dueAt : null,
        lastReviewedAt: typeof unit.lastReviewedAt === 'string' ? unit.lastReviewedAt : null,
        masteredAt: typeof unit.masteredAt === 'string' ? unit.masteredAt : null,
      }
    }
  }

  const dailyActivity = {}
  if (isRecord(value.dailyActivity)) {
    for (const [key, activity] of Object.entries(value.dailyActivity)) {
      if (!isRecord(activity)) {
        continue
      }

      dailyActivity[key] = {
        cards: Number.isFinite(activity.cards) ? Math.max(0, activity.cards) : 0,
        ms: Number.isFinite(activity.ms) ? Math.max(0, activity.ms) : 0,
      }
    }
  }

  return {
    version: APP_STATE_VERSION,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : empty.createdAt,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : empty.updatedAt,
    units,
    dailyActivity,
    settings: {
      preferredMode:
        value.settings?.preferredMode === 'mixed' ||
        value.settings?.preferredMode === 'code_to_country' ||
        value.settings?.preferredMode === 'country_to_code'
          ? value.settings.preferredMode
          : empty.settings.preferredMode,
      reduceMotion: value.settings?.reduceMotion === true,
      dailyGoalMs: Math.max(
        DEFAULT_DAILY_GOAL_MS,
        Number.isFinite(value.settings?.dailyGoalMs) ? value.settings.dailyGoalMs : DEFAULT_DAILY_GOAL_MS,
      ),
    },
  }
}

function loadAppState() {
  try {
    return normalizeAppState(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    return createEmptyAppState()
  }
}

function saveAppState() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appState))
  } catch {
    setNotice('Progress could not be saved to localStorage in this browser.')
  }
}

function setNotice(message) {
  uiState.notice = message
  if (uiState.noticeTimeoutId) {
    window.clearTimeout(uiState.noticeTimeoutId)
  }

  uiState.noticeTimeoutId = window.setTimeout(() => {
    uiState.notice = null
    renderApp()
  }, 3200)

  renderApp()
}

function mutateAppState(mutator, options = {}) {
  appState = mutator(appState)
  appState.updatedAt = options.updatedAt ?? new Date().toISOString()
  saveAppState()
  if (!options.skipRender) {
    renderApp()
  }
}

function applyReview(card, mode, knew, now = new Date()) {
  let nextProgress = createUnitProgress(getUnitKey(card.code, mode), mode)
  mutateAppState((state) => {
    const key = getUnitKey(card.code, mode)
    const current = state.units[key] ?? createUnitProgress(key, mode)
    nextProgress = reviewUnit(current, knew, now)
    const dayKey = toDayKey(now)
    const today = state.dailyActivity[dayKey] ?? { cards: 0, ms: 0 }

    return {
      ...state,
      units: {
        ...state.units,
        [key]: nextProgress,
      },
      dailyActivity: {
        ...state.dailyActivity,
        [dayKey]: {
          cards: today.cards + 1,
          ms: today.ms,
        },
      },
    }
  }, { updatedAt: now.toISOString(), skipRender: true })

  return nextProgress
}

function applyStudyTime(ms, now = new Date()) {
  const safeMs = clampStudyMs(ms)
  if (safeMs <= 0) {
    return
  }

  mutateAppState((state) => {
    const dayKey = toDayKey(now)
    const today = state.dailyActivity[dayKey] ?? { cards: 0, ms: 0 }
    return {
      ...state,
      dailyActivity: {
        ...state.dailyActivity,
        [dayKey]: {
          cards: today.cards,
          ms: today.ms + safeMs,
        },
      },
    }
  }, { updatedAt: now.toISOString() })
}

function updateSettings(patch) {
  mutateAppState((state) => ({
    ...state,
    settings: {
      ...state.settings,
      ...patch,
    },
  }))
}

function resetProgress() {
  appState = createEmptyAppState()
  saveAppState()
  uiState.study = {
    studyMode: 'mixed',
    currentUnit: null,
    hasSeenGestureHint: false,
    turn: 0,
    recentKeys: [],
    sessionQueue: [],
  }
  renderApp()
  setNotice('Progress reset. The deck is ready for a fresh start.')
}

function ensureStudyState() {
  if (!uiState.study.studyMode) {
    uiState.study.studyMode = 'mixed'
  }

  if (uiState.route !== 'study') {
    return
  }

  if (!uiState.study.currentUnit) {
    uiState.study.currentUnit = pickNextStudyUnit({
      cards: CC_TLDS,
      state: appState,
      studyMode: uiState.study.studyMode,
      sessionQueue: uiState.study.sessionQueue,
      turn: uiState.study.turn,
      recentKeys: uiState.study.recentKeys,
    })
  }
}

function setStudyMode(nextMode) {
  uiState.study.studyMode = nextMode
  uiState.study.currentUnit = null
  updateSettings({ preferredMode: nextMode })
}

function gradeCurrentCard(knew) {
  const currentUnit = uiState.study.currentUnit
  if (!currentUnit) {
    return
  }

  const now = new Date()
  const nextTurn = uiState.study.turn + 1
  const nextProgress = applyReview(currentUnit, currentUnit.mode, knew, now)
  uiState.study.turn = nextTurn
  uiState.study.recentKeys = [...uiState.study.recentKeys.slice(-7), currentUnit.key]
  uiState.study.sessionQueue = scheduleSessionFollowUp(
    uiState.study.sessionQueue,
    currentUnit,
    nextProgress,
    knew,
    nextTurn,
  )
  uiState.study.currentUnit = null
  uiState.study.hasSeenGestureHint = true
  renderApp()
}

function flushStudyClock() {
  if (!studyClockStartedAt) {
    return
  }

  const now = Date.now()
  applyStudyTime(now - studyClockStartedAt, new Date(now))
  studyClockStartedAt = now
}

function syncStudyClock() {
  const shouldRun = uiState.route === 'study' && document.visibilityState === 'visible'
  if (!shouldRun) {
    studyClockStartedAt = null
    return
  }

  if (!studyClockStartedAt) {
    studyClockStartedAt = Date.now()
  }
}

function resetStudySwipeStyles(swipeZone) {
  swipeZone.style.setProperty('--swipe-x', '0px')
  swipeZone.style.setProperty('--swipe-rotation', '0deg')
  swipeZone.style.setProperty('--swipe-left-opacity', '0')
  swipeZone.style.setProperty('--swipe-right-opacity', '0')
  swipeZone.classList.remove('is-dragging', 'is-throwing-left', 'is-throwing-right')
}

function applyStudySwipeStyles(swipeZone, deltaX) {
  const width = swipeZone.offsetWidth || 1
  const progress = Math.min(1, Math.abs(deltaX) / Math.max(SWIPE_COMMIT_DISTANCE, width * SWIPE_COMMIT_RATIO))
  swipeZone.style.setProperty('--swipe-x', `${deltaX}px`)
  swipeZone.style.setProperty('--swipe-rotation', `${deltaX * 0.045}deg`)
  swipeZone.style.setProperty('--swipe-left-opacity', deltaX < 0 ? `${progress}` : '0')
  swipeZone.style.setProperty('--swipe-right-opacity', deltaX > 0 ? `${progress}` : '0')
}

function finishStudySwipeGesture(swipeZone, pointerId) {
  if (pointerId !== null && swipeZone.hasPointerCapture?.(pointerId)) {
    swipeZone.releasePointerCapture(pointerId)
  }

  swipeZone.classList.remove('is-dragging')
  studySwipe.pointerId = null
  studySwipe.deltaX = 0
  studySwipe.isDragging = false
}

function triggerStudyDecision(knew, swipeZone = document.querySelector('[data-swipe-zone="true"]')) {
  if (!uiState.study.currentUnit || studySwipe.isAnimating) {
    return
  }

  if (!swipeZone || appState.settings.reduceMotion) {
    gradeCurrentCard(knew)
    return
  }

  const width = swipeZone.offsetWidth || 320
  const targetX = (knew ? 1 : -1) * Math.max(360, width * 1.15)
  studySwipe.isAnimating = true
  swipeZone.classList.add(knew ? 'is-throwing-right' : 'is-throwing-left')
  applyStudySwipeStyles(swipeZone, targetX)

  let finished = false
  const complete = () => {
    if (finished) {
      return
    }

    finished = true
    studySwipe.isAnimating = false
    gradeCurrentCard(knew)
  }

  swipeZone.addEventListener('transitionend', complete, { once: true })
  window.setTimeout(complete, 320)
}

function bindStudySwipe(swipeZone) {
  resetStudySwipeStyles(swipeZone)
  studySwipe.pointerId = null
  studySwipe.deltaX = 0
  studySwipe.isDragging = false

  swipeZone.addEventListener('pointerdown', (event) => {
    if (studySwipe.isAnimating || !uiState.study.currentUnit || event.button !== 0) {
      return
    }

    studySwipe.pointerId = event.pointerId
    studySwipe.startX = event.clientX
    studySwipe.startY = event.clientY
    studySwipe.deltaX = 0
    studySwipe.isDragging = false
  })

  swipeZone.addEventListener('pointermove', (event) => {
    if (event.pointerId !== studySwipe.pointerId || studySwipe.isAnimating) {
      return
    }

    const deltaX = event.clientX - studySwipe.startX
    const deltaY = event.clientY - studySwipe.startY
    if (!studySwipe.isDragging) {
      if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) {
        return
      }

      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        finishStudySwipeGesture(swipeZone, event.pointerId)
        return
      }

      studySwipe.isDragging = true
      swipeZone.classList.add('is-dragging')
      swipeZone.setPointerCapture?.(event.pointerId)
    }

    event.preventDefault()
    studySwipe.deltaX = deltaX
    applyStudySwipeStyles(swipeZone, deltaX)
  })

  const releaseSwipe = (event) => {
    if (event.pointerId !== studySwipe.pointerId) {
      return
    }

    const deltaX = studySwipe.deltaX
    const width = swipeZone.offsetWidth || 1
    const threshold = Math.max(SWIPE_COMMIT_DISTANCE, width * SWIPE_COMMIT_RATIO)
    const knew = deltaX > 0
    const shouldCommit = studySwipe.isDragging && Math.abs(deltaX) >= threshold

    finishStudySwipeGesture(swipeZone, event.pointerId)
    if (shouldCommit) {
      triggerStudyDecision(knew, swipeZone)
      return
    }

    resetStudySwipeStyles(swipeZone)
  }

  swipeZone.addEventListener('pointerup', releaseSwipe)
  swipeZone.addEventListener('pointercancel', releaseSwipe)
}

function renderStatCard(label, value, accent = '') {
  return `
    <article class="stat-card ${accent ? `stat-card--${accent}` : ''}">
      <p class="stat-card__label">${escapeHtml(label)}</p>
      <h3>${escapeHtml(value)}</h3>
    </article>
  `
}

function renderProgressDial(value, label) {
  const clamped = Math.max(0, Math.min(100, value))
  const dashOffset = 220 - (220 * clamped) / 100
  return `
    <div class="progress-dial">
      <svg viewBox="0 0 88 88" aria-hidden="true">
        <circle cx="44" cy="44" r="35" class="progress-dial__track"></circle>
        <circle
          cx="44"
          cy="44"
          r="35"
          class="progress-dial__value"
          stroke-dasharray="220"
          stroke-dashoffset="${dashOffset}"
        ></circle>
      </svg>
      <div class="progress-dial__copy">
        <span>${Math.round(clamped)}%</span>
        <small>${escapeHtml(label)}</small>
      </div>
    </div>
  `
}

function renderHomeScreen(snapshot, rankTitle) {
  const goalProgress = Math.min(100, (snapshot.todayMs / appState.settings.dailyGoalMs) * 100)
  return `
    <section class="screen">
      <article class="hero-card">
        <div class="hero-card__copy">
          <p class="hero-card__eyebrow">${escapeHtml(rankTitle)}</p>
          <h2>${Math.round(snapshot.masteredPercent)}% mastered</h2>
          <p class="hero-card__text">
            Memorize active country-code top-level domains with a calm daily rhythm. One card keeps the streak alive.
          </p>
        </div>
        ${renderProgressDial(goalProgress, `${formatClockMinutes(snapshot.todayMs)} today`)}
      </article>

      <div class="stats-grid">
        ${renderStatCard('Current streak', `${snapshot.currentStreak}`, 'warm')}
        ${renderStatCard('Best streak', `${snapshot.bestStreak}`)}
        ${renderStatCard('Due now', `${snapshot.dueNow}`, 'cool')}
        ${renderStatCard('Deck size', `${snapshot.totalCards}`)}
      </div>

      <article class="panel">
        <div class="panel__row">
          <div>
            <p class="panel__eyebrow">Today’s goal</p>
            <h3>${formatClockMinutes(appState.settings.dailyGoalMs)} target</h3>
          </div>
          <span class="pill">${snapshot.todayCards} cards today</span>
        </div>
        <div class="meter"><div class="meter__fill" style="width:${goalProgress}%"></div></div>
        <p class="panel__text">
          Progress counts actual study time. The streak advances as soon as you finish one card on a new day.
        </p>
        <div class="button-row">
          <button class="button button--primary" data-action="go-study">Start study</button>
          <button class="button button--ghost" data-action="go-progress">View progress</button>
        </div>
      </article>

      <article class="panel panel--soft">
        <div class="panel__row">
          <div>
            <p class="panel__eyebrow">Modes</p>
            <h3>Three ways to drill</h3>
          </div>
        </div>
        <div class="mode-cards">
          <div class="mode-mini"><p class="mode-mini__title">Mixed</p><p>Interleaves both directions so recall stays flexible.</p></div>
          <div class="mode-mini"><p class="mode-mini__title">Code → Country</p><p>See <code>.jp</code>, answer Japan.</p></div>
          <div class="mode-mini"><p class="mode-mini__title">Country → Code</p><p>See Japan, answer <code>.jp</code>.</p></div>
        </div>
      </article>
    </section>
  `
}

function renderStudyScreen(snapshot) {
  ensureStudyState()
  const currentUnit = uiState.study.currentUnit
  const nextDue = getNextDueLabel(appState, uiState.study.studyMode)
  return `
    <section class="screen">
      <article class="panel panel--soft">
        <div class="panel__row">
          <div>
            <p class="panel__eyebrow">Mode</p>
            <h3>Pick your recall direction</h3>
          </div>
          <span class="pill">${snapshot.dueNow} due now</span>
        </div>
        <div class="segmented">
          ${['mixed', 'code_to_country', 'country_to_code']
            .map((mode) => {
              const label =
                mode === 'mixed' ? 'Mixed' : mode === 'code_to_country' ? 'Code → Country' : 'Country → Code'
              return `<button class="segmented__option ${uiState.study.studyMode === mode ? 'is-active' : ''}" data-action="set-mode" data-mode="${mode}">${label}</button>`
            })
            .join('')}
        </div>
      </article>

      ${
        currentUnit
          ? `
        <article class="study-card" data-swipe-zone="true">
          <div class="study-card__top">
            <span class="pill pill--outline">${currentUnit.mode === 'code_to_country' ? 'Code → Country' : 'Country → Code'}</span>
            <span class="pill">${snapshot.todayCards} cards today</span>
          </div>
          <p class="study-card__cue">${escapeHtml(currentUnit.cue)}</p>
          <div class="study-card__prompt">${escapeHtml(currentUnit.prompt)}</div>
          ${
            uiState.study.revealed
              ? `
            <div class="study-card__answer">
              <div class="study-card__answer-main">${escapeHtml(currentUnit.answer)}</div>
              ${currentUnit.secondary ? `<p class="study-card__secondary">${escapeHtml(currentUnit.secondary)}</p>` : ''}
              ${
                currentUnit.aliases?.length
                  ? `<p class="study-card__meta">Also seen as ${escapeHtml(currentUnit.aliases.slice(0, 3).join(', '))}.</p>`
                  : ''
              }
            </div>
          `
              : `<button class="button button--primary study-card__reveal" data-action="reveal-card">Reveal answer</button>`
          }
          <div class="button-row button-row--study">
            <button class="button button--danger" data-action="grade-card" data-grade="dont" ${uiState.study.revealed ? '' : 'disabled'}>Don’t know it yet</button>
            <button class="button button--success" data-action="grade-card" data-grade="know" ${uiState.study.revealed ? '' : 'disabled'}>Know it</button>
          </div>
          <p class="study-card__hint">
            Space reveals. After reveal, swipe right or press Right Arrow for Know it; swipe left or press Left Arrow for Don’t know it yet.
          </p>
        </article>
      `
          : `
        <article class="panel panel--center">
          <p class="panel__eyebrow">Caught up</p>
          <h3>No cards are due in this mode right now.</h3>
          <p class="panel__text">Weak cards already answered today will still loop back sooner. Otherwise the next scheduled review is ${escapeHtml(nextDue)}.</p>
        </article>
      `
      }
    </section>
  `
}

function renderStudyScreenNext(snapshot) {
  ensureStudyState()
  const currentUnit = uiState.study.currentUnit
  const nextDue = getNextDueLabel(appState, uiState.study.studyMode)
  const modeLabel = getModeLabel(uiState.study.studyMode)
  const modeSelector = `
    <article class="panel panel--soft study-panel">
      <div class="panel__row">
        <div>
          <p class="panel__eyebrow">Study mode</p>
          <h3>${escapeHtml(modeLabel)}</h3>
        </div>
        <div class="study-panel__pills">
          <span class="pill">${snapshot.todayCards} today</span>
          <span class="pill pill--outline">${snapshot.dueNow} due</span>
        </div>
      </div>
      <div class="segmented">
        ${['mixed', 'code_to_country', 'country_to_code']
          .map(
            (mode) =>
              `<button class="segmented__option ${uiState.study.studyMode === mode ? 'is-active' : ''}" data-action="set-mode" data-mode="${mode}">${escapeHtml(getModeLabel(mode))}</button>`,
          )
          .join('')}
      </div>
      <p class="panel__text">Misses come back quickly. Cards you know still resurface as occasional refreshers.</p>
    </article>
  `

  return `
    <section class="screen screen--study">
      ${
        currentUnit
          ? `
        <article class="study-card" data-swipe-zone="true" data-study-key="${escapeHtml(currentUnit.key)}">
          <div class="study-card__wash study-card__wash--left"><span>Not yet</span></div>
          <div class="study-card__wash study-card__wash--right"><span>Know it</span></div>
          <div class="study-card__body">
            <p class="study-card__cue">${escapeHtml(currentUnit.cue)}</p>
            <div class="study-card__prompt">${escapeHtml(currentUnit.prompt)}</div>
          </div>
          ${
            uiState.study.hasSeenGestureHint
              ? ''
              : '<p class="study-card__hint study-card__hint--inline">Use arrow keys or swipe</p>'
          }
        </article>
        ${modeSelector}
      `
          : `
        <article class="panel panel--center">
          <p class="panel__eyebrow">Caught up</p>
          <h3>No cards are due in this mode right now.</h3>
          <p class="panel__text">Weak cards already answered today will still loop back sooner. Otherwise the next scheduled review is ${escapeHtml(nextDue)}.</p>
        </article>
        ${modeSelector}
      `
      }
    </section>
  `
}

function renderProgressScreen(snapshot, rankTitle) {
  const goalProgress = Math.min(100, (snapshot.todayMs / appState.settings.dailyGoalMs) * 100)
  return `
    <section class="screen">
      <article class="hero-card hero-card--compact">
        <div class="hero-card__copy">
          <p class="hero-card__eyebrow">${escapeHtml(rankTitle)}</p>
          <h2>${Math.round(snapshot.masteredPercent)}% of study units mastered</h2>
          <p class="hero-card__text">
            Mastery means repeated correct answers plus a longer review interval, so the percentage reflects durable recall rather than one lucky guess.
          </p>
        </div>
      </article>

      <div class="stats-grid stats-grid--wide">
        ${renderStatCard('Total domains', `${snapshot.totalCards}`)}
        ${renderStatCard('Study units', `${snapshot.totalUnits}`)}
        ${renderStatCard('Domains seen', `${snapshot.seenCards}`)}
        ${renderStatCard('Units seen', `${snapshot.seenUnits}`)}
        ${renderStatCard('Due now', `${snapshot.dueNow}`, 'cool')}
        ${renderStatCard('Mastered', `${snapshot.masteredUnits}`, 'warm')}
      </div>

      <article class="panel">
        <div class="panel__row">
          <div>
            <p class="panel__eyebrow">Consistency</p>
            <h3>${snapshot.currentStreak} day current streak</h3>
          </div>
          <span class="pill">Best ${snapshot.bestStreak}</span>
        </div>
        <div class="meter"><div class="meter__fill" style="width:${goalProgress}%"></div></div>
        <p class="panel__text">Today: ${formatClockMinutes(snapshot.todayMs)} of ${formatClockMinutes(appState.settings.dailyGoalMs)}.</p>
      </article>
    </section>
  `
}

function renderBrowseResults() {
  const query = uiState.browse.query.trim().toLowerCase()
  const results = query ? searchableCards.filter((card) => card.searchText.includes(query)) : searchableCards
  if (results.length === 0) {
    return '<article class="panel panel--center"><h3>No matches</h3><p class="panel__text">Try a broader country name or a different ccTLD.</p></article>'
  }

  return results
    .map(
      (card) => `
        <button class="browse-row" data-action="open-detail" data-code="${card.code}">
          <div>
            <p class="browse-row__title">${escapeHtml(card.nameDisplay)}</p>
            ${card.nameIsoShort && card.nameIsoShort !== card.nameDisplay ? `<p class="browse-row__subtitle">${escapeHtml(card.nameIsoShort)}</p>` : ''}
          </div>
          <span class="browse-row__tld">${escapeHtml(card.tld)}</span>
        </button>
      `,
    )
    .join('')
}

function renderBrowseScreen() {
  return `
    <section class="screen">
      <article class="panel panel--soft">
        <div class="panel__row">
          <div>
            <p class="panel__eyebrow">Browse the deck</p>
            <h3>Search by country or ccTLD</h3>
          </div>
        </div>
        <label class="search-box">
          <span>Search</span>
          <input id="browse-search" value="${escapeHtml(uiState.browse.query)}" placeholder="Try Japan or .jp" />
        </label>
      </article>
      <div class="browse-list" id="browse-results">${renderBrowseResults()}</div>
      ${renderDetailSheet()}
    </section>
  `
}

function renderDetailSheet() {
  if (!uiState.browse.selectedCode) {
    return ''
  }

  const card = CC_TLDS.find((item) => item.code === uiState.browse.selectedCode)
  if (!card) {
    return ''
  }

  const forward = ensureUnitProgress(appState, card.code, 'code_to_country')
  const reverse = ensureUnitProgress(appState, card.code, 'country_to_code')
  return `
    <div class="sheet-backdrop" data-action="close-detail">
      <article class="detail-sheet" data-sheet="true">
        <div class="panel__row">
          <div>
            <p class="panel__eyebrow">${escapeHtml(card.tld)}</p>
            <h3>${escapeHtml(card.nameDisplay)}</h3>
          </div>
          <button class="button button--ghost button--compact" data-action="close-detail">Close</button>
        </div>
        ${card.nameIsoShort && card.nameIsoShort !== card.nameDisplay ? `<p class="panel__text">${escapeHtml(card.nameIsoShort)}</p>` : ''}
        ${card.aliases?.length ? `<p class="panel__text">Also known as ${escapeHtml(card.aliases.join(', '))}.</p>` : ''}
        <div class="detail-status-grid">
          ${renderDirectionStatus('Code → Country', forward)}
          ${renderDirectionStatus('Country → Code', reverse)}
        </div>
      </article>
    </div>
  `
}

function renderDirectionStatus(title, progress) {
  return `
    <div class="detail-status">
      <p class="detail-status__title">${escapeHtml(title)}</p>
      <p>${escapeHtml(isUnitSeen(progress) ? `${progress.successCount} correct / ${progress.lapseCount} lapses` : 'New')}</p>
      <p>${escapeHtml(isUnitMastered(progress) ? 'Mastered' : formatRelativeDue(progress.dueAt))}</p>
    </div>
  `
}

function renderSettingsScreen() {
  return `
    <section class="screen">
      <article class="panel">
        <div class="panel__row">
          <div>
            <p class="panel__eyebrow">Comfort</p>
            <h3>Study preferences</h3>
          </div>
        </div>
        <label class="toggle-row">
          <span>Reduce motion</span>
          <input id="reduce-motion-toggle" type="checkbox" ${appState.settings.reduceMotion ? 'checked' : ''} />
        </label>
      </article>

      <article class="panel panel--soft">
        <div class="panel__row">
          <div>
            <p class="panel__eyebrow">Controls</p>
            <h3>Quick reference</h3>
          </div>
        </div>
        <div class="list-copy">
          <p>Use arrow keys or swipe on the study card.</p>
        </div>
      </article>

      <article class="panel panel--soft">
        <div class="panel__row">
          <div>
            <p class="panel__eyebrow">Data source</p>
            <h3>${escapeHtml(CC_TLD_SOURCE.authority)}</h3>
          </div>
          <span class="pill">Version ${escapeHtml(CC_TLD_SOURCE.rootZoneVersion)}</span>
        </div>
        <p class="panel__text">
          This deck includes the currently active ASCII ccTLD set from the IANA root zone, including active special cases such as <code>.uk</code> and <code>.eu</code>.
        </p>
      </article>

      <div class="button-row">
        <button class="button button--ghost" data-action="go-backup">Backup and restore</button>
        <button class="button button--danger" data-action="reset-progress">Reset progress</button>
      </div>
    </section>
  `
}

function renderBackupScreen() {
  const backupString = createBackupString(appState)
  return `
    <section class="screen">
      <article class="panel">
        <div class="panel__row">
          <div>
            <p class="panel__eyebrow">Export</p>
            <h3>Copy your backup string</h3>
          </div>
        </div>
        <textarea id="backup-export" class="code-box" readonly>${escapeHtml(backupString)}</textarea>
        <div class="button-row">
          <button class="button button--primary" data-action="copy-backup">Copy backup code</button>
        </div>
      </article>

      <article class="panel panel--soft">
        <div class="panel__row">
          <div>
            <p class="panel__eyebrow">Import</p>
            <h3>Restore on this device</h3>
          </div>
        </div>
        <textarea id="backup-import" class="code-box" placeholder="Paste a CCTLD1 backup string"></textarea>
        <p class="error-copy" id="backup-error"></p>
        <div class="button-row">
          <button class="button button--success" data-action="restore-backup">Restore backup</button>
        </div>
      </article>
    </section>
  `
}

function renderBottomNav() {
  const items = [
    ['today', 'Today'],
    ['study', 'Study'],
    ['progress', 'Progress'],
    ['browse', 'Browse'],
    ['settings', 'Settings'],
  ]
  return `
    <nav class="bottom-nav" aria-label="Primary">
      ${items
        .map(
          ([route, label]) =>
            `<a class="bottom-nav__item ${uiState.route === route ? 'is-active' : ''}" href="#/${route}">${escapeHtml(label)}</a>`,
        )
        .join('')}
    </nav>
  `
}

function renderScreen(snapshot, rankTitle) {
  switch (uiState.route) {
    case 'study':
      return renderStudyScreenNext(snapshot)
    case 'progress':
      return renderProgressScreen(snapshot, rankTitle)
    case 'browse':
      return renderBrowseScreen()
    case 'settings':
      return renderSettingsScreen()
    case 'backup':
      return renderBackupScreen()
    default:
      return renderHomeScreen(snapshot, rankTitle)
  }
}

function renderApp() {
  uiState.route = getRouteFromHash()
  ensureStudyState()
  syncStudyClock()

  const snapshot = getProgressSnapshot(appState, CC_TLDS)
  const rankTitle = getRankTitle(snapshot.masteredPercent)
  const isStudyRoute = uiState.route === 'study'
  root.innerHTML = `
    <div class="app-shell ${appState.settings.reduceMotion ? 'reduce-motion' : ''} ${isStudyRoute ? 'app-shell--study' : ''}">
      <div class="ambient ambient-one"></div>
      <div class="ambient ambient-two"></div>
      <div class="app-frame ${isStudyRoute ? 'app-frame--study' : ''}">
        ${
          isStudyRoute
            ? `
          <header class="chrome chrome--study">
            <div class="chrome__status chrome__status--study">
              <p class="chrome__eyebrow">Root Recall</p>
              ${uiState.notice ? `<div class="toast">${escapeHtml(uiState.notice)}</div>` : ''}
            </div>
          </header>
        `
            : `
          <header class="chrome">
            <div>
              <p class="chrome__eyebrow">Root Recall</p>
              <h1>${escapeHtml(ROUTE_TITLES[uiState.route])}</h1>
            </div>
            <div class="chrome__status">
              <span class="pill pill--outline">Daily ccTLD practice</span>
              ${uiState.notice ? `<div class="toast">${escapeHtml(uiState.notice)}</div>` : ''}
            </div>
          </header>
        `
        }
        <main class="screen-shell">${renderScreen(snapshot, rankTitle)}</main>
        ${renderBottomNav()}
      </div>
    </div>
  `

  bindRouteSpecificEvents()
}

function bindRouteSpecificEvents() {
  const browseSearch = document.getElementById('browse-search')
  if (browseSearch) {
    browseSearch.addEventListener('input', (event) => {
      uiState.browse.query = event.target.value
      const results = document.getElementById('browse-results')
      if (results) {
        results.innerHTML = renderBrowseResults()
      }
    })
  }

  const reduceMotionToggle = document.getElementById('reduce-motion-toggle')
  if (reduceMotionToggle) {
    reduceMotionToggle.addEventListener('change', (event) => {
      updateSettings({ reduceMotion: event.target.checked })
    })
  }

  const swipeZone = document.querySelector('[data-swipe-zone="true"]')
  if (swipeZone) {
    bindStudySwipe(swipeZone)
  }
}

root.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]')
  if (!target) {
    return
  }

  const action = target.dataset.action
  if (action === 'go-study') {
    if (!uiState.study.currentUnit && uiState.study.turn === 0) {
      uiState.study.studyMode = 'mixed'
    }
    window.location.hash = '#/study'
    return
  }

  if (action === 'go-progress') {
    window.location.hash = '#/progress'
    return
  }

  if (action === 'go-backup') {
    window.location.hash = '#/backup'
    return
  }

  if (action === 'set-mode') {
    setStudyMode(target.dataset.mode)
    return
  }

  if (action === 'grade-card') {
    gradeCurrentCard(target.dataset.grade === 'know')
    return
  }

  if (action === 'open-detail') {
    uiState.browse.selectedCode = target.dataset.code
    renderApp()
    return
  }

  if (action === 'close-detail') {
    const sheet = event.target.closest('[data-sheet="true"]')
    if (sheet && target.dataset.action === 'close-detail' && !target.classList.contains('button')) {
      return
    }

    uiState.browse.selectedCode = null
    renderApp()
    return
  }

  if (action === 'reset-progress') {
    if (window.confirm('Reset all local study progress? This cannot be undone.')) {
      resetProgress()
    }
    return
  }

  if (action === 'copy-backup') {
    const exportBox = document.getElementById('backup-export')
    const backupValue = exportBox?.value ?? createBackupString(appState)
    try {
      await navigator.clipboard.writeText(backupValue)
      setNotice('Backup code copied to the clipboard.')
    } catch {
      const errorBox = document.getElementById('backup-error')
      if (errorBox) {
        errorBox.textContent = 'Clipboard access is not available in this browser context.'
      }
    }
    return
  }

  if (action === 'restore-backup') {
    const importBox = document.getElementById('backup-import')
    const errorBox = document.getElementById('backup-error')
    try {
      appState = parseBackupString(importBox?.value ?? '')
      saveAppState()
      uiState.study = {
        studyMode: 'mixed',
        currentUnit: null,
        hasSeenGestureHint: false,
        turn: 0,
        recentKeys: [],
        sessionQueue: [],
      }
      if (importBox) {
        importBox.value = ''
      }
      if (errorBox) {
        errorBox.textContent = ''
      }
      renderApp()
      setNotice('Backup restored locally.')
    } catch (error) {
      if (errorBox) {
        errorBox.textContent = error instanceof Error ? error.message : 'Backup restore failed.'
      }
    }
  }
})

window.addEventListener('hashchange', () => {
  flushStudyClock()
  renderApp()
})

window.addEventListener('keydown', (event) => {
  if (uiState.route !== 'study') {
    return
  }

  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault()
    triggerStudyDecision(true)
    return
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    triggerStudyDecision(false)
  }
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushStudyClock()
    studyClockStartedAt = null
  } else {
    syncStudyClock()
  }
})

window.addEventListener('pagehide', () => {
  flushStudyClock()
  studyClockStartedAt = null
})

window.setInterval(() => {
  if (uiState.route === 'study' && document.visibilityState === 'visible') {
    flushStudyClock()
  }
}, 15_000)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined)
  })
}

renderApp()

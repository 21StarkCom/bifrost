import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Row, RunFile, Stage, TicketFile, View } from '../types'

// The state contract is in ../README.md.
const STAGES: Stage[] = ['ticket', 'pr', 'review', 'merged', 'closed']
const WIDTH = 20
const POLL_MS = 1000
const TICKET_ID = /^STARK-\d+$/

const view = atom({ plugin: 'stark-progress', key: 'view' } as const, null)

/** A bar filled by stage; `blocked` and anything unknown draw empty. */
export function bar(stage: string): string {
  const at = STAGES.indexOf(stage as Stage)
  const filled = at < 0 ? 0 : Math.round(((at + 1) / STAGES.length) * WIDTH)

  return '█'.repeat(filled) + '░'.repeat(WIDTH - filled)
}

function parse<T>(text: string | undefined): Partial<T> | null {
  if (!text) return null
  try {
    const value: unknown = JSON.parse(text)

    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Partial<T>) : null
  } catch {
    return null
  }
}

/** A ticket's row; a field of the wrong type reads as absent, so drawing never throws. */
function row(id: string, text: string | undefined): Row {
  const t = parse<TicketFile>(text)

  return {
    id,
    title: typeof t?.title === 'string' ? t.title : '',
    stage: typeof t?.stage === 'string' ? t.stage : 'ticket',
  }
}

const isRunName = (name: string) => name.startsWith('run-') && name.endsWith('.json')

/** The first run file, by name, whose `session` is this session's: Gru's run. */
export function ownRun(session: string, files: Record<string, string>): RunFile | null {
  for (const name of Object.keys(files).filter(isRunName).sort()) {
    const run = parse<RunFile>(files[name])
    if (run?.session !== session || !Array.isArray(run.tickets)) continue
    const tickets = run.tickets.filter((id): id is string => typeof id === 'string')

    return { epic: typeof run.epic === 'string' ? run.epic : '', session, tickets: [...new Set(tickets)] }
  }

  return null
}

/** The ticket a worker's worktree is named for, from the session's project root. */
export function ticketOf(root: string): string | null {
  const base = root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''

  return TICKET_ID.test(base) ? base : null
}

/**
 * What this tab shows, from the session's project root and id and the contract
 * directory's files by name. A run file whose `session` is this session's wins
 * (Gru's tab, which stands in a worktree named for its launch id, the epic's
 * own `STARK-n` included); otherwise a worker's worktree is named for its
 * ticket, so its tab shows that ticket's file.
 */
export function buildView(root: string, session: string, files: Record<string, string>): View | null {
  const run = ownRun(session, files)
  if (run !== null) {
    const rows = run.tickets.map(id => row(id, files[`${id}.json`]))
    const closed = rows.filter(r => r.stage === 'closed').length

    return { heading: `Gru · ${run.epic} · ${closed}/${rows.length} closed`, rows }
  }

  const id = ticketOf(root)
  const text = id === null ? undefined : files[`${id}.json`]

  return id === null || text === undefined ? null : { heading: null, rows: [row(id, text)] }
}

export const register: Register = on => {
  let last = ''
  let isPolling = false

  on('session.start', async ($, e, next) => {
    const home = await $.env.get('HOME')
    if (!home) return next(e)
    const dir = `${home}/.cache/stark-progress`

    $.clock.every(POLL_MS, async () => {
      // A slow tick must not overlap the next one and write an older view last.
      if (isPolling) return
      isPolling = true
      try {
        const listed = await $.fs.list(dir).catch(() => [])
        const names = new Set(listed.filter(f => f.kind === 'file' && f.name.endsWith('.json')).map(f => f.name))
        const files: Record<string, string> = {}
        const load = async (name: string) => {
          if (!names.has(name)) return
          const text = await $.fs.read(`${dir}/${name}`).catch(() => undefined)
          if (typeof text === 'string') files[name] = text
        }

        // The run files first; then only the ticket files this tab draws, so a
        // directory of old tickets costs a listing, not a read of each.
        const [root, session] = await Promise.all([$.session.root(), $.session.id()])
        await Promise.all([...names].filter(isRunName).map(load))
        const run = ownRun(session, files)
        const ticket = ticketOf(root)
        const wanted = run !== null ? run.tickets : ticket === null ? [] : [ticket]
        await Promise.all(wanted.map(id => load(`${id}.json`)))

        const fresh = buildView(root, session, files)
        const key = JSON.stringify(fresh)
        if (key === last) return
        last = key
        await update($, view, () => fresh)
      } finally {
        isPolling = false
      }
    })

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, view)
    if (e.props.hasSurvey || current === null || current.rows.length === 0) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const color = (stage: Stage) => (stage === 'closed' ? 'green' : stage === 'blocked' ? 'red' : 'cyan')

    return (
      <Box flexDirection="column">
        {current.heading === null ? null : <Text bold>{current.heading}</Text>}
        {current.rows.map(r => (
          <Text key={r.id}>
            <Text color={color(r.stage)}>{bar(r.stage)}</Text> {r.id.padEnd(11)} {r.stage.padEnd(7)}{' '}
            <Text dimColor>{r.title}</Text>
          </Text>
        ))}
      </Box>
    )
  })
}

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

function parse<T>(text: string | undefined): T | null {
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function row(id: string, text: string | undefined): Row {
  const t = parse<TicketFile>(text)

  return { id, title: t?.title ?? '', stage: t?.stage ?? 'ticket' }
}

/**
 * What this tab shows, from the session's cwd and id and the contract
 * directory's files by name. A worker's worktree is named for its ticket, so
 * its tab shows that ticket's file; any other tab shows the run files whose
 * `session` is this session's: Gru's run.
 */
export function buildView(cwd: string, session: string, files: Record<string, string>): View | null {
  const base = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  if (TICKET_ID.test(base)) {
    const text = files[`${base}.json`]

    return text === undefined ? null : { heading: null, rows: [row(base, text)] }
  }

  const runs = Object.keys(files)
    .filter(name => name.startsWith('run-') && name.endsWith('.json'))
    .sort()
    .map(name => parse<RunFile>(files[name]))
    .filter((r): r is RunFile => r !== null && r.session === session && Array.isArray(r.tickets))
  if (runs.length === 0) return null

  const run = runs[0]
  const rows = run.tickets.map(id => row(id, files[`${id}.json`]))
  const closed = rows.filter(r => r.stage === 'closed').length

  return { heading: `Gru · ${run.epic} · ${closed}/${rows.length} closed`, rows }
}

export const register: Register = on => {
  let last = ''

  on('session.start', async ($, e, next) => {
    const home = await $.env.get('HOME')
    const dir = `${home}/.cache/stark-progress`

    $.clock.every(POLL_MS, async () => {
      const files: Record<string, string> = {}
      const entries = await $.fs.list(dir).catch(() => [])
      for (const entry of entries) {
        if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
        const text = await $.fs.read(`${dir}/${entry.name}`).catch(() => undefined)
        if (typeof text === 'string') files[entry.name] = text
      }
      const fresh = buildView(await $.session.cwd(), await $.session.id(), files)
      const key = JSON.stringify(fresh)
      if (key === last) return
      last = key
      await update($, view, () => fresh)
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
